// Shell bridge: one invoke channel and main->shell events (names without the mc: prefix).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('machat', {
  invoke: (cmd, args) => ipcRenderer.invoke('mc', String(cmd), args ?? {}),
  on: (name, fn) => {
    const h = (_e, v) => fn(v);
    ipcRenderer.on('mc:' + name, h);
    return () => ipcRenderer.removeListener('mc:' + name, h);
  },
});
