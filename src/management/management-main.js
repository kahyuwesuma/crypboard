const { ipcMain, BrowserWindow } = require('electron')
const { allSymbols, allExchange, allL2, getMexcAPI, userData } = require('../shared/utils/helper')
const { wsHandler } = require('../core/config')
const path = require('path')
const fs = require('fs');
const { tokenCheck, clearToken } = require('../core/middleware');

const symbolsFile = path.join(__dirname, '../storage/symbols.json');
const symbols = allSymbols();

const exchangeFile = path.join(__dirname, '../storage/exchange.json');
const exchange = allExchange();

const l2File = path.join(__dirname, '../storage/l2.json');
const l2 = allL2();

const mexcApiKeyFile = path.join(__dirname, '../storage/mexcApiKey.json');
const mexcApiKey = getMexcAPI();

const userFile = path.join(__dirname, '../storage/user.json');
const user = userData();

let win;

function initializeManagement() {
	wsHandler.forEach((h) => {
		if (typeof h.stopWS === 'function') {
			try {
			h.stopWS();

			// khusus binance, panggil stopBtcOnly juga
			if (h.name === 'binance' && typeof h.stopBtcOnly === 'function') {
				h.stopBtcOnly();
			}
			} catch (err) {
			console.error(`[stopWebsocket error]`, err);
			}
		}
	});

	ipcMain.removeHandler('management:get-all-symbol');
	ipcMain.removeHandler('management:add-symbol');
	ipcMain.removeHandler('management:update-symbol');
	ipcMain.removeHandler('management:delete-symbol');
	ipcMain.removeHandler('management:get-all-exchange');
	ipcMain.removeHandler('management:update-exchange');
	ipcMain.removeHandler('management:get-active-exchange');
	ipcMain.removeHandler('management:get-all-l2');
	ipcMain.removeHandler('management:update-l2');
	ipcMain.removeHandler('management:get-mexc-api-key');
	ipcMain.removeHandler('management:update-mexc-api-key');
	ipcMain.removeHandler('management:update-user-password');
	ipcMain.removeHandler('management:logout');

	ipcMain.handle('management:get-all-symbol', () => {
		return symbols;
	});


	ipcMain.handle('management:add-symbol', (event, symbol) => {
	  if (symbols.find(s => s.symbol === symbol)) {
	    return { success: false, message: 'Symbol already exists' };
	  }

	symbols.unshift({ symbol, active: false });

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

	ipcMain.handle('management:get-all-l2', () => {
		return l2;
	});
	ipcMain.handle("management:update-l2", (event, exchangeName, exchangeCombined) => {
		console.log("MAIN update-l2:", exchangeName, exchangeCombined);
		
		const data = l2[exchangeName];
		console.log(exchangeName, exchangeCombined)
		if (!data) {
			return { success: false, message: `Exchange ${exchangeName} tidak ditemukan` };
		}
		
		// toggle boolean
		if (typeof data[exchangeCombined] === "boolean") {
			data[exchangeCombined] = !data[exchangeCombined];
		} else {
			// kalau belum ada, default ke true
			data[exchangeCombined] = true;
		}

		try {
			fs.writeFileSync(l2File, JSON.stringify(l2, null, 2));
			console.log(`Berhasil update L2: ${exchangeName}.${exchangeCombined} = ${data[exchangeCombined]}`);
			return { success: true, data: l2 };
		} catch (err) {
			console.warn("Failed to save l2.json", err);
			return { success: false, message: "Failed to save file", error: err };
		}
	});
	
	ipcMain.handle('management:get-mexc-api-key', () => {
		return mexcApiKey;
	});
	ipcMain.handle("management:update-mexc-api-key", (event, newApiKey) => {
    try {
        // Baca file JSON
        let mexcApi = {};
		mexcApi = mexcApiKey

        // Validasi
        if (!newApiKey || typeof newApiKey !== 'string') {
            return { success: false, message: "API Key tidak valid" };
        }

        // Update key
        mexcApi.apiKey = newApiKey;

        // Simpan kembali ke file
        fs.writeFileSync(mexcApiKeyFile, JSON.stringify(mexcApi, null, 2));
        return { success: true, message: "API Key berhasil diperbarui"};
    } catch (err) {
        console.error("Gagal update mexcApiKey.json:", err);
        return { success: false, message: "Gagal menyimpan API Key", error: err.toString() };
    }
	});
	ipcMain.handle('management:update-user-password', (event, oldPassword, newPassword) => {
		try {
			// Pastikan user sudah ada
			if (!Array.isArray(user) || user.length === 0) {
				return { success: false, message: "Data user kosong" };
			}

			// Cari user pertama (misal admin)
			const userIndex = user.findIndex(u => u.username === 'admin');
			if (userIndex === -1) {
				return { success: false, message: "User tidak ditemukan" };
			}

			// Cek oldPassword
			if (user[userIndex].password !== oldPassword) {
				return { success: false, message: "Password lama tidak cocok" };
			}

			// Validasi newPassword
			if (!newPassword || typeof newPassword !== 'string') {
				return { success: false, message: "Password baru tidak valid" };
			}

			// Update password
			user[userIndex].password = newPassword;

			// Simpan kembali ke file
			fs.writeFileSync(userFile, JSON.stringify(user, null, 2));

			return { success: true, message: "Password berhasil diperbarui", data: user[userIndex] };
		} catch (err) {
			console.error("Gagal update password:", err);
			return { success: false, message: "Gagal menyimpan password", error: err.toString() };
		}
	});

}
ipcMain.handle('management:session-check', async (event) => {
    return tokenCheck();
});

ipcMain.handle('management:logout', async () => {
	clearToken()
});

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