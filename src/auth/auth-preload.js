const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('navigate', {
  navigate: (target) => ipcRenderer.send('auth:success')
});
contextBridge.exposeInMainWorld('authAPI', {
    login: (username, password) => ipcRenderer.invoke('auth:login', { username, password })
});
