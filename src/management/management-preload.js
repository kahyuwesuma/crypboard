const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashboardAPI', {
  navigate: (target) => ipcRenderer.send('navigate', target)
});

contextBridge.exposeInMainWorld('managementAPI', {
	getAllSymbols: () => ipcRenderer.invoke('management:get-all-symbol'),
	addSymbol: (symbol) => ipcRenderer.invoke('management:add-symbol', symbol),
	updateSymbol: (oldSymbol, newSymbol) => ipcRenderer.invoke('management:update-symbol', oldSymbol, newSymbol),
	removeSymbol: (symbol) => ipcRenderer.invoke('management:delete-symbol', symbol),
	getAllExchange: () => ipcRenderer.invoke('management:get-all-exchange'),
	updateExchange: (oldExchange, newExchange) => ipcRenderer.invoke('management:update-exchange', oldExchange, newExchange),
	getActiveExchange: () => ipcRenderer.invoke('management:get-active-exchange'),
});
