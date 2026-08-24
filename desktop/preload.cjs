const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sovereignMailDesktop", {
  configureServer: (serverUrl) => ipcRenderer.invoke("desktop:configure-server", serverUrl),
  getState: () => ipcRenderer.invoke("desktop:get-state")
});
