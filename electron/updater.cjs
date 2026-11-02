// 自动更新。
//
// 产品形态决定了这里的分量：exe 623 MB（节点包 855 MB 就占 93%），如果每次
// 发版都让用户重下整个包，一个改了文案的小版本也要传 600 MB。electron-updater
// 的差分更新按内容分块比对，只传变化的部分 —— 改界面通常十几 MB，改一个节点
// 也就几十 MB。
//
// 策略：启动后静默检查 → 有新版就在后台下载 → 下完才提示重启。
// 全程不打断用户，下载失败也不弹窗（网盘环境经常限速，弹窗只会烦人）。

const { app, dialog, BrowserWindow } = require('electron');

let autoUpdater = null;
let wired = false;

/** 更新的四个阶段，界面和托盘都读这个状态。 */
const state = {
  status: 'idle', // idle | checking | available | downloading | ready | error | disabled
  version: null,
  percent: 0,
  message: '',
};

/** 懒加载 electron-updater：开发环境下没有它也能起。 */
const loadUpdater = () => {
  if (autoUpdater !== null) return autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    autoUpdater = false;
    state.status = 'disabled';
    state.message = `更新组件不可用：${e && e.message}`;
  }
  return autoUpdater;
};

const broadcast = (getWindow) => {
  const win = getWindow?.() ?? BrowserWindow.getAllWindows()[0] ?? null;
  try {
    win?.webContents?.send('update:state', { ...state });
  } catch {
    /* 窗口可能已经关了 */
  }
};

/**
 * 接好更新事件。只接一次。
 *
 * @param {object} opts
 * @param {() => BrowserWindow|null} opts.getWindow 取主窗口（用来发事件）
 * @param {(msg: string) => void} opts.log 主进程日志
 * @param {boolean} opts.isPackaged 打包后的程序才检查更新
 */
const initUpdater = ({ getWindow, log, isPackaged }) => {
  if (wired) return state;
  wired = true;

  if (!isPackaged) {
    // 开发时跑的是源码，没有 latest.yml，检查必然失败 —— 直接停用
    state.status = 'disabled';
    state.message = '开发模式不检查更新';
    return state;
  }

  const up = loadUpdater();
  if (!up) {
    log?.(`更新不可用：${state.message}`);
    return state;
  }

  // 让 electron-updater 用我们自己的日志，别往控制台打
  up.logger = {
    info: (m) => log?.(`[更新] ${m}`),
    warn: (m) => log?.(`[更新] ${m}`),
    error: (m) => log?.(`[更新] ${m}`),
    debug: () => {},
  };

  // 后台静默下载：用户不需要点任何东西，下完才提示
  up.autoDownload = true;
  // 装完自动重启（用户点了「重启」之后就走这里）
  up.autoInstallOnAppQuit = true;

  up.on('checking-for-update', () => {
    state.status = 'checking';
    state.message = '正在检查更新…';
    broadcast(getWindow);
  });

  up.on('update-available', (info) => {
    state.status = 'downloading';
    state.version = info?.version ?? null;
    state.message = `发现新版本 ${info?.version ?? ''}，正在后台下载`;
    log?.(`发现新版本 ${info?.version}`);
    broadcast(getWindow);
  });

  up.on('update-not-available', () => {
    state.status = 'idle';
    state.message = '已是最新版本';
    broadcast(getWindow);
  });

  up.on('download-progress', (p) => {
    state.status = 'downloading';
    state.percent = Math.round(p?.percent ?? 0);
    const mb = (bytes) => (bytes / 1024 ** 2).toFixed(1);
    state.message = `正在下载 ${state.percent}%（${mb(p?.transferred ?? 0)} / ${mb(p?.total ?? 0)} MB）`;
    broadcast(getWindow);
  });

  up.on('update-downloaded', (info) => {
    state.status = 'ready';
    state.version = info?.version ?? state.version;
    state.percent = 100;
    state.message = `新版本 ${state.version} 已下载，重启后生效`;
    log?.(`新版本 ${state.version} 已下载`);
    broadcast(getWindow);

    // 提示一次。用户选「稍后」，下次启动时会自动装上（autoInstallOnAppQuit）
    const win = getWindow?.();
    dialog
      .showMessageBox(win ?? undefined, {
        type: 'info',
        title: '更新已就绪',
        message: `新版本 ${state.version} 已下载完成`,
        detail: '重启后生效。选择「稍后」的话，关闭程序时也会自动安装。',
        buttons: ['立即重启', '稍后'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((r) => {
        if (r.response === 0) quitAndInstall();
      })
      .catch(() => {
        /* 没有窗口就静默等下次启动 */
      });
  });

  up.on('error', (e) => {
    state.status = 'error';
    // 断网、GitHub 连不上都是常态，不弹窗、不打断使用
    state.message = `检查更新失败：${e?.message ?? e}`;
    log?.(`检查更新失败：${e?.message ?? e}`);
    broadcast(getWindow);
  });

  return state;
};

/** 主动检查一次。启动后调用，也可以由界面按钮触发。 */
const checkForUpdates = async () => {
  const up = loadUpdater();
  if (!up) return { ok: false, message: state.message || '更新组件不可用' };
  try {
    await up.checkForUpdates();
    return { ok: true, state: { ...state } };
  } catch (e) {
    return { ok: false, message: e?.message ?? String(e) };
  }
};

/** 退出并安装已下载的版本。 */
const quitAndInstall = () => {
  const up = loadUpdater();
  if (!up) return false;
  try {
    // isSilent=false 让安装向导走一个静默流程；isForceRunAfter=true 装完直接开
    up.quitAndInstall(false, true);
    return true;
  } catch {
    return false;
  }
};

module.exports = {
  initUpdater,
  checkForUpdates,
  quitAndInstall,
  getUpdateState: () => ({ ...state }),
};
