const path = require('path')
const { ipcMain, BrowserWindow } = require('electron')
const { wsHandler } = require('../core/config')
const { displaySymbols, displayExchange, allL2 } = require('../shared/utils/helper')
const { startIndodaxOrderbookPolling, startIndodaxL2Orderbook } = require('../shared/exchange/indodax_poll')
const { tokenCheck, clearToken } = require('../core/middleware')
let win
let usdtIdrPrice = 0
let isUpdating = false
let lastSavedPrices = null
let pendingUpdates = new Set()
let headerPrices = { btcIdr: 0, btcUsdt: 0, usdtIdr: 0};
let sharedPrices = { indodax: {}, binance: {}, huobi: {}, gateio: {}, kucoin: {}, mexc: {}, okx: {}, bitget: {}, bybit: {} }

function getTargetSymbols() { const targetSymbols = displaySymbols(); return targetSymbols}
function getDisplayExchange() { const targetExchange = displayExchange(); return targetExchange}

// Optimized debounce with adaptive delays based on load
const debouncedBatchUpdate = (() => {
    let timeout;
    return (priority = false) => {
        clearTimeout(timeout);
        const activeExchanges = getDisplayExchange().length;
        const activeSymbols = getTargetSymbols().length;
        
        // Adaptive delays based on load (exchanges * symbols)
        const load = activeExchanges * activeSymbols;
        let delay;
        if (priority) {
            delay = load > 800 ? 8 : 5; // Very fast for priority
        } else {
            delay = load > 800 ? 20 : load > 400 ? 15 : 10; // Scale with load
        }
        
        timeout = setTimeout(() => {
            if (pendingUpdates.size > 0 && !isUpdating) {
                batchUpdateAllComparisons();
            }
        }, delay);
    }
})()

function initializeL2orderbook(mainWindow) {
    win = mainWindow;
    const currentActiveSymbols = getTargetSymbols();
    const currentActiveExchange = getDisplayExchange();
    
    if (lastSavedPrices) {

        sharedPrices = JSON.parse(JSON.stringify(lastSavedPrices));

        // Trigger render awal biar tabel ga kosong sebelum WS jalan
        for (const ex in lastSavedPrices) {
            const items = Object.keys(lastSavedPrices[ex]).map(symbol => {
                return {
                    symbol,
                    bid: lastSavedPrices[ex][symbol].bid,
                    ask: lastSavedPrices[ex][symbol].ask
                };
            });

            const chunkSize = items.length > 100 ? 8 : 12;
            processDataInChunks(items, currentActiveSymbols, ex, chunkSize);

            if (currentActiveExchange.includes(ex)) {
                pendingUpdates.add(ex);
            }
        }
        debouncedBatchUpdate(true); // langsung render
    }

    startIndodaxL2Orderbook(currentActiveSymbols, (data, usdtIdr) => {
        const oldUsdtIdrPrice = usdtIdrPrice;

        if (data && data.type === "header") {
            headerPrices.btcIdr = parseFloat(data.price);
            if (win) { win.webContents.send("header-data", headerPrices); }
            return
        }
        usdtIdrPrice = usdtIdr;
        headerPrices.usdtIdr = usdtIdr;
        
        // Adaptive chunk size based on data size
        const chunkSize = data.length > 100 ? 8 : 12;
        processDataInChunks(data, currentActiveSymbols, 'indodax', chunkSize);
        if (win) { win.webContents.send("header-data", headerPrices); }
        
        if (oldUsdtIdrPrice !== usdtIdrPrice) {
            currentActiveExchange.forEach((exchangeName) => {
                if (exchangeName !== "indodax") {
                    pendingUpdates.add(exchangeName);
                }
            });
        }

        pendingUpdates.add("indodax");
        debouncedBatchUpdate(true); // Priority update for indodax
    });

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
    
    const activeExchangeConfigs = wsHandler.filter(config => 
        currentActiveExchange.includes(config.name)
    );
    
    for (const exchange of activeExchangeConfigs) {
        const { name, startWS } = exchange;
        startWS("orderbook",currentActiveSymbols, (data) => {
            let items = [];
            
            if (Array.isArray(data)) {
                items = data;
            } else if (data.data && Array.isArray(data.data)) {
                items = data.data;
            } else if (data.exchange && Array.isArray(data.data)) {
                items = data.data;
            }
            
            // Adaptive chunk size based on items length
            const chunkSize = items.length > 100 ? 8 : 12;
            processDataInChunks(items, currentActiveSymbols, name, chunkSize);
            
            if (usdtIdrPrice > 0 && currentActiveExchange.includes(name)) {
                pendingUpdates.add(name);
                debouncedBatchUpdate();
            }
        });
    }
}

// Process data in chunks with adaptive sizing
function processDataInChunks(items, activeSymbols, exchangeName, chunkSize = 10) {
    if (items.length === 0) return;
    
    const chunks = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        chunks.push(items.slice(i, i + chunkSize));
    }
    
    let processedChunks = 0;
    
    function processChunk(chunkIndex) {
        if (chunkIndex >= chunks.length) return;
        
        const chunk = chunks[chunkIndex];
        chunk.forEach((item) => {
            const symbol = item.symbol || item.s;
            let bestBid, bestAsk;
            
            if (item.bid !== undefined && item.ask !== undefined) {
                bestBid = parseFloat(item.bid);
                bestAsk = parseFloat(item.ask);
            } else if (Array.isArray(item.bids) && Array.isArray(item.asks)) {
                bestBid = parseFloat(item.bids[0]?.[0]);
                bestAsk = parseFloat(item.asks[0]?.[0]);
            }
            
            if (activeSymbols.includes(symbol)) {
                if (!sharedPrices[exchangeName]) sharedPrices[exchangeName] = {};
                sharedPrices[exchangeName][symbol] = {
                    bid: bestBid || null,
                    ask: bestAsk || null,
                };
            }
        });
        
        processedChunks++;
        
        // Process next chunk asynchronously
        if (chunkIndex < chunks.length - 1) {
            // Use different async methods based on load
            if (chunks.length > 15) {
                setImmediate(() => processChunk(chunkIndex + 1));
            } else {
                process.nextTick(() => processChunk(chunkIndex + 1));
            }
        }
    }
    
    processChunk(0);
}

async function batchUpdateAllComparisons() {
    if (isUpdating) return;
    isUpdating = true;
    
    const exchangesToUpdate = Array.from(pendingUpdates);
    pendingUpdates.clear();
    
    const currentActiveExchange = getDisplayExchange();
    const activeCount = currentActiveExchange.length;
    const symbolCount = getTargetSymbols().length;
    
    try {
        // Adaptive concurrency based on load
        let concurrency;
        const totalLoad = activeCount * symbolCount;
        if (totalLoad > 900) {
            concurrency = 2; // Conservative for very high load
        } else if (totalLoad > 500) {
            concurrency = 3; // Moderate for medium-high load
        } else {
            concurrency = 4; // More aggressive for lower load
        }
        
        const chunks = [];
        for (let i = 0; i < exchangesToUpdate.length; i += concurrency) {
            chunks.push(exchangesToUpdate.slice(i, i + concurrency));
        }
        
        for (const chunk of chunks) {
            const promises = chunk
                .filter(exchangeName => exchangeName !== 'indodax' && currentActiveExchange.includes(exchangeName))
                .map(exchangeName => updateComparisonAsync(exchangeName));
            
            await Promise.all(promises);
            
            // Add small delay between chunks for very high loads
            if (totalLoad > 800 && chunks.length > 1) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }
    } finally {
        isUpdating = false;
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

// const fs = require("fs");

function getTargetL2() {const l2l2 = allL2();return l2l2;}
function updateComparison(exchangeName) {
    if (!win || usdtIdrPrice <= 0) return;
    const currentActiveExchange = getDisplayExchange();
    if (!currentActiveExchange.includes(exchangeName)) {
        console.log(`Skipping update for inactive exchange: ${exchangeName}`);
        return;
    }

    // Convert boolean config to array of allowed keys
    const filterConfig = getTargetL2()

    const allowedConfig = filterConfig[exchangeName] || {};
    const allowedKeys = Object.keys(allowedConfig).filter(key => allowedConfig[key] === true);

    const currentActiveSymbols = getTargetSymbols();
    const indoBook = sharedPrices.indodax;       
    const otherBook = sharedPrices[exchangeName]; 

    if (!otherBook || Object.keys(otherBook).length === 0) return;

    // Adaptive batch processing based on symbol count
    const symbolCount = currentActiveSymbols.length;
    let batchSize;
    if (symbolCount > 150) {
        batchSize = 8; // Smaller batches for very large symbol counts
    } else if (symbolCount > 80) {
        batchSize = 10; // Medium batches
    } else {
        batchSize = 15; // Larger batches for smaller counts
    }
    
    const symbolBatches = [];
    for (let i = 0; i < currentActiveSymbols.length; i += batchSize) {
        symbolBatches.push(currentActiveSymbols.slice(i, i + batchSize));
    }
    
    const merged = [];
    let processedBatches = 0;
    
    function processBatch(batchIndex) {
        if (batchIndex >= symbolBatches.length) {
            // All batches processed, sort and send
            if (merged.length > 30) {
                // Use efficient sorting for large datasets
                merged.sort((a, b) => {
                    const aGap = Math.max(...Object.values(a).filter(v => typeof v === 'number').map(Math.abs));
                    const bGap = Math.max(...Object.values(b).filter(v => typeof v === 'number').map(Math.abs));
                    return bGap - aGap;
                });
            }
            
            // Send update asynchronously
            process.nextTick(() => {
                if (win && win.webContents) {
                    win.webContents.send(`${exchangeName}-orderbook-update`, merged);
                }
            });
            return;
        }
        
        const batch = symbolBatches[batchIndex];
        for (const symbol of batch) {
            const indoData = indoBook[symbol];
            const otherData = otherBook[symbol];

            if (indoData && otherData) {
                const indoBid = indoData.bid;
                const indoAsk = indoData.ask;
                const otherBid = otherData.bid;
                const otherAsk = otherData.ask;
                
                if (indoBid && indoAsk && otherBid && otherAsk) {
                    const otherBid_IDR = otherBid * usdtIdrPrice;
                    const otherAsk_IDR = otherAsk * usdtIdrPrice;
                    const gap_idx_other = ((otherBid_IDR - indoAsk) / indoAsk) * 100;
                    const gap_other_idx = ((indoBid - otherAsk_IDR) / otherAsk_IDR) * 100;

                    const cleanSymbol = symbol.replace(/USDT$/i, '');
                    const entry = {
                        symbol: cleanSymbol,
                        [`idx-${exchangeName}`]: parseFloat(gap_idx_other.toFixed(2)),
                        [`${exchangeName}-idx`]: parseFloat(gap_other_idx.toFixed(2)),
                    };
                    // 🔍 filter hanya key yang diizinkan (yang bernilai true)
                    const filteredEntry = Object.fromEntries(
                        Object.entries(entry).filter(([key]) => key === "symbol" || allowedKeys.includes(key))
                    );
                    merged.push(filteredEntry);
                }
            }
        }
        
        processedBatches++;
        
        // Process next batch asynchronously
        if (batchIndex < symbolBatches.length - 1) {
            // Use different scheduling based on load
            if (symbolBatches.length > 10) {
                setImmediate(() => processBatch(batchIndex + 1));
            } else {
                process.nextTick(() => processBatch(batchIndex + 1));
            }
        } else {
            // This is the last batch, process immediately
            processBatch(batchIndex + 1);
        }
    }
    
    processBatch(0);
}

ipcMain.handle('l2orderbook:get-active-exchange', async () => {return getDisplayExchange()});
ipcMain.handle('l2orderbook:get-active-filter', async () => {return getTargetL2()})

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
    // Hapus viewer dari Indodax poller
    if (activeIndodaxPollers[symbol]) {
        activeIndodaxPollers[symbol].viewers.delete(event.sender);
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
    activeIndodaxPollers[symbol]?.viewers.forEach(viewer => {viewer.send('l2-orderbook-response', payload);});
}

ipcMain.on('l2-orderbook-request', handleOrderbookRequest);
ipcMain.on('l2-orderbook-close', handleOrderbookClose);
ipcMain.handle('l2-orderbook:session-check', async (event) => {
    return tokenCheck();
});

ipcMain.handle('l2orderbook:logout', async () => {
    clearToken();
});

function createL2orderbookWindow() {
	win = new BrowserWindow({
		width: 1200,
		height: 900,
		webPreferences: {
			nodeIntegration: false,
			preload: path.join(__dirname, 'l2orderbook-preload.js'),
			zoomFactor: 1.0,
			sandbox: false ,
			contextIsolation: true
		},
	})
	win.maximize()
    win.on('closed', () => {
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

        // wsHandler.forEach(({ stopWebsocket }) => {
        //     if (typeof stopWebsocket === 'function') {
        //         try {
        //             stopWebsocket()
        //         } catch (err) {
        //             console.error(`[stopWebsocket error]`, err)
        //         }
        //     }
        // })
        // Bersihkan state
        win = null
        pendingUpdates.clear()
        isUpdating = false
    })
	win.loadFile('src/l2orderbook/l2orderbook-page.html')
	return win
}

module.exports = { createL2orderbookWindow, initializeL2orderbook }