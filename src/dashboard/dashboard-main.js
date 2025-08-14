const path = require('path')
const { ipcMain, BrowserWindow } = require('electron')
const { orderbookConfigs, priceConfigs } = require('../core/config')
const { displaySymbols, displayExchange } = require('../shared/utils/helper')
const { startIndodaxPolling, startIndodaxOrderbookPolling } = require('../shared/exchange/indodax_poll')

function getTargetSymbols() {
	const targetSymbols = displaySymbols();
  	return targetSymbols; // selalu baca ulang dari file
}

function getDisplayExchange() {
	const targetExchange = displayExchange();
  	return targetExchange; // selalu baca ulang dari file
}

let win
let usdtIdrPrice = 0
let isUpdating = false // Flag untuk mencegah multiple updates
let pendingUpdates = new Set() // Track exchange yang perlu di-update
let lastSavedPrices = null; // untuk menyimpan harga terakhir sebelum window di-close
let headerPrices = {
  btcIdr: 0,
  btcUsdt: 0,
  usdtIdr: 0
};
const sharedPrices = {
	indodax: {},
	binance: {},
	huobi: {},
	gateio: {},
	kucoin: {},
	mexc: {},
	okx: {},
	bitget: {},
	bybit: {}
}

const debouncedBatchUpdate = (() => {
	let timeout
	return () => {
		clearTimeout(timeout)
		timeout = setTimeout(() => {
			if (pendingUpdates.size > 0 && !isUpdating) {
				batchUpdateAllComparisons()
			}
    }, 50) //delay
	}
})()

function initializeDashboard(mainWindow) { 
    win = mainWindow 
    
    // Dapatkan symbol yang aktif saat ini
    const currentActiveSymbols = getTargetSymbols();
    const currentActiveExchange = getDisplayExchange() // Dapatkan exchange yang aktif
    
    console.log('Active exchanges:', currentActiveExchange);
    console.log('Active symbols:', currentActiveSymbols);
    
    // Restore harga terakhir jika ada, tapi HANYA untuk exchange dan symbol yang aktif
    if (lastSavedPrices) {
        // Hanya restore untuk exchange yang aktif
        for (let ex of currentActiveExchange) {
            if (!sharedPrices[ex]) sharedPrices[ex] = {};
            
            for (let sym of currentActiveSymbols) {
                console.log(`Restoring ${ex} - ${sym}`);
                if (lastSavedPrices[ex] && lastSavedPrices[ex][sym] !== undefined) {
                    sharedPrices[ex][sym] = lastSavedPrices[ex][sym];
                }
            }
        }
        
        // Langsung kirim harga awal ke renderer untuk setiap exchange AKTIF
        currentActiveExchange.forEach((exchangeName) => {
            if (exchangeName !== 'indodax') {
                updateComparison(exchangeName);
            }
        });
        
        // Kirim header data jika BTCUSDT dan USDT/IDR tersedia
        const btcIdr = sharedPrices.indodax["BTCUSDT"];
        const btcUsdt = sharedPrices.binance && sharedPrices.binance["BTCUSDT"] ? sharedPrices.binance["BTCUSDT"] : null;
        if (btcIdr && btcUsdt && usdtIdrPrice > 0) {
            win.webContents.send("header-data", { btcIdr, btcUsdt, usdtIdr: usdtIdrPrice });
        }
    }
    
    // Start polling Indodax dengan symbol yang aktif saat ini
    startIndodaxPolling(currentActiveSymbols, (data, usdtIdr) => {
        const oldUsdtIdrPrice = usdtIdrPrice
        usdtIdrPrice = usdtIdr
        
        data.forEach((item) => {
            const symbol = item.symbol || item.s;
            const price = parseFloat(item.price || item.c);
            const type = item.type || null;
            
            // Hanya simpan jika symbol masih aktif
            if (currentActiveSymbols.includes(symbol)) {
                sharedPrices.indodax[symbol] = parseFloat(price)
            }
            
            // Simpan khusus BTCUSDT ke headerPrices
            if (type === "header") {
                headerPrices.btcIdr = parseFloat(price)
            }
        })
        
        const btcIdr = headerPrices.btcIdr
        const btcUsdt = headerPrices.btcUsdt
        
        if (win) {
            win.webContents.send("header-data", { btcIdr, btcUsdt, usdtIdr })
        }
        
        if (oldUsdtIdrPrice !== usdtIdrPrice) {
            // Hanya update exchange yang aktif
            currentActiveExchange.forEach((exchangeName) => {
                if (exchangeName !== 'indodax') {
                    pendingUpdates.add(exchangeName)
                }
            })
        }
        
        pendingUpdates.add('indodax')
        debouncedBatchUpdate()
    })
    
    // HANYA jalankan koneksi WS untuk exchange yang AKTIF
    const activeExchangeConfigs = priceConfigs.filter(config => 
        currentActiveExchange.includes(config.name)
    );
    
    console.log('Starting WS connections for active exchanges:', activeExchangeConfigs.map(c => c.name));
    
    for (const exchange of activeExchangeConfigs) {
        const { name, startFunction } = exchange
        
        console.log(`Starting WS for exchange: ${name}`);
        
        startFunction(currentActiveSymbols, (data) => {
            if (Array.isArray(data)) {
                data.forEach(item => {
                    const symbol = item.symbol || item.s;
                    const price = parseFloat(item.price || item.c);
                    const type = item.type || null;
                    
                    if (type === "header") {
                        headerPrices.btcUsdt = parseFloat(price);
                    }
                    
                    // Hanya simpan jika symbol masih aktif
                    if (currentActiveSymbols.includes(symbol)) {
                        if (!sharedPrices[name]) sharedPrices[name] = {};
                        sharedPrices[name][symbol] = parseFloat(price)
                    }
                })
            } else if (data.data) {
                data.data.forEach(item => {
                    const symbol = item.symbol || item.s;
                    const price = parseFloat(item.price || item.c);
                    const type = item.type || null;
                    
                    if (type === "header") {
                        headerPrices.btcUsdt = parseFloat(price);
                    }
                    
                    // Hanya simpan jika symbol masih aktif
                    if (currentActiveSymbols.includes(symbol)) {
                        if (!sharedPrices[name]) sharedPrices[name] = {};
                        sharedPrices[name][symbol] = parseFloat(price)
                    }
                })
            }
            
            // Hanya update jika USDT/IDR sudah tersedia dan exchange aktif
            if (usdtIdrPrice > 0 && currentActiveExchange.includes(name)) {
                pendingUpdates.add(name)
                debouncedBatchUpdate()
            }
        })
    }
    // --- START BTCUSDT WS TERPISAH (bypass active exchange) ---
    const binanceConfig = priceConfigs.find(c => c.name === 'binance');
    if (binanceConfig && binanceConfig.startBtcOnly) {
        binanceConfig.startBtcOnly((data) => {
            // Update header BTCUSDT
            headerPrices.btcUsdt = data.price;
            if (win) {
                win.webContents.send("header-data", {
                    btcIdr: headerPrices.btcIdr,
                    btcUsdt: headerPrices.btcUsdt,
                    usdtIdr: usdtIdrPrice
                });
            }
        });
    }
}

// Batch update untuk mencegah multiple rapid updates
function batchUpdateAllComparisons() {
    if (isUpdating) return
    isUpdating = true
    
    const exchangesToUpdate = Array.from(pendingUpdates)
    pendingUpdates.clear()
    
    // Dapatkan exchange aktif terbaru
    const currentActiveExchange = getDisplayExchange()
    
    try {
        exchangesToUpdate.forEach(exchangeName => {
            // Hanya update jika exchange masih aktif dan bukan indodax
            if (exchangeName !== 'indodax' && currentActiveExchange.includes(exchangeName)) {
                updateComparison(exchangeName)
            }
        })
    } finally {
        isUpdating = false
    }
}

// Dynamically compare Indodax with another exchange
function updateComparison(exchangeName) {
    if (!win || usdtIdrPrice <= 0) return
    
    // Pastikan exchange masih aktif sebelum update
    const currentActiveExchange = getDisplayExchange()
    if (!currentActiveExchange.includes(exchangeName)) {
        console.log(`Skipping update for inactive exchange: ${exchangeName}`);
        return
    }
    
    const merged = []
    const indodaxPrices = sharedPrices.indodax
    const otherPrices = sharedPrices[exchangeName]
    const currentActiveSymbols = getTargetSymbols();
    
    if (!otherPrices || Object.keys(otherPrices).length === 0) return
    
    // Hanya proses symbol yang aktif
    for (const symbol of currentActiveSymbols) {
        const priceA = indodaxPrices[symbol]
        const priceB = otherPrices[symbol]
        
        if (priceA && priceB && priceA > 0 && priceB > 0) {
            const priceB_IDR = priceB * usdtIdrPrice
            const gap = ((priceB_IDR - priceA) / priceA) * 100
            const cleanSymbol = symbol.replace(/USDT$/i, '')
            
            merged.push({
                symbol: cleanSymbol,
                priceA: priceA.toFixed(2),
                priceB: `${priceB.toFixed(3)} (${priceB_IDR.toFixed(2)})`,
                gap: parseFloat(gap.toFixed(2)),
            })
        }
    }
    
    const sorted = merged.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    win.webContents.send(`${exchangeName}-price-update`, sorted)
}

// Update semua exchange yang aktif sekaligus
function updateAllComparisons() {
    const currentActiveExchange = getDisplayExchange()
    
    currentActiveExchange.forEach((exchangeName) => {
        if (exchangeName !== 'indodax') {
            pendingUpdates.add(exchangeName)
        }
    })
    
    debouncedBatchUpdate()
}

// Pool handler aktif
const activeIndodaxPollers = {};   // { symbol: { lastOrders, stop, viewers: Set } }
const activeExchangeHandlers = {}; // { key: { stop } }

async function handleOrderbookRequest(event, { symbol, exchange }) {
    const config = orderbookConfigs.find(c => c.name === exchange);
    if (!config) return console.error(`[orderbook] Unknown exchange: ${exchange}`);

    const key = `${exchange}-${symbol}`;

    // Kalau ada handler lama → stop dulu
    if (activeExchangeHandlers[key]) {
        activeExchangeHandlers[key].stop?.();
        delete activeExchangeHandlers[key];
    }

    // Start WS exchange
    activeExchangeHandlers[key] = { stop: null };
    const stopFn = config.startFunction(symbol, (orders) => {
        sendOrderbookUpdate(symbol, exchange, orders);
    });
    activeExchangeHandlers[key].stop = stopFn;

    // Start polling Indodax kalau belum ada
    if (!activeIndodaxPollers[symbol]) {
        activeIndodaxPollers[symbol] = {
            lastOrders: [],
            viewers: new Set(),
            stop: null
        };
        const stopPolling = startIndodaxOrderbookPolling(symbol, (orders) => {
            activeIndodaxPollers[symbol].lastOrders = orders;
            broadcastToViewers(symbol, 'indodax', orders);
        });
        activeIndodaxPollers[symbol].stop = stopPolling;
    }

    // Catat viewer
    activeIndodaxPollers[symbol].viewers.add(event.sender);
}

function handleOrderbookClose(event, { symbol, exchange }) {
    const key = `${exchange}-${symbol}`;
    const config = orderbookConfigs.find(c => c.name === exchange);

    // Stop WS exchange-symbol
    if (activeExchangeHandlers[key]) {
        activeExchangeHandlers[key].stop?.();
        delete activeExchangeHandlers[key];
    }

    // Hapus viewer dari Indodax poller
    if (activeIndodaxPollers[symbol]) {
        activeIndodaxPollers[symbol].viewers.delete(event.sender);

        // Kalau viewer kosong → stop polling
        if (activeIndodaxPollers[symbol].viewers.size === 0) {
            activeIndodaxPollers[symbol].stop?.();
            delete activeIndodaxPollers[symbol];
        }
    }

    config?.closeFunction?.();
}

function sendOrderbookUpdate(symbol, exchange, orders) {
    const indodaxOrders = activeIndodaxPollers[symbol]?.lastOrders || [];
    const payload = { symbol, exchange, orders: { [exchange]: orders, indodax: indodaxOrders } };
    broadcastToViewers(symbol, exchange, orders, payload);
}

function broadcastToViewers(symbol, exchange, orders, payloadOverride = null) {
    const payload = payloadOverride || { symbol, exchange, orders: { [exchange]: orders } };
    activeIndodaxPollers[symbol]?.viewers.forEach(viewer => {
        viewer.send('orderbook-response', payload);
    });
}

ipcMain.on('request-orderbook', handleOrderbookRequest);
ipcMain.on('close-orderbook', handleOrderbookClose);

ipcMain.handle('dashboard:get-active-exchange', async () => {
  return getDisplayExchange()
});
function createDashboardWindow() {
	win = new BrowserWindow({
		width: 1200,
		height: 900,
		webPreferences: {
			nodeIntegration: false,
			preload: path.join(__dirname, 'dashboard-preload.js'),
			zoomFactor: 1.0,
			sandbox: false ,
			contextIsolation: true
		},
	})
	win.maximize()
    win.on('closed', () => {
    	// Hanya simpan data untuk symbol yang aktif saat ini
    	const currentActiveSymbols = getTargetSymbols();
    	const filteredPrices = {};
    	
    	for (let ex in sharedPrices) {
    		filteredPrices[ex] = {};
    		for (let sym of currentActiveSymbols) {
    			if (sharedPrices[ex][sym] !== undefined) {
    				filteredPrices[ex][sym] = sharedPrices[ex][sym];
    			}
    		}
    	}
    	
    	lastSavedPrices = filteredPrices;

		// Pastikan semua koneksi WS dari priceConfigs ditutup
		priceConfigs.forEach(({ stopFunction }) => {
			if (typeof stopFunction === 'function') {
				try {
					stopFunction()
				} catch (err) {
					console.error(`[stopFunction error]`, err)
				}
			}
		})

		// Tutup semua orderbook WS yang aktif
		Object.values(activeExchangeHandlers).forEach(handler => {
			if (typeof handler.stop === 'function') {
				try {
					handler.stop()
				} catch (err) {
					console.error(`[orderbook stop error]`, err)
				}
			}
		})

		// Tutup polling Indodax orderbook
		Object.values(activeIndodaxPollers).forEach(poller => {
			if (typeof poller.stop === 'function') {
				try {
					poller.stop()
				} catch (err) {
					console.error(`[indodax poll stop error]`, err)
				}
			}
		})

		// Bersihkan state
		win = null
		pendingUpdates.clear()
		isUpdating = false
	})
	win.loadFile('src/dashboard/dashboard-page.html')
	return win
}

module.exports = {
	initializeDashboard,
	createDashboardWindow
}