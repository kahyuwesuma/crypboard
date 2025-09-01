const path = require('path')
const { ipcMain, BrowserWindow } = require('electron')
const { wsHandler } = require('../core/config')
const { displaySymbols, displayExchange } = require('../shared/utils/helper')
const { startIndodaxPolling, startIndodaxOrderbookPolling } = require('../shared/exchange/indodax_poll')
const { tokenCheck, clearToken } = require('../core/middleware')
function getTargetSymbols() {const targetSymbols = displaySymbols();return targetSymbols;}
function getDisplayExchange() {const targetExchange = displayExchange();return targetExchange;}
let win
let usdtIdrPrice = 0
let isUpdating = false
let pendingUpdates = new Set()
let lastSavedPrices = null
let headerPrices = {btcIdr: 0,btcUsdt: 0,usdtIdr: 0};
const sharedPrices = { indodax: {}, binance: {}, huobi: {}, gateio: {}, kucoin: {}, mexc: {}, okx: {}, bitget: {}, bybit: {} }

// Optimized debounce with immediate processing for time-sensitive updates
const debouncedBatchUpdate = (() => {
    let timeout
    return (priority = false) => {
        clearTimeout(timeout)
        const delay = priority ? 5 : 25; // Faster delays for better responsiveness
        timeout = setTimeout(() => {
            if (pendingUpdates.size > 0 && !isUpdating) {
                batchUpdateAllComparisons()
            }
        }, delay)
    }
})()

function initializeDashboard(mainWindow) { 
    win = mainWindow 
    const currentActiveSymbols = getTargetSymbols();
    const currentActiveExchange = getDisplayExchange()
    if (lastSavedPrices) {
        for (let ex of currentActiveExchange) {
            if (!sharedPrices[ex]) sharedPrices[ex] = {};            
            for (let sym of currentActiveSymbols) {
                console.log(`Restoring ${ex} - ${sym}`);
                if (lastSavedPrices[ex] && lastSavedPrices[ex][sym] !== undefined) {
                    sharedPrices[ex][sym] = lastSavedPrices[ex][sym];
                }
            }
        }
        currentActiveExchange.forEach((exchangeName) => {
            if (exchangeName !== 'indodax') {updateComparison(exchangeName);}});        
        const btcIdr = sharedPrices.indodax["BTCUSDT"];
        const btcUsdt = sharedPrices.binance && sharedPrices.binance["BTCUSDT"] ? sharedPrices.binance["BTCUSDT"] : null;
        if (btcIdr && btcUsdt && usdtIdrPrice > 0) {win.webContents.send("header-data", { btcIdr, btcUsdt, usdtIdr: usdtIdrPrice });}
    }
    
    const binanceConfig = wsHandler.find(c => c.name === 'binance');
    if (binanceConfig && binanceConfig.startBtcOnly) {
        binanceConfig.startBtcOnly((data) => {
            headerPrices.btcUsdt = data;
            if (win) {
                win.webContents.send("header-data", {
                    btcIdr: headerPrices.btcIdr,
                    btcUsdt: headerPrices.btcUsdt,
                    usdtIdr: usdtIdrPrice
                });
            }
        });
    }

    startIndodaxPolling(currentActiveSymbols, (data, usdtIdr) => {
        const oldUsdtIdrPrice = usdtIdrPrice
        usdtIdrPrice = usdtIdr   
        
        // Process data in chunks for better performance
        processDataChunked(data, currentActiveSymbols, 'indodax');
        
        const btcIdr = headerPrices.btcIdr
        const btcUsdt = headerPrices.btcUsdt
        if (win) {win.webContents.send("header-data", { btcIdr, btcUsdt, usdtIdr })}
        if (oldUsdtIdrPrice !== usdtIdrPrice) {currentActiveExchange.forEach((exchangeName) => {if (exchangeName !== 'indodax') {pendingUpdates.add(exchangeName)}})}
        pendingUpdates.add('indodax')
        debouncedBatchUpdate(true) // Priority for indodax
    })
    
    const activeExchangeConfigs = wsHandler.filter(config =>currentActiveExchange.includes(config.name));    
    for (const exchange of activeExchangeConfigs) {
        const { name, startWS } = exchange
        startWS("lastPrice",currentActiveSymbols, (data) => {
            if (Array.isArray(data)) {
                processDataChunked(data, currentActiveSymbols, name);
            } else if (data.data) {
                processDataChunked(data.data, currentActiveSymbols, name);
            }
            if (usdtIdrPrice > 0 && currentActiveExchange.includes(name)) {
                pendingUpdates.add(name)
                debouncedBatchUpdate()
            }
        })
    }
    
    function sendNetworkStatus() {
        const networkStatus = {};
        setTimeout(()=> {
            currentActiveExchange.forEach(exchangeName => {
                const config = wsHandler.find(c => c.name === exchangeName);
                if (config && typeof config.getConn === "function") {networkStatus[exchangeName] = config.getConn();}
            });
            if (win) {win.webContents.send("network-data", networkStatus);}
            
            setImmediate(sendNetworkStatus);
        },5000)
    }
    sendNetworkStatus();
}

// Process data in chunks to prevent blocking the main thread
function processDataChunked(data, activeSymbols, exchangeName, chunkSize = 15) {
    const chunks = [];
    for (let i = 0; i < data.length; i += chunkSize) {
        chunks.push(data.slice(i, i + chunkSize));
    }
    
    function processChunk(chunkIndex) {
        if (chunkIndex >= chunks.length) return;
        
        const chunk = chunks[chunkIndex];
        chunk.forEach(item => {
            const symbol = item.symbol || item.s;
            const price = parseFloat(item.price || item.c);
            const type = item.type || null;
            
            if (type === "header") {
                if (exchangeName === 'indodax') {
                    headerPrices.btcIdr = parseFloat(price);
                } else {
                    headerPrices.btcUsdt = parseFloat(price);
                }
            }
            
            if (activeSymbols.includes(symbol)) {
                if (!sharedPrices[exchangeName]) sharedPrices[exchangeName] = {};
                sharedPrices[exchangeName][symbol] = parseFloat(price);
            }
        });
        
        // Process next chunk asynchronously
        if (chunkIndex < chunks.length - 1) {
            setImmediate(() => processChunk(chunkIndex + 1));
        }
    }
    
    processChunk(0);
}

async function batchUpdateAllComparisons() {
    if (isUpdating) return
    isUpdating = true    
    const exchangesToUpdate = Array.from(pendingUpdates)
    pendingUpdates.clear()
    const currentActiveExchange = getDisplayExchange()
    
    try {
        // Process exchanges in parallel with limited concurrency
        const concurrency = 2; // Process max 2 exchanges simultaneously for price updates
        const chunks = [];
        for (let i = 0; i < exchangesToUpdate.length; i += concurrency) {
            chunks.push(exchangesToUpdate.slice(i, i + concurrency));
        }
        
        for (const chunk of chunks) {
            const promises = chunk
                .filter(exchangeName => exchangeName !== 'indodax' && currentActiveExchange.includes(exchangeName))
                .map(exchangeName => updateComparisonAsync(exchangeName));
            
            await Promise.all(promises);
        }
    } finally {
        isUpdating = false
    }
}

function updateComparisonAsync(exchangeName) {
    return new Promise((resolve) => {
        setImmediate(() => {
            updateComparison(exchangeName);
            resolve();
        });
    });
}

function updateComparison(exchangeName) {
    if (!win || usdtIdrPrice <= 0) return
    const currentActiveExchange = getDisplayExchange()
    if (!currentActiveExchange.includes(exchangeName)) {return}
    
    const indodaxPrices = sharedPrices.indodax
    const otherPrices = sharedPrices[exchangeName]
    const currentActiveSymbols = getTargetSymbols();
    if (!otherPrices || Object.keys(otherPrices).length === 0) return
    
    // Process symbols in batches to prevent blocking
    const symbolBatches = [];
    const batchSize = 20; // Process 20 symbols at a time
    for (let i = 0; i < currentActiveSymbols.length; i += batchSize) {
        symbolBatches.push(currentActiveSymbols.slice(i, i + batchSize));
    }
    
    const merged = [];
    
    function processBatch(batchIndex) {
        if (batchIndex >= symbolBatches.length) {
            // All batches processed, send the result
            const sorted = merged.length > 50 
                ? merged.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
                : merged.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
            
            process.nextTick(() => {
                if (win && win.webContents) {
                    win.webContents.send(`${exchangeName}-price-update`, sorted);
                }
            });
            return;
        }
        
        const batch = symbolBatches[batchIndex];
        for (const symbol of batch) {
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
        
        // Process next batch asynchronously
        setImmediate(() => processBatch(batchIndex + 1));
    }
    
    processBatch(0);
}

// Pool handler aktif
const activeIndodaxPollers = {};  
const activeExchangeHandlers = {};

async function handleOrderbookRequest(event, { symbol, exchange }) {
    const config = wsHandler.find(c => c.name === exchange);
    if (!config) return console.error(`[orderbook] Unknown exchange: ${exchange}`);

    const key = `${exchange}-${symbol}`;

    // Kalau ada handler lama → stop dulu
    if (activeExchangeHandlers[key]) {
        // Gunakan dedicated stop function
        config.stopOrderbook?.();
        delete activeExchangeHandlers[key];
    }

    // Start WS exchange
    activeExchangeHandlers[key] = { stop: null };
    // Start orderbook
    config.getOrderbook(symbol, (orders) => {
        sendOrderbookUpdate(symbol, exchange, orders);
    });
   activeExchangeHandlers[key].stop = config.stopOrderbook;

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
    const config = wsHandler.find(c => c.name === exchange);

    // Stop WS exchange-symbol
    if (activeExchangeHandlers[key]) {
        // Gunakan dedicated stop function
        config.stopOrderbook?.();
        delete activeExchangeHandlers[key];
    }

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
    // console.log(payload)
    broadcastToViewers(symbol, exchange, orders, payload);
}

function broadcastToViewers(symbol, exchange, orders, payloadOverride = null) {
    const payload = payloadOverride || { symbol, exchange, orders: { [exchange]: orders } };
    // console.log(payload)
    activeIndodaxPollers[symbol]?.viewers.forEach(viewer => {
        viewer.send('orderbook-response', payload);
    });
}

ipcMain.on('request-orderbook', handleOrderbookRequest);
ipcMain.on('close-orderbook', handleOrderbookClose);

ipcMain.handle('dashboard:get-active-exchange', async () => {
  return getDisplayExchange()
});


ipcMain.handle('dashboard:session-check', async (event) => {
    console.log("CEK TOKEN", tokenCheck())
    return tokenCheck();
});
ipcMain.handle('dashboard:logout', async () => {
    clearToken();
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