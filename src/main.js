const { app, ipcMain } = require('electron');
const { initializeDashboard, createDashboardWindow } = require('./dashboard/dashboard-main');
const { initializeManagement, createManagementWindow } = require('./management/management-main');
const { createL2orderbookWindow, initializeL2orderbook } = require('./l2orderbook/l2orderbook-main')
const { createAuthWindow } = require('./auth/auth-main'); // file auth kamu

let currentWindow = null; // simpan window aktif

async function startApp() {
    currentWindow = createAuthWindow();
    // initializeManagement(currentWindow);
}

ipcMain.on('navigate', (event, target) => {
  if (currentWindow) {
    currentWindow.close();
    currentWindow = null;
  }

  if (target === 'dashboard') {
    currentWindow = createDashboardWindow();
    initializeDashboard(currentWindow);
  } else if (target === 'l2orderbook') {
    currentWindow = createL2orderbookWindow()
    initializeL2orderbook(currentWindow);
  }
  else if (target === 'manajemen') {
    currentWindow = createManagementWindow();
    initializeManagement(currentWindow);
  }
  else if (target === 'loginPage') {
    currentWindow = createAuthWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.whenReady().then(startApp);
