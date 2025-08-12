const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashboardAPI', {
  navigate: (target) => ipcRenderer.send('navigate', target)
});

contextBridge.exposeInMainWorld('managementAPI', {
	getAll: () => ipcRenderer.invoke('management:get-all'),
	add: (symbol) => ipcRenderer.invoke('management:add', symbol),
	update: (oldSymbol, newSymbol) => ipcRenderer.invoke('management:update', oldSymbol, newSymbol),
	remove: (symbol) => ipcRenderer.invoke('management:delete', symbol)
});
