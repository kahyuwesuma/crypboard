const path = require('path');
const { contextBridge, ipcRenderer } = require('electron');
const { formatPrice } = require(path.join(__dirname, '../shared/utils/helper.js'));

contextBridge.exposeInMainWorld('dashboardAPI', {
  navigate: (target) => ipcRenderer.send('navigate', target),
  getActiveExchange: () => ipcRenderer.invoke('l2orderbook:get-active-exchange'),
  getActiveFilter: () => ipcRenderer.invoke('l2orderbook:get-active-filter'),
  sessionCheck: () => ipcRenderer.invoke('l2-orderbook:session-check', {}),
  clearToken: () => ipcRenderer.invoke('l2orderbook:logout', {})
});

contextBridge.exposeInMainWorld('l2ElectronAPI', {
  onHeaderData: (callback) => ipcRenderer.on('header-data', (_, data) => callback(data)),
  sendOrderbookRequest: (channel, data) => ipcRenderer.send(channel, data),
  receiveOrderbookResponse: (channel, func) => ipcRenderer.on(channel, (event, ...args) => func(...args)),
  formatPrice
});

contextBridge.exposeInMainWorld('marketAPI', {
  onExchangeUpdate: (exchangeName, cb) => {
    ipcRenderer.on(`${exchangeName}-orderbook-update`, (_, data) => cb(data));
  },
});
