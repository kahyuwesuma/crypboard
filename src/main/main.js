const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const authService = require('../service/authService');

let win; 

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // preload optional
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));

}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('login', async (event, { email, password }) => {
  try {
    const data = await authService.login(email, password);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
