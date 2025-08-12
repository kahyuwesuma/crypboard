const path = require('path')
const { ipcMain, BrowserWindow } = require('electron')
const { orderbookConfigs, priceConfigs, targetSymbols } = require('../core/config')
const { startIndodaxPolling, startIndodaxOrderbookPolling } = require('../shared/exchange/indodax_poll')

let win
let usdtIdrPrice = 0
let isUpdating = false // Flag untuk mencegah multiple updates
let pendingUpdates = new Set() // Track exchange yang perlu di-update

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
	for (let ex in sharedPrices) {
	    sharedPrices[ex] = {};
	}
	win = mainWindow

  // Start polling Indodax
	startIndodaxPolling(targetSymbols, (data, usdtIdr) => {
		const oldUsdtIdrPrice = usdtIdrPrice
		usdtIdrPrice = usdtIdr

		data.forEach(({ symbol, price }) => {
			sharedPrices.indodax[symbol] = parseFloat(price)
		})

		const btcIdr = sharedPrices.indodax["BTCUSDT"]
		const btcUsdt = sharedPrices.binance["BTCUSDT"]

		if (win && btcIdr && btcUsdt && usdtIdr) {
			win.webContents.send("header-data", {
				btcIdr,
				btcUsdt,
				usdtIdr
			})
		}

		if (oldUsdtIdrPrice !== usdtIdrPrice) {
			priceConfigs.forEach(({ name }) => pendingUpdates.add(name))
		}

    pendingUpdates.add('indodax') // Always update when Indodax data comes
    debouncedBatchUpdate()
	})

	for (const exchange of priceConfigs) {
		const { name, startFunction } = exchange

		startFunction(targetSymbols, (data) => {
			if (Array.isArray(data)) {
				data.forEach(({ symbol, price }) => {
					sharedPrices[name][symbol] = parseFloat(price)
				})
			} else if (data.data) {
				data.data.forEach(({ symbol, price }) => {
					sharedPrices[name][symbol] = parseFloat(price)
				})
			}

      // Hanya update jika USDT/IDR sudah tersedia
			if (usdtIdrPrice > 0) {
				pendingUpdates.add(name)
				debouncedBatchUpdate()
			}
		})
	}
}

// Batch update untuk mencegah multiple rapid updates
function batchUpdateAllComparisons() {
	if (isUpdating) return

	isUpdating = true
	const exchangesToUpdate = Array.from(pendingUpdates)
	pendingUpdates.clear()

	try {
		exchangesToUpdate.forEach(exchangeName => {
      	if (exchangeName !== 'indodax') { // Skip indodax karena itu base reference
      		updateComparison(exchangeName)
      	}
      })
	} finally {
		isUpdating = false
	}
}

// Dynamically compare Indodax with another exchange
function updateComparison(exchangeName) {
	if (!win || usdtIdrPrice <= 0) return // Pastikan USDT/IDR sudah tersedia

	const merged = []
	const indodaxPrices = sharedPrices.indodax
	const otherPrices = sharedPrices[exchangeName]

	if (!otherPrices || Object.keys(otherPrices).length === 0) return

  	for (const symbol of Object.keys(indodaxPrices)) {
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

// Update semua exchange sekaligus (legacy function, sekarang menggunakan batch)
function updateAllComparisons() {
	priceConfigs.forEach(({ name }) => pendingUpdates.add(name))
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
    win.on('closed', () => {
	    win = null;
	    pendingUpdates.clear();
	    isUpdating = false;
    });
	win.loadFile('src/dashboard/dashboard-page.html')
	return win
}
module.exports = {
	initializeDashboard,
	createDashboardWindow
}