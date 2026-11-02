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
const { createStore } = require('./deploy-state.cjs');
const { inspectModules, extractModule } = require('./modules.cjs');
const { initUpdater, checkForUpdates, quitAndInstall, getUpdateState } = require('./updater.cjs');

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
/** 隐藏到托盘时只提示一次，避免每次关窗口都弹气泡。 */
let trayHintShown = false;

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

/** 同步睡眠。只在启动路径上用，主线程卡几百毫秒可接受。 */
const sleepSync = (ms) => {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* 极端环境下的忙等兜底 */
    }
  }
};

/** 端口是不是有人监听（同步版，用于启动流程里的短暂等待）。 */
const portBusy = (port) => {
  try {
    const out = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `(Get-NetTCPConnection -State Listen -LocalPort ${port} -EA SilentlyContinue | Measure-Object).Count`,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 }
    );
    return Number(String(out.stdout ?? '').trim()) > 0;
  } catch {
    return false;
  }
};

/** 占用某端口的进程 PID 列表。 */
const comfyPidsOnPort = (port) => {
  try {
    const out = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `@(Get-NetTCPConnection -State Listen -LocalPort ${port} -EA SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) -join ','`,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 }
    );
    return String(out.stdout ?? '')
      .trim()
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
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

/**
 * 8188 上占着的 ComfyUI 如果是个孤儿进程，杀掉等它让开。
 *
 * 判据是「它是不是本实例 spawn 出来的」：comfyProcess 只记当前会话启动的那个。
 * 如果端口有人占着而 comfyProcess 是空的，那就是别的来源 —— 上一次工作台没
 * 清理干净的残留。这种进程的 stdout 已经断了，复用只会让所有生成任务失败。
 *
 * 返回 null 表示「不用重启，继续复用」。返回对象表示已经处理过（重启了或
 * 处理失败），调用方直接把它当结果返回。
 */
const restartOrphanedComfy = () => {
  // 本实例启动的进程还活着，不用管
  if (comfyProcess && !comfyProcess.killed) return null;

  const pids = comfyPidsOnPort(8188);
  if (pids.length === 0) return null; // 查不到具体进程，保守起见不动它

  log(`8188 被非本实例启动的 ComfyUI 占用（PID ${pids.join(', ')}），重启以恢复日志管道`);
  for (const pid of pids) {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* 进程可能刚退出 */
    }
  }

  // 等端口让开，最多 15 秒
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (!portBusy(8188)) return { ok: true, message: '已重启此前残留的 ComfyUI' };
    sleepSync(500);
  }
  return { ok: false, message: '8188 被其他程序占用，无法启动 ComfyUI' };
};

/**
 * 把随程序分发的节点包补齐到 ComfyUI/custom_nodes。
 *
 * resources/nodes 里是 75 个节点包的完整副本。已经存在的目录跳过 —— 用户
 * 可能自己 git pull 更新过，不能被旧的覆盖回去。只补缺的。
 */
const ensureBundledNodes = (comfyDir) => {
  const src = path.join(RESOURCES, 'nodes');
  const dest = path.join(comfyDir, 'custom_nodes');
  if (!fs.existsSync(src)) return { copied: 0, dest };

  fs.mkdirSync(dest, { recursive: true });
  let copied = 0;

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const to = path.join(dest, entry.name);
    if (fs.existsSync(to)) continue; // 已有就保留用户那份
    try {
      fs.cpSync(path.join(src, entry.name), to, { recursive: true });
      copied += 1;
    } catch (e) {
      log(`  节点 ${entry.name} 拷贝失败: ${e.message}`);
    }
  }
  return { copied, dest };
};

const startComfyUI = async () => {
  if (comfyProcess && !comfyProcess.killed) {
    return { ok: true, message: 'ComfyUI 已在运行' };
  }
  if (await isPortOpen(8188)) {
    // 端口上已经有 ComfyUI，但不代表它「能用」。
    //
    // 最常见的情况：上次工作台退出时没把子进程带走，ComfyUI 变成孤儿继续
    // 跑着。它的 stdout 管道早就断了，采样器每写一次进度日志就抛
    // OSError [Errno 22]，任务全部失败 —— 界面上只显示一句 "ComfyUI task
    // failed"，用户根本查不出原因。
    //
    // 所以端口开着也不能无脑复用：先看那个进程是不是本实例的直系子进程，
    // 不是就杀掉重启，让 stdout 重新挂上。
    const adopted = restartOrphanedComfy();
    if (adopted) return adopted;
    // 节点补齐也要在「复用已有实例」这条路上跑一遍 —— 用户可能删过节点，
    // 而 ComfyUI 一直在跑没重启，走不到下面那段。
    const reuseTarget = resolveComfy();
    if (reuseTarget) {
      try {
        const r = ensureBundledNodes(reuseTarget.workDir);
        if (r.copied > 0) log(`节点包: 复用实例时补齐 ${r.copied} 个`);
      } catch {
        /* 补不上也不影响已运行的实例 */
      }
    }
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

  // 节点包随程序分发，启动前落到 custom_nodes 下。
  //
  // 75 个节点决定这个工作台能干哪些事，属于产品能力 —— 用户不该等下载完
  // 部署包才看到。节点是 Python 包，必须在磁盘上才能 import，asar 里加载
  // 不了，所以每次启动都检查一遍：磁盘上已有的不覆盖（用户可能改过），
  // 缺的才补。
  try {
    const nodesResult = ensureBundledNodes(target.workDir);
    if (nodesResult.copied > 0) {
      log(`节点包: 补齐 ${nodesResult.copied} 个到 ${nodesResult.dest}`);
    }
  } catch (e) {
    log(`节点包部署失败: ${e.message}`);
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

  // 节点包随程序分发，开机就补齐，不等用户点「启动 ComfyUI」。
  //
  // 75 个节点是产品能力的一部分：用户装完 exe 解完 Python 就想要完整功能，
  // 不该因为还没启动过 ComfyUI 而缺节点。放在这里还有个好处 —— ComfyUI
  // 首次启动时节点已经在位，不用再多等一轮扫描。
  {
    const target = resolveComfy();
    if (target) {
      try {
        const r = ensureBundledNodes(target.workDir);
        log(`节点包: ${r.copied > 0 ? `补齐 ${r.copied} 个` : '已齐全'}（${r.dest}）`);
      } catch (e) {
        log(`节点包部署失败: ${e.message}`);
      }
    } else {
      log('节点包: 尚未指定 ComfyUI 位置，等用户选目录后再补');
    }
  }

  const port = await pickPort(3020);

  process.env.BEATDESIGN_DATA_DIR = DATA_DIR;
  process.env.BEATDESIGN_COMFYUI_HOME = readComfyConfig().root || '';
  // 服务端有些旧 API（部署、环境自检、LLM 配置）会在 ROOT/scripts 下找 .mjs
  // 脚本跑。默认 ROOT 是 process.cwd()，桌面版启动时的 cwd 是安装目录，那里
  // 没有 scripts/ —— 于是控制台一直报 "Missing .../scripts/deploy-bundle.mjs"。
  // 打包时 scripts/ 已经放进 resources，这里把 ROOT 指过去。
  process.env.BEATDESIGN_ROOT = RESOURCES;
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

  // 点关闭按钮时隐藏窗口而不是销毁。
  //
  // 销毁再重建要重新加载整个界面和服务，慢两三秒；隐藏是瞬时的。代价是
  // 进程留在托盘里 —— 这正是用户点「X」时期望的：程序还在，随时叫回来。
  // 真正退出走托盘菜单的「退出」。
  mainWindow.on('close', (event) => {
    if (quitting) return; // 用户点的是「退出」，放行
    event.preventDefault();
    mainWindow.hide();
    // 第一次隐藏时提示一次，不然用户以为程序被自己关了
    if (!trayHintShown) {
      trayHintShown = true;
      try {
        tray?.displayBalloon?.({
          title: '漫客工作台还在运行',
          content: '点托盘图标可以重新打开，右键有「退出」。',
        });
      } catch {
        /* 部分系统不支持气泡提示 */
      }
    }
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

/**
 * 把主窗口叫回来。
 *
 * 三种情况都要覆盖：
 *   · 窗口还在，只是被 hide 了 —— show + focus
 *   · 窗口还在，但被最小化了 —— restore 之后再 show
 *   · 窗口已经销毁 —— 重新建一个
 *
 * 之前托盘只绑了 double-click，而且直接调 mainWindow.show()：窗口销毁后
 * 那个引用指向的是死对象，show() 什么也不做，用户就以为「点不开」。
 */
const showMainWindow = () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = null;
  void createWindow();
};

const createTray = () => {
  try {
    tray = new Tray(path.join(RESOURCES, 'icon.ico'));
    tray.setToolTip('漫客工作台');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '显示主窗口',
          click: () => showMainWindow(),
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
    // 单击就响应。Windows 用户习惯点一下图标，双击是次要路径。
    tray.on('click', () => showMainWindow());
    tray.on('double-click', () => showMainWindow());
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

// ── 更新
//
// 界面读 state 显示进度条；点按钮时主动查一次；ready 之后能重启安装。
ipcMain.handle('update:state', () => getUpdateState());
ipcMain.handle('update:check', async () => checkForUpdates());
ipcMain.handle('update:install', () => {
  quitting = true;
  return quitAndInstall();
});

// ── 部署包
//
// 新机器上最费时的一步：把 ComfyUI 和模型放到该去的地方。
// 9 个包放哪都行，检查时让用户选；解压完直接把结果记进 ComfyUI 配置。
const bundlePaths = () => {
  const downloads = app.getPath('downloads');
  const guesses = [
    // 夸克网盘默认下载到 Downloads\manke-bundles\
    path.join(downloads, 'manke-bundles'),
    path.join(downloads, 'manke'),
    // 用户可能直接解压到桌面
    path.join(app.getPath('desktop'), 'manke-bundles'),
    // 程序旁边的 deploy/
    path.join(RESOURCES, 'deploy'),
    path.join(path.dirname(RESOURCES), 'deploy'),
    // 用户数据目录
    path.join(app.getPath('userData'), 'deploy'),
    downloads,
  ];
  const seen = new Set();
  return guesses.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
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
//
// 状态全程落盘（deploy-state.json），所以断电、关机、程序崩溃之后重开，
// 界面能拿回来接着跑，而不是让用户再等一小时。
const runDeploy = async ({ dir, targetDir, resumed = false }) => {
  const store = createStore(DATA_DIR);
  const send = (p) => {
    try {
      mainWindow?.webContents.send('bundle:progress', p);
    } catch {
      /* 窗口关了就算了 */
    }
  };

  // 先探一遍分卷，拿到总量和卷数写进状态
  const inspected = inspectBundle(dir);
  if (!inspected.ok) {
    // Nothing was written yet, so fail() has no state to mark. Seed one first.
    store.start({
      bundleDir: dir,
      firstVolume: '',
      targetDir,
      totalBytes: 0,
      volumes: 0,
    });
    store.fail(inspected.message);
    return { ok: false, comfyRoot: null, message: inspected.message };
  }

  // 状态文件可能被清掉或者坏了 —— update 会返回 null。这种情况下用 start
  // 重新建一份，否则后面所有 update/finish 都是空操作，状态永远对不上。
  let state = resumed ? store.update({ phase: 'extract', message: '恢复中…' }) : null;
  if (!state) {
    state = store.start({
      bundleDir: dir,
      firstVolume: inspected.firstVolume,
      targetDir,
      totalBytes: inspected.totalBytes,
      volumes: inspected.volumes,
    });
  }

  log(`一键部署${resumed ? '（恢复）' : ''}：${dir} → ${targetDir}`);

  const result = await deployBundle({
    dir,
    targetDir,
    resources: RESOURCES,
    onProgress: (p) => {
      store.update({ phase: p.phase, percent: p.percent, message: p.message ?? '' });
      send(p);
    },
  });

  if (!result.ok) {
    log(`一键部署失败：${result.message}`);
    store.fail(result.message);
    return result;
  }

  // 写配置
  store.update({ phase: 'configure', percent: 100, message: '写入配置…' });
  const root = result.comfyRoot;
  const py = path.join(root, 'python_embeded', 'python.exe');
  if (fs.existsSync(py)) {
    writeComfyConfig(root, py);
    log(`ComfyUI 已指向 ${root}`);
  }

  // 到这儿文件全部就位，部署本身已经成功。
  //
  // 先把状态封成 done，再去起 ComfyUI：启动最长要等 180 秒（首次加载模型），
  // 如果把它算进部署状态，界面会在这三分钟里一直显示「部署中」，用户以为
  // 卡死了；中途关窗口还会让状态停在 start，下次打开误报「上次没做完」。
  store.finish();

  // 顺手把 ComfyUI 起起来 —— 用户点完这个按钮就该能直接生成
  send({ phase: 'start', percent: 100, message: '启动 ComfyUI…' });
  const started = await startComfyUI();
  log(`自动启动 ComfyUI: ${started.message}`);

  if (!started.ok) {
    return {
      ok: true,
      comfyRoot: root,
      comfyStarted: false,
      message: `部署完成，但 ComfyUI 没起来：${started.message}`,
    };
  }

  return {
    ok: true,
    comfyRoot: root,
    comfyStarted: true,
    message: `部署完成，ComfyUI 已就绪。${result.message}`,
  };
};

ipcMain.handle('bundle:deploy', (_e, { dir, targetDir }) => runDeploy({ dir, targetDir }));

// 上次部署中断了？告诉界面，好提示「继续」。
ipcMain.handle('bundle:resumable', () => {
  const store = createStore(DATA_DIR);
  return store.resumable();
});

// 继续上次的部署。走的是同一套流程，只是 7z 带着 -aos 会跳过已解出的文件。
ipcMain.handle('bundle:resume', () => {
  const store = createStore(DATA_DIR);
  const pending = store.resumable();
  if (!pending) return { ok: false, message: '没有可恢复的部署' };
  return runDeploy({
    dir: pending.bundleDir,
    targetDir: pending.targetDir,
    resumed: true,
  });
});

// 放弃恢复，清掉状态（目标目录里的文件不动）
ipcMain.handle('bundle:discard', () => {
  const store = createStore(DATA_DIR);
  store.clear();
  return { ok: true };
});

// 当前部署状态，界面用来画进度条和阶段
ipcMain.handle('bundle:state', () => createStore(DATA_DIR).read());

// 目标盘的可用空间，界面上用来提示够不够
ipcMain.handle('bundle:freeSpace', (_e, dir) => ({ free: freeSpaceOf(dir) }));

// ── 模块化部署
//
// 部署包按模型拆成 9 个独立 7z，每解完一个就能删。工作台负责：读 manifest、
// 看哪些已解、解下一个、标记完成。磁盘峰值只有最大单包的大小。
ipcMain.handle('modules:manifest', () => {
  // manifest 随程序分发（打包时从 dist-bundles 复制进 resources）
  const local = path.join(RESOURCES, 'bundles', 'manifest.json');
  try {
    return JSON.parse(fs.readFileSync(local, "utf8"));
  } catch {
    return null;
  }
});

ipcMain.handle('modules:inspect', (_e, { targetDir, manifest }) =>
  inspectModules(targetDir, manifest ?? readBundlesManifest())
);

ipcMain.handle('modules:locate', (_e, partId) => {
  // 用户把包下载到哪了？按常见目录找一遍
  const manifest = readBundlesManifest();
  const part = manifest?.parts?.find((p) => p.id === partId);
  if (!part) return { ok: false, message: "manifest 里没有这个包" };
  const dirs = bundlePaths();
  for (const dir of dirs) {
    const candidate = path.join(dir, part.file);
    if (fs.existsSync(candidate)) return { ok: true, archive: candidate, part };
  }
  return { ok: false, part, message: `没找到 ${part.file}` };
});

ipcMain.handle('modules:extractOne', async (_e, { partId, targetDir }) => {
  const manifest = readBundlesManifest();
  const part = manifest?.parts?.find((p) => p.id === partId);
  if (!part) return { ok: false, message: "manifest 里没有这个包" };

  const locate = await new Promise((resolve) => {
    const dirs = bundlePaths();
    for (const dir of dirs) {
      const candidate = path.join(dir, part.file);
      if (fs.existsSync(candidate)) return resolve({ ok: true, archive: candidate });
    }
    resolve({ ok: false });
  });
  if (!locate.ok) return { ok: false, message: `没找到 ${part.file}` };

  const result = await extractModule({
    archive: locate.archive,
    targetDir,
    part,
    resources: RESOURCES,
    onProgress: (p) => {
      try {
        mainWindow?.webContents.send('modules:progress', { partId, ...p });
      } catch { /* 窗口关了 */ }
    },
  });

  // Python 和 ComfyUI 代码解开后，ComfyUI 就在 targetDir 下了
  if (result.ok && (partId === '01-python' || partId === '02-comfyui')) {
    const py = path.join(targetDir, 'python_embeded', 'python.exe');
    if (fs.existsSync(py)) {
      writeComfyConfig(targetDir, py);
      log(`ComfyUI 已指向 ${targetDir}`);
    }
  }
  return result;
});

// 读随程序分发的 manifest
function readBundlesManifest() {
  const local = path.join(RESOURCES, 'bundles', 'manifest.json');
  try {
    return JSON.parse(fs.readFileSync(local, "utf8"));
  } catch {
    return null;
  }
}


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

  // 更新：接好事件后延后检查，别和窗口启动抢时间。
  //
  // 延 10 秒是因为启动瞬间同时在起内置服务、解节点、拉 ComfyUI，
  // 再叠一个网络请求会让首屏更慢。检查失败（断网、GitHub 连不上）只记
  // 日志，不打扰用户 —— 更新是附加能力，不该影响正常使用。
  initUpdater({
    getWindow: () => mainWindow,
    log,
    isPackaged: app.isPackaged,
  });
  setTimeout(() => {
    if (!app.isPackaged) return;
    void checkForUpdates().then((r) => {
      log(`检查更新: ${r.ok ? (r.state?.message ?? '已发起') : r.message}`);
    });
  }, 10000);

  // 开机顺手把 ComfyUI 拉起来。
  //
  // 以前只有「一键部署」流程里才会启动它，用户装好程序打开一看右上角
  // 写着「ComfyUI 未连接」，得自己摸到控制台点按钮才知道怎么办 —— 大多数人
  // 会以为软件坏了。
  //
  // 这里延后几秒再起，让窗口先出来，用户能立刻看到界面。启动失败不弹窗、
  // 只记日志：没装 ComfyUI 的机器上这是正常情况，界面上会显示未连接。
  setTimeout(() => {
    void (async () => {
      try {
        const target = resolveComfy();
        if (!target) {
          log('自动启动 ComfyUI: 跳过（还没指定 ComfyUI 位置）');
          return;
        }
        // 端口上已经有 ComfyUI 时不重复启动，restartOrphanedComfy 会处理孤儿
        const r = await startComfyUI();
        log(`自动启动 ComfyUI: ${r.message}`);
      } catch (e) {
        log(`自动启动 ComfyUI 失败: ${e.message}`);
      }
    })();
  }, 3000);
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