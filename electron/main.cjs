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

// ── IPC
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  dataDir: DATA_DIR,
  serverUrl,
  resources: RESOURCES,
  packaged: app.isPackaged,
}));

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

// ── 生命周期
app.whenReady().then(async () => {
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