const { ipcMain, BrowserWindow } = require('electron')
const { allSymbols, allExchange, displayExchange } = require('../shared/utils/helper')
const path = require('path')
const fs = require('fs');

const symbolsFile = path.join(__dirname, '../storage/symbols.json');
const symbols = allSymbols();

const exchangeFile = path.join(__dirname, '../storage/exchange.json');
const exchange = allExchange();

let win;

function initializeManagement() {
	ipcMain.removeHandler('management:get-all-symbol');
	ipcMain.removeHandler('management:add-symbol');
	ipcMain.removeHandler('management:update-symbol');
	ipcMain.removeHandler('management:delete-symbol');
	ipcMain.removeHandler('management:get-all-exchange');
	ipcMain.removeHandler('management:update-exchange');
	ipcMain.removeHandler('management:get-active-exchange');

	ipcMain.handle('management:get-all-symbol', () => {
		return symbols;
	});

	ipcMain.handle('management:add-symbol', (event, symbol) => {
	  if (symbols.find(s => s.symbol === symbol)) {
	    return { success: false, message: 'Symbol already exists' };
	  }

	symbols.unshift({ symbol, active: false });

	  // Simpan ke file JSON
	  try {
	    fs.writeFileSync(symbolsFile, JSON.stringify(symbols, null, 2));
	    console.log(`Berhasil menambahkan symbol: ${symbol}`);
	    return { message: `Berhasil menambahkan symbol: ${symbol}`,success: true, data: symbols };
	  } catch (err) {
	    console.warn('Failed to save symbols.json', err);
	    return { success: false, message: 'Gaga menambahkan symbol', error: err };
	  }
	});

	ipcMain.handle('management:update-symbol', (event, updatedSymbol) => {
	  // updatedSymbol bisa { symbol: 'BTCUSDT', active: true } atau { symbol: 'BTCUSDT', newSymbol: 'ETHUSDT' }
	  console.log(updatedSymbol)
	  const index = symbols.findIndex(s => s.symbol === updatedSymbol.symbol);
	  if (index === -1) {
	    return { success: false, message: 'Symbol tidak ditemukan' };
	  }

	  // Update hanya active jika properti active ada
	  if (typeof updatedSymbol.active === 'boolean') {
	    symbols[index].active = updatedSymbol.active;
	  }

	  // Update symbol jika properti newSymbol ada dan beda dari sebelumnya
	  if (updatedSymbol.newSymbol && updatedSymbol.newSymbol !== updatedSymbol.symbol) {
	    // Cek duplikasi
	    if (symbols.find(s => s.symbol === updatedSymbol.newSymbol)) {
	      return { success: false, message: 'Symbol sudah ada' };
	    }
	    symbols[index].symbol = updatedSymbol.newSymbol;
	  }

	  // Simpan ke JSON dan sort alphabet berdasarkan symbol
	  // symbols.sort((a, b) => a.symbol.localeCompare(b.symbol));

	  try {
	    fs.writeFileSync(symbolsFile, JSON.stringify(symbols, null, 2));
	    console.log(`Berhasil update symbol: ${updatedSymbol.symbol}`);
	    return { message:`Berhasil update symbol: ${updatedSymbol.symbol}`, success: true, data: symbols };
	  } catch (err) {
	    console.warn('Failed to save symbols.json', err);
	    return { success: false, message: 'Failed to save file', error: err };
	  }
	});

	ipcMain.handle('management:delete-symbol', (event, symbol) => {
	  // Cari index symbol yang ingin dihapus
	  const index = symbols.findIndex(s => s.symbol === symbol);
	  if (index === -1) {
	    return { success: false, message: 'Symbol not found' };
	  }

	  // Hapus objek symbol
	  symbols.splice(index, 1);

	  // Simpan kembali ke file JSON
	  try {
	    fs.writeFileSync(symbolsFile, JSON.stringify(symbols, null, 2));
	    console.log(`Berhasil menghapus symbol: ${symbol}`);
	    return { message:`Berhasil menghapus symbol: ${symbol}`, success: true, data: symbols };
	  } catch (err) {
	    console.warn('Failed to save symbols.json', err);
	    return { success: false, message: 'Gagal menghapus symbol', error: err };
	  }
	});

	ipcMain.handle('management:get-all-exchange', () => {
		return exchange;
	});

	ipcMain.handle('management:update-exchange', (event, updatedExchange) => {

	  const index = exchange.findIndex(s => s.name === updatedExchange.name);
	  if (index === -1) {
	    return { success: false, message: 'Exchange tidak ditemukan' };
	  }

	  // Update hanya active jika properti active ada
	  if (typeof updatedExchange.active === 'boolean') {
	    exchange[index].active = updatedExchange.active;
	  }

	  try {
	    fs.writeFileSync(exchangeFile, JSON.stringify(exchange, null, 2));
	    console.log(`Berhasil update exchange: ${updatedExchange.name}`);
	    return { message:`Berhasil update exchange: ${updatedExchange.name}`, success: true, data: exchange };
	  } catch (err) {
	    console.warn('Failed to save exchange.json', err);
	    return { success: false, message: 'Failed to save file', error: err };
	  }
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
	win.maximize()
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