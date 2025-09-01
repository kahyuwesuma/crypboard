const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('success', {
  navigate: (target) => ipcRenderer.send('navigate', target)
});

contextBridge.exposeInMainWorld('authAPI', {
    navigate: (target) => ipcRenderer.send('navigate', target),
    login: (username, password) => ipcRenderer.invoke('auth:login', { username, password }),
    sessionCheck: () => ipcRenderer.invoke('auth:session-check', {})
});
