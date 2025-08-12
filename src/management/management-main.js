const path = require('path')
const { ipcMain, BrowserWindow } = require('electron')
const { targetSymbols } = require('../core/config')

let win;
function initializeManagement() {
	ipcMain.removeHandler('management:get-all');
	ipcMain.removeHandler('management:add');
	ipcMain.removeHandler('management:update');
	ipcMain.removeHandler('management:delete');
	ipcMain.handle('management:get-all', () => {
		return targetSymbols;
	});

	ipcMain.handle('management:add', (event, symbol) => {
		if (!symbol || typeof symbol !== 'string') {
			return { success: false, message: 'Invalid symbol' };
		}
		if (targetSymbols.includes(symbol)) {
			return { success: false, message: 'Symbol already exists' };
		}
		targetSymbols.push(symbol);
		return { success: true, data: targetSymbols };
	});

	ipcMain.handle('management:update', (event, oldSymbol, newSymbol) => {
		const index = targetSymbols.indexOf(oldSymbol);
		if (index === -1) {
			return { success: false, message: 'Old symbol not found' };
		}
		if (targetSymbols.includes(newSymbol)) {
			return { success: false, message: 'New symbol already exists' };
		}
		targetSymbols[index] = newSymbol;
		return { success: true, data: targetSymbols };
	});

	ipcMain.handle('management:delete', (event, symbol) => {
		const index = targetSymbols.indexOf(symbol);
		if (index === -1) {
			return { success: false, message: 'Symbol not found' };
		}
		targetSymbols.splice(index, 1);
		return { success: true, data: targetSymbols };
	});
}

function createManagementWindow() {
	win = new BrowserWindow({
		width: 1200,
		height: 900,
		webPreferences: {
			nodeIntegration: false,
			preload: path.join(__dirname, 'management-preload.js'),
			zoomFactor: 1.0,
			sandbox: false ,
			contextIsolation: true
		},
	})
    win.on('closed', () => {
	    win = null;
    });
	win.loadFile('src/management/management-page.html')
	return win
}

module.exports = {
	initializeManagement,
	createManagementWindow
}