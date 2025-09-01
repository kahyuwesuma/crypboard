const path = require('path')
const { ipcMain, BrowserWindow } = require('electron')
const { createToken, tokenCheck, clearToken } = require('../core/middleware')
const { userData } = require('../shared/utils/helper')



function getUserData(){
	const data = userData()
	return data
}

async function login(username, password) {
	const data = await getUserData()
    const user = data.find(u => u.username === username && u.password === password);

    if (user) {
        const token = createToken(user);
		if (token){
			return { success: true };
		}
		else {
			return { success: false, message: `Error creating token`};
		}
    } else {
        return { success: false, message: 'Invalid username or password.' };
    }	
}



// Handler API
ipcMain.handle('auth:login', async (event, credentials) => {
    return login(credentials.username, credentials.password);
});

ipcMain.handle('auth:session-check', async (event) => {
    return tokenCheck();
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
	win.maximize()

	win.loadFile('src/auth/auth-page.html')
	return win
}

module.exports = {
	createAuthWindow
}