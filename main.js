const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const authService = require('./src/service/authService');

function createWindow() {
    const win = new BrowserWindow({
        width: 400,
        height: 500,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        }
    });

    win.loadFile('./src/index.html');
}

app.whenReady().then(createWindow);

ipcMain.handle('auth:login', async (event, credentials) => {
    return authService.login(credentials.username, credentials.password);
});
