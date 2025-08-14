const { app, ipcMain } = require('electron');
const { initializeDashboard, createDashboardWindow } = require('../dashboard/dashboard-main');
const { initializeManagement, createManagementWindow } = require('../management/management-main');
const { createAuthWindow } = require('../auth/auth-main'); // file auth kamu

let currentWindow = null; // simpan window aktif

async function startApp() {
    currentWindow = createDashboardWindow();
    initializeDashboard(currentWindow);
}
// ipcMain.on('auth:success', () => {
//   if (currentWindow) {
//     currentWindow.close();
//     currentWindow = null;
//   }
//   currentWindow = createDashboardWindow();
//   initializeDashboard(currentWindow);
// });

ipcMain.on('navigate', (event, target) => {
  if (currentWindow) {
    currentWindow.close();
    currentWindow = null;
  }

  if (target === 'dashboard') {
    currentWindow = createDashboardWindow();
    initializeDashboard(currentWindow);
  } else if (target === 'manajemen') {
    currentWindow = createManagementWindow();
    initializeManagement(currentWindow);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.whenReady().then(startApp);
