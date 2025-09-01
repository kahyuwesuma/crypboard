const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashboardAPI', {
  navigate: (target) => ipcRenderer.send('navigate', target),
  clearToken: () => ipcRenderer.invoke('management:logout', {}),
  sessionCheck: () => ipcRenderer.invoke('management:session-check', {})
});

contextBridge.exposeInMainWorld('managementAPI', {
	getAllSymbols: () => ipcRenderer.invoke('management:get-all-symbol'),
	addSymbol: (symbol) => ipcRenderer.invoke('management:add-symbol', symbol),
	updateSymbol: (oldSymbol, newSymbol) => ipcRenderer.invoke('management:update-symbol', oldSymbol, newSymbol),
	removeSymbol: (symbol) => ipcRenderer.invoke('management:delete-symbol', symbol),
	getAllExchange: () => ipcRenderer.invoke('management:get-all-exchange'),
	updateExchange: (oldExchange, newExchange) => ipcRenderer.invoke('management:update-exchange', oldExchange, newExchange),
	getActiveExchange: () => ipcRenderer.invoke('management:get-active-exchange'),
	getAllL2: () => ipcRenderer.invoke('management:get-all-l2'),
	updateL2: (exchangeName, exchangeCombined) => ipcRenderer.invoke('management:update-l2', exchangeName,exchangeCombined),
	getMexcApiKey: () => ipcRenderer.invoke('management:get-mexc-api-key'),
	updateMexcApiKey: (newApiKey) => ipcRenderer.invoke('management:update-mexc-api-key', newApiKey),
	updateUserPassword: (oldPassword, newPassword) => ipcRenderer.invoke('management:update-user-password', oldPassword, newPassword)
});
