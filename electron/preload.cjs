// 渲染层 ↔ 主进程的桥。
//
// 只暴露白名单方法，不把 ipcRenderer 整个丢过去 —— 页面里跑的是工作台自己的
// 前端代码，但它终究是 web 内容，能力越窄越好。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mankeDesktop', {
  isDesktop: true,

  info: () => ipcRenderer.invoke('app:info'),

  comfy: {
    status: () => ipcRenderer.invoke('comfy:status'),
    start: () => ipcRenderer.invoke('comfy:start'),
    stop: () => ipcRenderer.invoke('comfy:stop'),
    pickRoot: () => ipcRenderer.invoke('comfy:pickRoot'),
  },

  openLogs: () => ipcRenderer.invoke('app:openLogs'),
  quit: () => ipcRenderer.invoke('app:quit'),
});
