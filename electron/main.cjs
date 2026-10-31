// Electron 主进程：一个进程管三件事
//
//   1. 主窗口            渲染器加载内置 Web 服务的地址
//   2. 内置 Web 服务      nitro 产物在本进程内启动，端口自动挑选
//   3. ComfyUI 子进程     用便携 Python 拉起，退出时连子树一起结束
//
// 为什么不再用 PowerShell 控制台：
//
// 那套走计划任务 + wscript + VBS 隐藏窗口，每一步都在和 Windows 的进程模型
// 较劲：任务不存在、路径带空格、PowerShell 执行策略、BOM 缺失、虚拟显示驱动
// 吃掉窗口…… 全都是外壳问题，不是产品问题。Electron 里这些都不存在。
//
// 为什么是 .cjs 而不是 .mjs：
//
// 项目 package.json 是 type:module，但 Electron 主进程对 ESM 的支持仍有限，
// import electron 会走到 CJS 预解析那条路上直接崩。.cjs 后缀强制走 require，
// 是这块唯一稳定的写法。渲染层不受影响，它加载的是 http 地址。
const { app, BrowserWindow, dialog, ipcMain, Menu, shell, Tray } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { createServer } = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ensureSchema, seedShowcase } = require('./db-bootstrap.cjs');
const { inspectBundle, extractBundle, deployBundle, freeSpaceOf } = require('./bundle.cjs');

const APP_ROOT = path.dirname(__dirname);
/** 打包后服务端产物在 resources/ 下（asar 外），开发时在 build-resources/。 */
const RESOURCES = app.isPackaged ? process.resourcesPath : path.join(APP_ROOT, 'build-resources');

const SERVER_ENTRY = path.join(RESOURCES, 'server', 'index.mjs');

/** 作品放用户目录，重装/升级不丢。 */
const DATA_DIR = path.join(app.getPath('userData'), 'data');

let mainWindow = null;
let tray = null;
let serverUrl = null;
let serverStarted = false;
let comfyProcess = null;
let quitting = false;

// 诊断：确认主进程启动到哪一步

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const logDir = () => {
  const dir = path.join(DATA_DIR, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.writeFileSync(path.join(logDir(), 'app.log'), line, { flag: 'a' });
  } catch {
    /* 日志写不了不影响运行 */
  }
  if (!app.isPackaged) process.stdout.write(line);
};

/** 端口是否空闲。 */
const isPortFree = (port) =>
  new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });

const isPortOpen = (port) => isPortFree(port).then((free) => !free);

/** 从 3020 起找一个没被占的端口。 */
const pickPort = async (start = 3020, tries = 40) => {
  for (let p = start; p < start + tries; p += 1) {
    if (await isPortFree(p)) return p;
  }
  return 0;
};

// ── ComfyUI
const comfyConfigPath = () => path.join(DATA_DIR, 'comfyui.config.json');

const readComfyConfig = () => {
  try {
    const raw = JSON.parse(fs.readFileSync(comfyConfigPath(), 'utf8'));
    return {
      root: raw.root || raw.comfyRoot || null,
      pythonPath: raw.pythonPath || null,
    };
  } catch {
    return { root: null, pythonPath: null };
  }
};

const writeComfyConfig = (root, pythonPath) => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    comfyConfigPath(),
    JSON.stringify(
      {
        root,
        pythonPath,
        baseUrl: 'http://127.0.0.1:8188',
        workflowDir: 'comfyui/workflows',
      },
      null,
      2
    )
  );
};

/**
 * 找一个像 ComfyUI 的目录。
 *
 * 不假设盘符 —— 部署包可能解到任何位置。候选：配置记着的、应用旁边的
 * deploy/manke、所有固定磁盘下的常见目录名。
 */
const findComfyRoots = () => {
  const found = new Set();
  const configured = readComfyConfig().root;
  if (configured && fs.existsSync(path.join(configured, 'python_embeded', 'python.exe'))) {
    found.add(configured);
  }

  const bases = [
    path.join(RESOURCES, 'deploy', 'manke'),
    path.join(path.dirname(RESOURCES), 'manke'),
    path.join(path.dirname(RESOURCES), 'ComfyUI'),
  ];
  for (const base of bases) {
    if (fs.existsSync(path.join(base, 'python_embeded', 'python.exe'))) found.add(base);
    if (fs.existsSync(path.join(base, 'ComfyUI', 'python_embeded', 'python.exe'))) {
      found.add(path.join(base, 'ComfyUI'));
    }
  }

  let drives = ['C:\\', 'D:\\', 'E:\\'];
  try {
    const out = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        '(Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root) -join "|"',
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 }
    );
    if (out.stdout) {
      drives = out.stdout
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } catch {
    /* 用默认的三个 */
  }

  for (const drive of drives) {
    for (const name of ['ComfyUI', path.join('manke', 'ComfyUI'), path.join('AI', 'ComfyUI')]) {
      const p = path.join(drive, name);
      try {
        if (fs.existsSync(path.join(p, 'python_embeded', 'python.exe'))) found.add(p);
        if (fs.existsSync(path.join(p, 'ComfyUI', 'python_embeded', 'python.exe'))) {
          found.add(path.join(p, 'ComfyUI'));
        }
      } catch {
        /* 无权限跳过 */
      }
    }
  }
  return [...found];
};

const resolveComfy = () => {
  const cfg = readComfyConfig();
  const root = cfg.root || findComfyRoots()[0] || null;
  if (!root) return null;
  const py = cfg.pythonPath || path.join(root, 'python_embeded', 'python.exe');
  let mainPy = path.join(root, 'main.py');
  if (!fs.existsSync(mainPy)) mainPy = path.join(root, 'ComfyUI', 'main.py');
  if (!fs.existsSync(py) || !fs.existsSync(mainPy)) return null;
  return { root, py, mainPy, workDir: path.dirname(mainPy) };
};

const startComfyUI = async () => {
  if (comfyProcess && !comfyProcess.killed) {
    return { ok: true, message: 'ComfyUI 已在运行' };
  }
  if (await isPortOpen(8188)) {
    return { ok: true, message: '8188 已有 ComfyUI 在跑，直接复用' };
  }

  const target = resolveComfy();
  if (!target) {
    return {
      ok: false,
      message:
        '没有找到 ComfyUI。点「选择 ComfyUI 位置」指定目录（里面应有 python_embeded\\python.exe）。',
    };
  }

  writeComfyConfig(target.root, target.py);
  const errFile = path.join(logDir(), 'comfyui.err.log');
  log(`启动 ComfyUI: ${target.py} ${target.mainPy}`);

  const tail = [];
  comfyProcess = spawn(
    target.py,
    ['-s', target.mainPy, '--listen', '127.0.0.1', '--port', '8188'],
    {
      cwd: target.workDir,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    }
  );

  comfyProcess.stdout?.on('data', (d) => {
    tail.push(d.toString());
    if (tail.length > 40) tail.shift();
  });
  comfyProcess.stderr?.on('data', (d) => {
    const s = d.toString();
    tail.push(s);
    if (tail.length > 40) tail.shift();
    try {
      fs.writeFileSync(errFile, s, { flag: 'a' });
    } catch {
      /* ignore */
    }
  });
  comfyProcess.on('exit', (code) => {
    log(`ComfyUI 退出 code=${code}`);
    comfyProcess = null;
  });

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await isPortOpen(8188)) return { ok: true, message: 'ComfyUI 已就绪' };
    await new Promise((r) => setTimeout(r, 600));
  }
  const snippet = tail.join('').split('\n').slice(-8).join('\n');
  return { ok: false, message: `ComfyUI 180 秒内没起来。日志尾部：\n${snippet}` };
};

const stopComfyUI = () => {
  if (!comfyProcess) return { ok: true, message: 'ComfyUI 未在运行' };
  const pid = comfyProcess.pid;
  try {
    // python 会再拉子进程，只 kill 父进程会留下占着 8188 的孤儿 ——
    // taskkill /T 连整棵进程树一起收。
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      timeout: 10_000,
    });
  } catch {
    /* ignore */
  }
  comfyProcess = null;
  return { ok: true, message: 'ComfyUI 已停止' };
};

// ── 内置 Web 服务
//
// nitro 的 node-server 产物 import 之后自己就 listen 了，端口读 PORT 环境变量。
// 所以不接管它的 server 对象，只给一个选好的端口，然后等它应答。
const startServer = async () => {
  if (serverStarted) return serverUrl;

  if (!fs.existsSync(SERVER_ENTRY)) {
    throw new Error(`内置服务缺失：${SERVER_ENTRY}\n安装包可能不完整，请重新安装。`);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // 建表 + 写展示素材。全新机器上用户数据目录是空的，不建表首页所有查询都会 500。
  const migrationsDir = path.join(RESOURCES, 'migrations');
  const schema = ensureSchema(DATA_DIR, migrationsDir);
  log(`数据库: ${schema.message}`);
  if (!schema.ok) {
    throw new Error(`数据库初始化失败：${schema.message}`);
  }
  const seeded = seedShowcase(DATA_DIR, path.join(RESOURCES, 'public'));
  log(`展示素材: ${seeded.message}`);
  const port = await pickPort(3020);

  process.env.BEATDESIGN_DATA_DIR = DATA_DIR;
  process.env.BEATDESIGN_COMFYUI_HOME = readComfyConfig().root || '';
  process.env.PORT = String(port);
  process.env.NITRO_PORT = String(port);
  process.env.HOST = '127.0.0.1';
  process.env.NITRO_HOST = '127.0.0.1';
  process.env.NODE_ENV = 'production';

  log(`启动内置服务，端口 ${port}`);
  await import(pathToFileURL(SERVER_ENTRY).href);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) {
      serverStarted = true;
      serverUrl = `http://127.0.0.1:${port}`;
      log(`内置服务就绪: ${serverUrl}`);
      return serverUrl;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`内置服务 30 秒内没起来（端口 ${port}）`);
};

// ── 窗口
const createWindow = async () => {
  const url = await startServer();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#F1F4F9',
    title: '漫客工作台',
    icon: path.join(RESOURCES, 'icon.ico'),
    webPreferences: {
      // __dirname 在打包后是 asar 里的根，开发时是 electron/ 目录
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 先隐藏，页面画好再显示 —— 否则会看到白底闪一下
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(url);
};

const createTray = () => {
  try {
    tray = new Tray(path.join(RESOURCES, 'icon.ico'));
    tray.setToolTip('漫客工作台');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '显示主窗口',
          click: () => {
            if (mainWindow) mainWindow.show();
            else void createWindow();
          },
        },
        { type: 'separator' },
        { label: '启动 ComfyUI', click: () => void startComfyUI() },
        { label: '停止 ComfyUI', click: () => stopComfyUI() },
        { type: 'separator' },
        {
          label: '退出',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ])
    );
    tray.on('double-click', () => mainWindow && mainWindow.show());
  } catch {
    /* 没图标就不建托盘 */
  }
};

// ── 引导状态
//
// 首次启动进引导页：检测环境 → 选 ComfyUI 或下载部署包 → 进工作台。
// 状态落在 DATA_DIR/onboarding.json，跟作品放一起。
const onboardingPath = () => path.join(DATA_DIR, 'onboarding.json');

const readOnboarding = () => {
  try {
    const raw = JSON.parse(fs.readFileSync(onboardingPath(), 'utf8'));
    return { completed: Boolean(raw.completed), completedAt: raw.completedAt ?? null };
  } catch {
    return { completed: false, completedAt: null };
  }
};

const writeOnboarding = (completed) => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    onboardingPath(),
    JSON.stringify({ completed, completedAt: completed ? new Date().toISOString() : null }, null, 2)
  );
};

/**
 * 环境自检。
 *
/**
 * Environment probe.
 *
 * Returns facts only -- paths, port numbers, VRAM. All user-facing wording is
 * produced by the renderer's i18n layer from the check id, so nothing here
 * needs translating when a locale is added.
 */
const checkEnvironment = async () => {
  const checks = [];

  // 1. Built-in service (running if we got here at all)
  checks.push({
    id: 'server',
    ok: true,
    detail: serverUrl ?? '',
  });

  // 2. ComfyUI directory
  const roots = findComfyRoots();
  const target = resolveComfy();
  checks.push({
    id: 'comfyui',
    ok: Boolean(target),
    detail: target ? target.root : '',
    hintId: target ? null : 'pickOrDownload',
  });

  // 3. Is ComfyUI running
  const comfyRunning = await isPortOpen(8188);
  checks.push({
    id: 'comfyuiRunning',
    ok: comfyRunning,
    detail: comfyRunning ? '8188' : '',
    hintId: comfyRunning ? null : 'startIt',
  });

  // 4. GPU: read VRAM from nvidia-smi
  let gpu = { ok: false, detail: '', name: null, vramMb: null };
  try {
    const out = spawnSync(
      'nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 }
    );
    const line = (out.stdout || '')
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean);
    if (line) {
      const [name, vram] = line.split(',').map((s) => s.trim());
      gpu = { ok: true, detail: `${name} · ${vram} MB`, name, vramMb: Number(vram) };
    }
  } catch {
    /* no nvidia-smi means no NVIDIA card; keep the default */
  }
  checks.push({
    id: 'gpu',
    ok: gpu.ok,
    detail: gpu.detail,
    hintId: gpu.ok && gpu.vramMb < 8000 ? 'lowVram' : null,
  });

  // 5. Data directory writable
  let diskOk = false;
  let diskDetail = DATA_DIR;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const probe = path.join(DATA_DIR, '.write-probe');
    fs.writeFileSync(probe, '1');
    fs.unlinkSync(probe);
    diskOk = true;
  } catch (e) {
    diskDetail = `${DATA_DIR} · ${e && e.message}`;
  }
  checks.push({ id: 'data', ok: diskOk, detail: diskDetail });

  return {
    checks,
    ok: checks.every((c) => c.ok),
    // 最低限度能进工作台：服务和数据目录在就行，ComfyUI 可以后补
    ready: checks.filter((c) => c.id === 'server' || c.id === 'data').every((c) => c.ok),
    comfyRoot: readComfyConfig().root,
    comfyFound: roots,
  };
};

// ── IPC
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  dataDir: DATA_DIR,
  serverUrl,
  resources: RESOURCES,
  packaged: app.isPackaged,
}));

ipcMain.handle('onboarding:state', () => readOnboarding());

ipcMain.handle('onboarding:complete', () => {
  writeOnboarding(true);
  return { ok: true };
});

ipcMain.handle('onboarding:reset', () => {
  writeOnboarding(false);
  return { ok: true };
});

ipcMain.handle('env:check', () => checkEnvironment());

ipcMain.handle('comfy:status', async () => {
  const running = (comfyProcess && !comfyProcess.killed) || (await isPortOpen(8188));
  return {
    running: Boolean(running),
    root: readComfyConfig().root,
    roots: findComfyRoots(),
  };
});

ipcMain.handle('comfy:start', () => startComfyUI());
ipcMain.handle('comfy:stop', () => stopComfyUI());

ipcMain.handle('comfy:pickRoot', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 ComfyUI 目录（里面应有 python_embeded\\python.exe）',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false };
  const root = result.filePaths[0];
  const py = path.join(root, 'python_embeded', 'python.exe');
  if (!fs.existsSync(py)) {
    return { ok: false, message: '这个目录里没有 python_embeded\\python.exe' };
  }
  writeComfyConfig(root, py);
  return { ok: true, root };
});

ipcMain.handle('app:openLogs', () => shell.openPath(logDir()));
ipcMain.handle('app:quit', () => {
  quitting = true;
  app.quit();
});

// ── 部署包
//
// 新机器上最费时的一步：把 211 GB 的 ComfyUI 和模型放到该去的地方。
// 分卷放哪都行，检查时让用户选；解压完直接把结果记进 ComfyUI 配置。
const bundlePaths = () => {
  const guesses = [
    path.join(RESOURCES, 'deploy'),
    path.join(path.dirname(RESOURCES), 'deploy'),
    path.join(app.getPath('userData'), 'deploy'),
    path.join(app.getPath('downloads'), 'manke'),
  ];
  return guesses.filter((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
};


ipcMain.handle('bundle:guess', () => {
  const dirs = bundlePaths();
  // 第一个真有分卷的直接用；没有就把候选目录都返回让用户挑
  for (const dir of dirs) {
    const r = inspectBundle(dir);
    if (r.base) return { dir, ...r };
  }
  return { dir: dirs[0] ?? '', ok: false, message: '没找到部署包目录' };
});

ipcMain.handle('bundle:inspect', (_e, dir) => inspectBundle(dir));

ipcMain.handle('bundle:pickDir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择部署包分卷所在目录（里面应有 .7z.001）',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const dir = result.filePaths[0];
  return { ok: true, dir, ...inspectBundle(dir) };
});

ipcMain.handle('bundle:pickTarget', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择解压到哪里（建议选空间充足的盘，需要 250 GB 以上）',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  return { ok: true, dir: result.filePaths[0] };
});

ipcMain.handle('bundle:extract', async (_e, { firstVolume, targetDir }) => {
  log(`解压部署包 → ${targetDir}`);
  const result = await extractBundle({
    firstVolume,
    targetDir,
    resources: RESOURCES,
    onProgress: (p) => {
      try {
        mainWindow?.webContents.send('bundle:progress', p);
      } catch {
        /* 窗口关了就算了 */
      }
    },
  });
  log(`部署包解压: ${result.message}`);

  // 成功就把它记成 ComfyUI 位置，省得用户再选一次
  if (result.ok) {
    const root = result.targetDir;
    const py = path.join(root, 'python_embeded', 'python.exe');
    if (fs.existsSync(py)) {
      writeComfyConfig(root, py);
      log(`ComfyUI 已指向 ${root}`);
    }
  }
  return result;
});

// 一键部署：检查 → 备空间 → 解压 → 写配置 → 起服务。
//
// 这是「全流程内置」的那个按钮。用户只需要选一个目录（放分卷的）和一个
// 目标盘，剩下的都在这儿做完，不用再点第二次。
ipcMain.handle('bundle:deploy', async (_e, { dir, targetDir }) => {
  const send = (p) => {
    try {
      mainWindow?.webContents.send('bundle:progress', p);
    } catch {
      /* 窗口关了就算了 */
    }
  };

  log(`一键部署：${dir} → ${targetDir}`);
  const result = await deployBundle({
    dir,
    targetDir,
    resources: RESOURCES,
    onProgress: send,
  });

  if (!result.ok) {
    log(`一键部署失败：${result.message}`);
    return result;
  }

  // 写配置
  const root = result.comfyRoot;
  const py = path.join(root, 'python_embeded', 'python.exe');
  if (fs.existsSync(py)) {
    writeComfyConfig(root, py);
    log(`ComfyUI 已指向 ${root}`);
  }

  // 顺手把 ComfyUI 起起来 —— 用户点完这个按钮就该能直接生成
  send({ phase: 'start', percent: 100, message: '启动 ComfyUI…' });
  const started = await startComfyUI();
  log(`自动启动 ComfyUI: ${started.message}`);

  return {
    ok: true,
    comfyRoot: root,
    comfyStarted: started.ok,
    message: started.ok
      ? `部署完成，ComfyUI 已就绪。${result.message}`
      : `部署完成，但 ComfyUI 没起来：${started.message}`,
  };
});

// 目标盘的可用空间，界面上用来提示够不够
ipcMain.handle('bundle:freeSpace', (_e, dir) => ({ free: freeSpaceOf(dir) }));


app.whenReady().then(async () => {
  // Drop the default File/Edit/View/Window/Help menu. Those items are for
  // developers -- Reload, Toggle DevTools, Zoom -- and they are in English.
  // Everything the user needs lives in the UI and the tray menu.
  Menu.setApplicationMenu(null);

  try {
    const diag = {
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appRoot: APP_ROOT,
      RESOURCES,
      SERVER_ENTRY,
      serverExists: fs.existsSync(SERVER_ENTRY),
      DATA_DIR,
      userData: app.getPath('userData'),
      electron: process.versions.electron,
      node: process.versions.node,
      argv: process.argv,
    };
  } catch (e) {
    /* ignore */
  }
  log('应用启动');
  log(`resources=${RESOURCES}`);
  try {
    await createWindow();
  } catch (e) {
    log(`启动失败: ${e}`);
    dialog.showErrorBox('漫客工作台启动失败', String(e));
    app.quit();
    return;
  }
  createTray();
});

app.on('window-all-closed', () => {
  if (!tray) app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  stopComfyUI();
});

app.on('activate', () => {
  if (!mainWindow) void createWindow();
});