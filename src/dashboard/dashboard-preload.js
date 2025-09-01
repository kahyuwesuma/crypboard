const path = require('path');
const { formatPrice } = require(path.join(__dirname, '../shared/utils/helper.js'));
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashboardAPI', {
  navigate: (target) => ipcRenderer.send('navigate', target),
  getActiveExchange: () => ipcRenderer.invoke('dashboard:get-active-exchange'),
  sessionCheck: () => ipcRenderer.invoke('dashboard:session-check', {}),
  clearToken: () => ipcRenderer.invoke('dashboard:logout', {})
});

contextBridge.exposeInMainWorld('utils', {
  formatPrice
});
contextBridge.exposeInMainWorld('indodaxAPI', {
  onHeaderData: (callback) => ipcRenderer.on('header-data', (_, data) => callback(data)),
  onNetworkData: (callback) => ipcRenderer.on('network-data', (_, data) => callback(data))
});

contextBridge.exposeInMainWorld('electron', {
  send: (channel, data) => ipcRenderer.send(channel, data),
  receive: (channel, func) => ipcRenderer.on(channel, (event, ...args) => func(...args)),
});

contextBridge.exposeInMainWorld('marketAPI', {
  onExchangeUpdate: (exchangeName, cb) => {
    ipcRenderer.on(`${exchangeName}-price-update`, (_, data) => cb(data));
  },
});
