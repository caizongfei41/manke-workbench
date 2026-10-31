// 渲染层 ↔ 主进程的桥。
//
// 只暴露白名单方法，不把 ipcRenderer 整个丢过去 —— 页面里跑的是工作台自己的
// 前端代码，但它终究是 web 内容，能力越窄越好。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mankeDesktop', {
  isDesktop: true,

  info: () => ipcRenderer.invoke('app:info'),

  onboarding: {
    state: () => ipcRenderer.invoke('onboarding:state'),
    complete: () => ipcRenderer.invoke('onboarding:complete'),
    reset: () => ipcRenderer.invoke('onboarding:reset'),
  },

  env: {
    check: () => ipcRenderer.invoke('env:check'),
  },

  bundle: {
    guess: () => ipcRenderer.invoke('bundle:guess'),
    inspect: (dir) => ipcRenderer.invoke('bundle:inspect', dir),
    pickDir: () => ipcRenderer.invoke('bundle:pickDir'),
    pickTarget: () => ipcRenderer.invoke('bundle:pickTarget'),
    extract: (payload) => ipcRenderer.invoke('bundle:extract', payload),
    deploy: (payload) => ipcRenderer.invoke('bundle:deploy', payload),
    freeSpace: (dir) => ipcRenderer.invoke('bundle:freeSpace', dir),
    onProgress: (handler) => {
      const listener = (_event, data) => handler(data);
      ipcRenderer.on('bundle:progress', listener);
      return () => ipcRenderer.removeListener('bundle:progress', listener);
    },
  },

  comfy: {
    status: () => ipcRenderer.invoke('comfy:status'),
    start: () => ipcRenderer.invoke('comfy:start'),
    stop: () => ipcRenderer.invoke('comfy:stop'),
    pickRoot: () => ipcRenderer.invoke('comfy:pickRoot'),
  },

  openLogs: () => ipcRenderer.invoke('app:openLogs'),
  quit: () => ipcRenderer.invoke('app:quit'),
});
