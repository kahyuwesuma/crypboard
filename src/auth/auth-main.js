const path = require('path')
const { ipcMain, BrowserWindow } = require('electron')
const { createToken } = require('../core/middleware')
const { userData } = require('../shared/utils/helper')
const users = [
    { username: 'admin', password: '12345', name: 'Administrator' },
    { username: 'wahyu', password: 'password', name: 'Wahyu Kesuma' }
];
function login(username, password) {
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        const token = createToken(user);
        return { success: true, message: `Welcome, ${user.name}!`,token };
    } else {
        return { success: false, message: 'Invalid username or password.' };
    }	
}

ipcMain.handle('auth:login', async (event, credentials) => {
    return login(credentials.username, credentials.password);
});


function createAuthWindow() {
	win = new BrowserWindow({
		width: 1200,
		height: 900,
		webPreferences: {
			nodeIntegration: false,
			preload: path.join(__dirname, 'auth-preload.js'),
			zoomFactor: 1.0,
			sandbox: false ,
			contextIsolation: true
		},
	})
	win.loadFile('src/auth/auth-page.html')
	return win
}

module.exports = {
	createAuthWindow
}