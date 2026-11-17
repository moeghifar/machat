// Account page: the __mc bridge (fire-and-forget to main), then the inject scripts in the main world
// before page scripts run. The script source comes from main, never from the page.
const { contextBridge, ipcRenderer, webFrame } = require('electron');
contextBridge.exposeInMainWorld('__mc', (json) => ipcRenderer.send('mc:page', String(json)));
// Copies made in the page (keyboard, menu, the page's own Copy buttons via execCommand) feed the clipboard history.
for (const t of ['copy', 'cut']) addEventListener(t, () => ipcRenderer.send('mc:copied'), true);
const src = ipcRenderer.sendSync('mc:init');
if (src) webFrame.executeJavaScript(src);
