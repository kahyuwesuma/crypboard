import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('authAPI', {
    login: (username, password) => ipcRenderer.invoke('auth:login', { username, password })
});
