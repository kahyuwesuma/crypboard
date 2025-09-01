const { DefaultLogger, WebsocketClientV2, WS_KEY_MAP } = require('bitget-api');
const { chunkArray } = require('../utils/helper')
let bitgetLastMessageTime = 0;
let activeBitgetClients = [];
let activeBitgetOrderbooks = [];
let activeCallbacks = {}; // Menyimpan callbacks berdasarkan type
let sharedWSClient = null; // Satu WS client yang dibagi untuk semua type
let sharedLastPrices = {}; // Shared state untuk lastPrices
let sharedOrderbooks = {}; // Shared state untuk orderbooks

/**
 * Start Bitget WebSocket dengan batch subscribe
 * @param {string} type - tipe market, contoh: 'orderbook', 'lastPrice'
 * @param {string[]} targetSymbols - list symbol misalnya ['BTCUSDT','ETHUSDT']
 * @param {function} callback - function yg dipanggil tiap ada update
 */
function startBitgetWS(type, targetSymbols, callback) {
  // Jika sudah ada WS aktif, tinggal tambah callback
  if (sharedWSClient) {
    console.log(`Reusing existing WS connection for type: ${type}`);
    
    // Tambah callback untuk type ini
    if (!activeCallbacks[type]) {
      activeCallbacks[type] = [];
    }
    activeCallbacks[type].push(callback);
    
    return sharedWSClient;
  }

  console.log(`Creating new WS connection for type: ${type}`);

  const logger = {
    ...DefaultLogger,
    trace: (...params) => console.log('trace', ...params),
  };

  const wsClient = new WebsocketClientV2({}, logger);
  sharedWSClient = wsClient; // Set sebagai shared client

  // Initialize callbacks array untuk type ini
  if (!activeCallbacks[type]) {
    activeCallbacks[type] = [];
  }
  activeCallbacks[type].push(callback);

  wsClient.on('update', (data) => {
    bitgetLastMessageTime = Date.now();

    const lastPriceUpdates = [];
    const orderbookUpdates = [];

    for (const item of data.data || []) {
      const symbol = item.instId?.toUpperCase();
      if (!symbol) continue;

      // Process lastPrice updates
      const price = parseFloat(item.lastPr);
      if (!isNaN(price)) {
        if (sharedLastPrices[symbol] !== price) {
          sharedLastPrices[symbol] = price;
          lastPriceUpdates.push({ symbol, price });
        }
      }

      // Process orderbook updates  
      const bid = parseFloat(item.bidPr);
      const ask = parseFloat(item.askPr);
      if (!isNaN(bid) && !isNaN(ask)) {
        const prev = sharedOrderbooks[symbol] || {};
        if (prev.bid !== bid || prev.ask !== ask) {
          sharedOrderbooks[symbol] = { bid, ask };
          orderbookUpdates.push({ symbol, bid, ask });
        }
      }
    }

    // Kirim update ke callbacks sesuai type
    if (lastPriceUpdates.length > 0 && activeCallbacks['lastPrice']) {
      activeCallbacks['lastPrice'].forEach(cb => {
        if (typeof cb === "function") {
          cb(lastPriceUpdates);
        }
      });
    }

    if (orderbookUpdates.length > 0 && activeCallbacks['orderbook']) {
      activeCallbacks['orderbook'].forEach(cb => {
        if (typeof cb === "function") {
          cb(orderbookUpdates);
        }
      });
    }
  });

  wsClient.on('open', (data) => console.log('WS connection opened:', data.wsKey));
  wsClient.on('response', (data) => console.log('WS response:', JSON.stringify(data, null, 2)));
  wsClient.on('reconnect', ({ wsKey }) => console.log('WS reconnecting...', wsKey));
  wsClient.on('reconnected', (data) => console.log('WS reconnected', data?.wsKey));
  wsClient.on('exception', (data) => console.error('WS error', data));

  const batches = chunkArray(targetSymbols, 50);

  // subscribe per batch
  batches.forEach((batch, idx) => {
    setTimeout(() => {
      batch.forEach((sym) => {
        wsClient.subscribeTopic("SPOT", 'ticker', sym);
      });
      console.log(`Subscribed batch ${idx + 1}:`, batch);
    }, idx * 1500); // delay antar batch
  });


  setTimeout(() => {
    const publicTopics = wsClient.getWsStore().getTopics(WS_KEY_MAP.v2Public);
    console.log('Subscribed topics:', publicTopics);
  }, 120000);

  activeBitgetClients.push({ wsClient, type, targetSymbols });
  return wsClient;
}

function stopBitgetWS() {
  activeBitgetClients.forEach((clientInfo) => {
    const { wsClient, type, targetSymbols } = clientInfo;
    if (!wsClient) return;

    try {
      if (targetSymbols && targetSymbols.length > 0) {
        const batches = chunkArray(targetSymbols, 50);
        batches.forEach((batch, idx) => {
          setTimeout(() => {
            batch.forEach((sym) => {
              wsClient.unsubscribeTopic("SPOT", "ticker", sym);
            });
            console.log(`Unsubscribed batch ${idx + 1}:`, batch);
          }, idx * 1500);
        });

        // close setelah semua batch selesai
        const totalDelay = batches.length * 1500;
        setTimeout(() => {
          wsClient.removeAllListeners()
          wsClient.closeAll();
          console.log("Closed Bitget WS:", type);
        }, totalDelay + 500);
      } else {
        wsClient.closeAll();
        console.log("Closed Bitget WS (no symbols):", type);
      }
    } catch (e) {
      console.error("Error stopping Bitget WS:", e.message);
    }
  });

  activeBitgetClients = [];
  activeCallbacks = {}; // Reset callbacks
  sharedWSClient = null; // Reset shared client
  sharedLastPrices = {}; // Reset shared state
  sharedOrderbooks = {}; // Reset shared state
}

/**
 * Start Bitget WebSocket dengan batch subscribe
 * @param {string} type - tipe market, contoh: 'orderbook', 'lastPrice'
 * @param {string[]} targetSymbols - list symbol misalnya ['BTCUSDT','ETHUSDT']
 * @param {function} callback - function yg dipanggil tiap ada update
 */
function getBitgetOrderbook(targetSymbols, onUpdate) {
  const symbol = targetSymbols+"USDT";
  const logger = {
    ...DefaultLogger,
    trace: (...params) => console.log('trace', ...params),
  };

  const wsClient = new WebsocketClientV2({}, logger);

  const orderbook = { bids: [], asks: [] };

  wsClient.on('update', (data) => {
    if ((data.action === 'snapshot' || data.action === 'update') && Array.isArray(data.data)) {
      const depthData = data.data[0];
      if (!depthData) return;

      // --- update bids ---
      (depthData.bids || []).forEach(([price, quantity]) => {
        const p = parseFloat(price);
        const q = parseFloat(quantity);
        const idx = orderbook.bids.findIndex(([bp]) => bp === p);

        if (q === 0) {
          if (idx >= 0) orderbook.bids.splice(idx, 1);
        } else {
          if (idx >= 0) orderbook.bids[idx][1] = q;
          else orderbook.bids.push([p, q]);
        }
      });
      orderbook.bids.sort((a, b) => b[0] - a[0]);

      // --- update asks ---
      (depthData.asks || []).forEach(([price, quantity]) => {
        const p = parseFloat(price);
        const q = parseFloat(quantity);
        const idx = orderbook.asks.findIndex(([ap]) => ap === p);

        if (q === 0) {
          if (idx >= 0) orderbook.asks.splice(idx, 1);
        } else {
          if (idx >= 0) orderbook.asks[idx][1] = q;
          else orderbook.asks.push([p, q]);
        }
      });
      orderbook.asks.sort((a, b) => a[0] - b[0]);

      // --- ambil top 10 ---
      const bids = orderbook.bids.slice(0, 10).map(([price, qty]) => ({
        price,
        qty,
        type: 'bid',
      }));

      const asks = orderbook.asks.slice(0, 10).map(([price, qty]) => ({
        price,
        qty,
        type: 'ask',
      }));

      onUpdate([...bids, ...asks]);
    }
  });


  wsClient.on('open', (data) => console.log('WS connection opened:', data.wsKey));
  wsClient.on('response', (data) => console.log('WS response:', JSON.stringify(data, null, 2)));
  wsClient.on('reconnect', ({ wsKey }) => console.log('WS reconnecting...', wsKey));
  wsClient.on('reconnected', (data) => console.log('WS reconnected', data?.wsKey));
  wsClient.on('exception', (data) => console.error('WS error', data));
  wsClient.subscribeTopic("SPOT", 'books', symbol);

  activeBitgetOrderbooks.push({ wsClient, symbol });
  return wsClient;
}

function stopBitgetOrderbook() {
  activeBitgetOrderbooks.forEach((clientInfo) => {
    const { wsClient, symbol } = clientInfo;
    if (!wsClient) return;

    try {
      wsClient.unsubscribeTopic("SPOT", 'books', symbol);
      // wsClient.closeAll();
      console.log(`Stopped Bitget Orderbook: ${symbol}`);
    } catch (e) {
      console.error("Error stopping Bitget Orderbook:", e.message);
    }
  });

  activeBitgetOrderbooks = []; 
}
// fungsi untuk cek strength
function getBitgetConnection() {
  const now = Date.now();
  const diff = now - bitgetLastMessageTime;

  if (diff < 5000) return 100;
  if (diff < 10000) return 75;
  if (diff < 20000) return 50;
  if (diff < 30000) return 25;
  return 0;
}
module.exports = {
  startBitgetWS,
  stopBitgetWS,
  getBitgetOrderbook,
  stopBitgetOrderbook,
  getBitgetConnection,
}
// const dns = require('dns');
// const WebSocket = require('ws');

// const FIXED_URI = 'wss://ws.bitget.com/v2/ws/public';
// const BATCH_SIZE = 50;
// const PING_INTERVAL = 30000;
// const MAX_RECONNECT_ATTEMPTS = 5;
// const HEALTH_CHECK_INTERVAL = 120000;
// const INITIAL_RECONNECT_DELAY = 10000;

// const isReconnecting = {};
// const batchSymbolsMap = {};
// const reconnectTimers = {};
// const activeConnections = {};
// const failedBatches = new Set();

// let shouldReconnectBitget = true;
// let healthCheckTimer = null;

// // cek koneksi jaringan
// function checkNetworkConnectivity() {
//   return new Promise((resolve) => {
//     dns.lookup('google.com', (err) => resolve(!err));
//   });
// }

// // =======================
// // START
// // =======================
// function startBitgetWS(type = 'lastPrice', targetSymbols = [], callback) {
//   // Add 2 second delay before starting
//   // setTimeout(() => {
//     shouldReconnectBitget = true;
//     const lastPrices = {};
//     const reconnectAttempts = {};
//     let restartTimer = Date.now();

//     function clearReconnectTimer(batchId) {
//       if (reconnectTimers[batchId]) {
//         clearTimeout(reconnectTimers[batchId]);
//         delete reconnectTimers[batchId];
//       }
//     }

//     function runWS(symbolBatch, batchId = null, attempt = 0) {
//       if (!shouldReconnectBitget) {
//         console.log(`[Bitget] Autoreconnect disabled, aborting connection for ${batchId}`);
//         return;
//       }

//       if (!batchId) batchId = `batch_${Math.floor(Math.random() * 10000)}`;
//       if (attempt === 0) {
//         clearReconnectTimer(batchId);
//         isReconnecting[batchId] = false;
//         reconnectAttempts[batchId] = 0;
//       }

//       console.log(`[Bitget] Connecting ${batchId} to ${FIXED_URI} (${symbolBatch.length} symbols)`);
//       const ws = new WebSocket(FIXED_URI);

//       let pingInterval;
//       let pongTimeout;
//       let closedOrErrored = false;

//       function cleanup() {
//         clearInterval(pingInterval);
//         clearTimeout(pongTimeout);
//         console.log(`[Bitget] Closed ${batchId}`);
//         clearReconnectTimer(batchId);
//         if (activeConnections[batchId] === ws) delete activeConnections[batchId];
//         closedOrErrored = true;
//       }

//       ws.on('open', () => {
//         if (!shouldReconnectBitget) {
//           ws.close(1000, 'Service stopped');
//           return;
//         }
//         console.log(`[Bitget] Connected ${batchId}`);
//         activeConnections[batchId] = ws;
//         reconnectAttempts[batchId] = 0;
//         isReconnecting[batchId] = false;

//         // channel sesuai type
//         const channel = type === 'lastPrice' ? 'ticker' : 'books1';
//         ws.send(JSON.stringify({
//           op: 'subscribe',
//           args: symbolBatch.map((s) => ({
//             instType: 'SPOT',
//             channel,
//             instId: s.toUpperCase(),
//           })),
//         }));
//         console.log(`[Bitget] Subscribed ${batchId} to ${symbolBatch.length} symbols (${channel})`);

//         pingInterval = setInterval(() => {
//           if (!shouldReconnectBitget) {
//             cleanup();
//             ws.close(1000, 'Service stopped');
//             return;
//           }
//           if (ws.readyState === WebSocket.OPEN) {
//             ws.ping();
//             clearTimeout(pongTimeout);
//             pongTimeout = setTimeout(() => {
//               console.warn(`[Bitget] No pong from ${batchId}, reconnecting...`);
//               ws.close();
//             }, 30000);
//           }
//         }, PING_INTERVAL);
//       });

//       ws.on('message', (msg) => {
//         try {
//           const data = JSON.parse(msg);

//           if (data.op === 'pong' || data.event === 'pong') {
//             console.log("PONG BITGET")
//             clearTimeout(pongTimeout);
//             return;
//           }

//           if (data.action === 'snapshot' && Array.isArray(data.data)) {
//             const updates = [];

//             for (const item of data.data) {
//               if (type === 'lastPrice') {
//                 // last price mode
//                 const symbol = item.instId?.toUpperCase();
//                 const price = parseFloat(item.lastPr);
//                 if (!symbol || isNaN(price)) continue;
//                 if (lastPrices[symbol] !== price) {
//                   lastPrices[symbol] = price;
//                   updates.push({ symbol, price });
//                 }
//               } else {
//                 // orderbook mode
//                 const symbol = data.arg?.instId?.toUpperCase();
//                 if (!symbol) continue;
//                 const bestBid = item.bids?.length ? item.bids[0][0] : null;
//                 const bestAsk = item.asks?.length ? item.asks[0][0] : null;
//                 if (!bestBid || !bestAsk) continue;

//                 if (!lastPrices[symbol] ||
//                   lastPrices[symbol].bid !== bestBid ||
//                   lastPrices[symbol].ask !== bestAsk) {
//                   lastPrices[symbol] = { bid: bestBid, ask: bestAsk };
//                   updates.push({ symbol, bid: bestBid, ask: bestAsk });
//                 }
//               }
//             }

//             if (updates.length && shouldReconnectBitget) {
//               callback({ exchange: 'bitget', data: updates, batch_id: batchId, type });
//             }
//           }
//         } catch (err) {
//           console.error(`[Bitget] Message parse error in ${batchId}:`, err.message);
//         }
//       });

//       ws.on('close', (code, reason) => {
//         if (closedOrErrored) return;
//         console.warn(`[Bitget] Connection closed for ${batchId}: ${code} ${reason || 'No reason'}`);
//         cleanup();
//         if (shouldReconnectBitget) { tryReconnect(); }
//       });

//       ws.on('error', (err) => {
//         if (closedOrErrored) return;
//         console.error(`[Bitget] Error in ${batchId}:`, err.message);
//         cleanup();
//         if (shouldReconnectBitget) { tryReconnect(); }
//       });

//       async function tryReconnect() {
//         if (!shouldReconnectBitget) {
//           console.log(`[Bitget] Autoreconnect disabled, not reconnecting ${batchId}`);
//           isReconnecting[batchId] = false;
//           return;
//         }
//         if (isReconnecting[batchId]) {
//           console.log(`[Bitget] ${batchId} already reconnecting, skipping`);
//           return;
//         }
//         isReconnecting[batchId] = true;

//         const current = reconnectAttempts[batchId] || 0;
//         if (current >= MAX_RECONNECT_ATTEMPTS) {
//           console.error(`[Bitget] Max reconnection attempts reached for ${batchId}`);
//           failedBatches.add(batchId);
//           isReconnecting[batchId] = false;
//           return;
//         }
//         reconnectAttempts[batchId] = current + 1;

//         const hasNetwork = await checkNetworkConnectivity();
//         if (!hasNetwork) {
//           console.warn(`[Bitget] No network connectivity. Retry in 30s for ${batchId}`);
//           isReconnecting[batchId] = false;
//           reconnectTimers[batchId] = setTimeout(() => {
//             delete reconnectTimers[batchId];
//             if (shouldReconnectBitget) tryReconnect();
//           }, 30000);
//           return;
//         }

//         const delay = Math.min(INITIAL_RECONNECT_DELAY * Math.pow(2, current), 60000);
//         console.log(`[Bitget] Reconnecting ${batchId} in ${delay / 1000}s (attempt ${current + 1}/${MAX_RECONNECT_ATTEMPTS})`);
//         reconnectTimers[batchId] = setTimeout(() => {
//           delete reconnectTimers[batchId];
//           if (shouldReconnectBitget) runWS(symbolBatch, batchId, 0);
//         }, delay);
//       }
//     }

//     // jalankan batch
//     for (let i = 0; i < targetSymbols.length; i += BATCH_SIZE) {
//       const batch = targetSymbols.slice(i, i + BATCH_SIZE);
//       const batchId = `batch_${Math.floor(i / BATCH_SIZE) + 1}`;
//       batchSymbolsMap[batchId] = batch;
//       setTimeout(() => {
//         if (shouldReconnectBitget) runWS(batch, batchId);
//       }, i / BATCH_SIZE * 2000 + Math.random() * 1000);
//     }

//     const expectedBatches = Math.ceil(targetSymbols.length / BATCH_SIZE);
//     console.info(`[Bitget] Started ${expectedBatches} batches for ${targetSymbols.length} symbols (${type})`);

//     if (healthCheckTimer) clearInterval(healthCheckTimer);
//     healthCheckTimer = setInterval(() => {
//       if (!shouldReconnectBitget) {
//         clearInterval(healthCheckTimer);
//         healthCheckTimer = null;
//         return;
//       }
//       const activeCount = Object.keys(activeConnections).length;
//       const reconnectingCount = Object.values(isReconnecting).filter(Boolean).length;
//       const failedCount = failedBatches.size;

//       console.log(`[Bitget] Health: ${activeCount}/${expectedBatches} active, ${reconnectingCount} reconnecting, ${failedCount} failed`);
//     }, HEALTH_CHECK_INTERVAL);
//   // }, 2000);
// }

// // =======================
// // STOP
// // =======================
// function stopBitgetWS() {
//   console.log('[Bitget] Stopping all WebSocket connections...');
//   shouldReconnectBitget = false;

//   if (healthCheckTimer) {
//     clearInterval(healthCheckTimer);
//     healthCheckTimer = null;
//     console.log('[Bitget] Health check timer cleared');
//   }

//   // clear timers
//   Object.values(reconnectTimers).forEach(timer => {
//     try { clearTimeout(timer); } catch (e) {}
//   });
//   Object.keys(reconnectTimers).forEach(key => delete reconnectTimers[key]);

//   // close connections
//   Object.entries(activeConnections).forEach(([batchId, ws]) => {
//     try {
//       if (ws && ws.readyState === WebSocket.OPEN) {
//         ws.close(1000, 'Manual close');
//         console.log(`[Bitget] Closed connection for ${batchId}`);
//       }
//     } catch (e) {
//       console.error(`[Bitget] Error closing connection ${batchId}:`, e.message);
//     }
//   });
//   Object.keys(activeConnections).forEach(key => delete activeConnections[key]);

//   Object.keys(isReconnecting).forEach(key => { delete isReconnecting[key]; });
//   Object.keys(batchSymbolsMap).forEach(key => delete batchSymbolsMap[key]);
//   failedBatches.clear();

//   console.log(`[Bitget] All WebSocket connections and timers stopped successfully`);
// }


// const dns = require('dns');
// const WebSocket = require('ws');
// const FIXED_URI = 'wss://ws.bitget.com/v2/ws/public';
// const BATCH_SIZE = 50;
// const PING_INTERVAL = 30000;
// const MAX_RECONNECT_ATTEMPTS = 5;
// const HEALTH_CHECK_INTERVAL = 120000;
// const INITIAL_RECONNECT_DELAY = 10000;
// const isReconnecting = {};
// const batchSymbolsMap = {};
// const reconnectTimers = {};
// const activeConnections = {};
// const failedBatches = new Set();
// let shouldReconnectBitget = true;
// let healthCheckTimer = null;

// function checkNetworkConnectivity() {
//   return new Promise((resolve) => {dns.lookup('google.com', (err) => { resolve(!err);});});
// }
// function startBitgetLastPrice(targetSymbols = [], callback) {
//     // Add 2 second delay before starting the function
//     setTimeout(() => {
//         shouldReconnectBitget = true;
//         const lastPrices = {};
//         const reconnectAttempts = {};
//         let restartTimer = Date.now();
        
//         function clearReconnectTimer(batchId) {
//             if (reconnectTimers[batchId]) {
//                 clearTimeout(reconnectTimers[batchId]);
//                 delete reconnectTimers[batchId];
//             }
//         }
        
//         function runWS(symbolBatch, batchId = null, attempt = 0) {
//             if (!shouldReconnectBitget) {
//                 console.log(`[Bitget] Autoreconnect disabled, aborting connection for ${batchId}`);
//                 return;
//             }
//             if (!batchId) batchId = `batch_${Math.floor(Math.random() * 10000)}`;
//             if (attempt === 0) {
//                 clearReconnectTimer(batchId);
//                 isReconnecting[batchId] = false;
//                 reconnectAttempts[batchId] = 0;
//             }
//             console.log(`[Bitget] Connecting ${batchId} to ${FIXED_URI} (${symbolBatch.length} symbols)`);
            
//             const ws = new WebSocket(FIXED_URI);
//             let pingInterval;
//             let pongTimeout;
//             let closedOrErrored = false;
            
//             function cleanup() {
//                 clearInterval(pingInterval);
//                 clearTimeout(pongTimeout);
//                 console.log(`[Bitget] Closed ${batchId}`);
//                 clearReconnectTimer(batchId);
//                 if (activeConnections[batchId] === ws) delete activeConnections[batchId];
//                 closedOrErrored = true;
//             }
            
//             ws.on('open', () => {
//                 if (!shouldReconnectBitget) {
//                     ws.close(1000, 'Service stopped');
//                     return;
//                 }
//                 console.log(`[Bitget] Connected ${batchId}`);
//                 activeConnections[batchId] = ws;
//                 reconnectAttempts[batchId] = 0;
//                 isReconnecting[batchId] = false;
                
//                 ws.send(JSON.stringify({
//                     op: 'subscribe',
//                     args: symbolBatch.map((s) => ({
//                         instType: 'SPOT',
//                         channel: 'ticker',
//                         instId: s.toUpperCase(),
//                     })),
//                 }));
//                 console.log(`[Bitget] Subscribed ${batchId} to ${symbolBatch.length} symbols`);
                
//                 pingInterval = setInterval(() => {
//                     if (!shouldReconnectBitget) {
//                         cleanup();
//                         ws.close(1000, 'Service stopped');
//                         return;
//                     }
//                     if (ws.readyState === WebSocket.OPEN) {
//                         ws.send(JSON.stringify({ op: 'ping' }));
//                         clearTimeout(pongTimeout);
//                         pongTimeout = setTimeout(() => {
//                             console.warn(`[Bitget] No pong from ${batchId}, reconnecting...`);
//                             ws.close();
//                         }, 20000);
//                     }
//                 }, PING_INTERVAL);
//             });
            
//             ws.on('message', (msg) => {
//                 try {
//                     const data = JSON.parse(msg);
//                     if (data.op === 'pong' || data.event === 'pong') {
//                         clearTimeout(pongTimeout);
//                         return;
//                     }
//                     if (data.action === 'snapshot' && Array.isArray(data.data)) {
//                         const updates = [];
//                         for (const item of data.data) {
//                             const symbol = item.instId?.toUpperCase();
//                             const price = parseFloat(item.lastPr);
//                             if (!symbol || isNaN(price)) continue;
//                             if (lastPrices[symbol] !== price) {
//                                 lastPrices[symbol] = price;
//                                 updates.push({ symbol, price });
//                             }
//                         }
//                         if (updates.length && shouldReconnectBitget) {
//                             callback({ exchange: 'bitget', data: updates, batch_id: batchId });
//                         }
//                     }
//                 } catch (err) {
//                     console.error(`[Bitget] Message parse error in ${batchId}:`, err.message);
//                 }
//             });
            
//             ws.on('close', (code, reason) => {
//                 if (closedOrErrored) return;
//                 console.warn(`[Bitget] Connection closed for ${batchId}: ${code} ${reason || 'No reason'}`);
//                 cleanup();
//                 if (shouldReconnectBitget) { tryReconnect(); }
//             });
            
//             ws.on('error', (err) => {
//                 if (closedOrErrored) return;
//                 console.error(`[Bitget] Error in ${batchId}:`, err.message);
//                 cleanup();
//                 if (shouldReconnectBitget) { tryReconnect(); }
//             });
            
//             async function tryReconnect() {
//                 if (!shouldReconnectBitget) {
//                     console.log(`[Bitget] Autoreconnect disabled, not reconnecting ${batchId}`);
//                     isReconnecting[batchId] = false;
//                     return;
//                 }
//                 if (isReconnecting[batchId]) {
//                     console.log(`[Bitget] ${batchId} already reconnecting, skipping`);
//                     return;
//                 }
//                 isReconnecting[batchId] = true;
//                 const current = reconnectAttempts[batchId] || 0;
//                 if (current >= MAX_RECONNECT_ATTEMPTS) {
//                     console.error(`[Bitget] Max reconnection attempts reached for ${batchId}`);
//                     failedBatches.add(batchId);
//                     isReconnecting[batchId] = false;
//                     return;
//                 }
//                 reconnectAttempts[batchId] = current + 1;
//                 const hasNetwork = await checkNetworkConnectivity();
//                 if (!hasNetwork) {
//                     console.warn(`[Bitget] No network connectivity. Retry in 30s for ${batchId}`);
//                     isReconnecting[batchId] = false;
//                     reconnectTimers[batchId] = setTimeout(() => {
//                         delete reconnectTimers[batchId];
//                         if (shouldReconnectBitget) { tryReconnect(); }
//                     }, 30000);
//                     return;
//                 }
//                 const delay = Math.min(INITIAL_RECONNECT_DELAY * Math.pow(2, current), 60000);
//                 console.log(`[Bitget] Reconnecting ${batchId} in ${delay / 1000}s (attempt ${current + 1}/${MAX_RECONNECT_ATTEMPTS})`);
//                 reconnectTimers[batchId] = setTimeout(() => {
//                     delete reconnectTimers[batchId];
//                     if (shouldReconnectBitget) { runWS(symbolBatch, batchId, 0); }
//                 }, delay);
//             }
//         }
        
//         function restartFailedBatches() {
//             if (failedBatches.size === 0 || !shouldReconnectBitget) return;
//             console.log(`[Bitget] Restarting ${failedBatches.size} failed batches`);
//             const toRestart = [...failedBatches];
//             failedBatches.clear();
//             toRestart.forEach((batchId, index) => {
//                 const symbols = batchSymbolsMap[batchId];
//                 if (symbols && shouldReconnectBitget) {
//                     reconnectAttempts[batchId] = 0;
//                     isReconnecting[batchId] = false;
//                     clearReconnectTimer(batchId);
//                     setTimeout(() => {
//                         if (shouldReconnectBitget) { runWS(symbols, batchId, 0); }
//                     }, index * 2000 + Math.random() * 1000);
//                 }
//             });
//         }
        
//         for (let i = 0; i < targetSymbols.length; i += BATCH_SIZE) {
//             const batch = targetSymbols.slice(i, i + BATCH_SIZE);
//             const batchId = `batch_${Math.floor(i / BATCH_SIZE) + 1}`;
//             batchSymbolsMap[batchId] = batch;
//             setTimeout(() => {
//                 if (shouldReconnectBitget) { runWS(batch, batchId); }
//             }, i / BATCH_SIZE * 2000 + Math.random() * 1000);
//         }
        
//         const expectedBatches = Math.ceil(targetSymbols.length / BATCH_SIZE);
//         console.info(`[Bitget] Started ${expectedBatches} batches for ${targetSymbols.length} symbols`);
        
//         if (healthCheckTimer) { clearInterval(healthCheckTimer); }
//         healthCheckTimer = setInterval(() => {
//             if (!shouldReconnectBitget) {
//                 clearInterval(healthCheckTimer);
//                 healthCheckTimer = null;
//                 return;
//             }
//             const activeCount = Object.keys(activeConnections).length;
//             const reconnectingCount = Object.values(isReconnecting).filter(Boolean).length;
//             const failedCount = failedBatches.size;
//             console.log(`[Bitget] Health: ${activeCount}/${expectedBatches} active, ${reconnectingCount} reconnecting, ${failedCount} failed`);
            
//             if (activeCount < expectedBatches) {
//                 const ratio = activeCount / expectedBatches;
//                 if (ratio < 0.6 && Date.now() - restartTimer > 300000 && reconnectingCount === 0) {
//                     console.info('[Bitget] Low connection ratio, restarting failed batches...');
//                     restartFailedBatches();
//                     restartTimer = Date.now();
//                 }
//             }
//         }, HEALTH_CHECK_INTERVAL);
        
//     }, 2000); // 2 second delay before starting the function
// }
// function stopBitgetWS() {
//   console.log('[Bitget] Stopping all WebSocket connections...');
//   shouldReconnectBitget = false;
//   if (healthCheckTimer) {
//     clearInterval(healthCheckTimer);
//     healthCheckTimer = null;
//     console.log('[Bitget] Health check timer cleared');
//   }
//   const timerCount = Object.keys(reconnectTimers).length;
//   Object.values(reconnectTimers).forEach(timer => {
//     try {clearTimeout(timer); }
//     catch (e) { console.error('[Bitget] Error clearing timer:', e.message);}
//   });
//   Object.keys(reconnectTimers).forEach(key => delete reconnectTimers[key]);
//   console.log(`[Bitget] ${timerCount} reconnect timers cleared`);
//   const connectionCount = Object.keys(activeConnections).length;
//   Object.entries(activeConnections).forEach(([batchId, ws]) => {
//     try {
//       if (ws && ws.readyState === WebSocket.OPEN) {
//         ws.close(1000, 'Manual close');
//         console.log(`[Bitget] Closed connection for ${batchId}`);
//       }
//     } catch (e) { console.error(`[Bitget] Error closing connection ${batchId}:`, e.message); }
//   });
//   Object.keys(activeConnections).forEach(key => delete activeConnections[key]);
//   Object.keys(isReconnecting).forEach(key => {
//     isReconnecting[key] = false;
//     delete isReconnecting[key];
//   });
//   Object.keys(batchSymbolsMap).forEach(key => delete batchSymbolsMap[key]);
//   failedBatches.clear();
//   console.log(`[Bitget] All ${connectionCount} WebSocket connections and timers stopped successfully`);
// }

// Orderbook Single Pair Coin Request
// let currentBitgetOrderbookWS = null;
// let reconnectOrderbookTimer = null;
// let currentOrderbookSymbol = null;
// let currentOrderbookOnUpdate = null;
// let reconnectOrderbookDelay = 5000;
// let shouldReconnectOrderbook = true; 
// let orderbookPingInterval = null;
// let orderbookPongTimeout = null; 
// function connectBitgetOrderbook(symbol, onUpdate) {
//   if (currentBitgetOrderbookWS) { try { currentBitgetOrderbookWS.close(); } catch (e) {}currentBitgetOrderbookWS = null;}
//   if (orderbookPingInterval) { clearInterval(orderbookPingInterval); orderbookPingInterval = null;  }
//   if (orderbookPongTimeout) {clearTimeout(orderbookPongTimeout);orderbookPongTimeout = null;}
//   currentOrderbookSymbol = symbol;
//   currentOrderbookOnUpdate = onUpdate;
//   shouldReconnectOrderbook = true;
//   const ws = new WebSocket(FIXED_URI);
//   currentBitgetOrderbookWS = ws;
//   const fixSymbol = symbol + "USDT";
//   console.log(`[Bitget] Connecting orderbook for ${fixSymbol}...`);
//   ws.on('open', () => {
//     if (!shouldReconnectOrderbook) { ws.close(1000, 'Service stopped');return;}
//     console.log(`[Bitget] Connected orderbook for ${fixSymbol}`);
//     reconnectOrderbookDelay = 5000; 
//     ws.send(JSON.stringify({
//       op: 'subscribe',
//       args: [
//         {
//           instType: 'SPOT',
//           channel: 'books',
//           instId: fixSymbol.toUpperCase(),
//         }
//       ]
//     }));
//     orderbookPingInterval = setInterval(() => {
//       if (!shouldReconnectOrderbook) {
//         clearInterval(orderbookPingInterval);
//         clearTimeout(orderbookPongTimeout);
//         orderbookPingInterval = null;
//         orderbookPongTimeout = null;
//         ws.close(1000, 'Service stopped');
//         return;
//       }
//       if (ws.readyState === WebSocket.OPEN) {
//         ws.send(JSON.stringify({ op: 'ping' }));
//         clearTimeout(orderbookPongTimeout);
//         orderbookPongTimeout = setTimeout(() => {
//           console.warn(`[Bitget] No pong response for orderbook ${fixSymbol}, reconnecting...`);
//           ws.close();
//         }, 20000)
//       }
//     }, PING_INTERVAL)
//   });
//   ws.on('message', (raw) => {
//     try {
//       const msg = JSON.parse(raw);
//       if (msg.op === 'pong' || msg.event === 'pong') {clearTimeout(orderbookPongTimeout);return;}
//       if ((msg.action === 'snapshot' || msg.action === 'update') && Array.isArray(msg.data)) {
//         const bookData = msg.data[0];
//         if (!bookData) return;
//         const bids = (bookData.bids || []).map(([price, qty]) => ({price: parseFloat(price), qty: parseFloat(qty),type: 'bid',
//         })).slice(0, 10);
//         const asks = (bookData.asks || []).map(([price, qty]) => ({price: parseFloat(price), qty: parseFloat(qty), type: 'ask', })).slice(0, 10);
//         if (typeof onUpdate === 'function' && shouldReconnectOrderbook) {onUpdate([...bids, ...asks]);}
//       }
//     } catch (err) {console.error('[Bitget] Orderbook parse error:', err.message);}
//   });
//   ws.on('error', (err) => {
//     console.error('[Bitget] Orderbook WS error:', err.message);
//     if (orderbookPingInterval) {
//       clearInterval(orderbookPingInterval);
//       orderbookPingInterval = null;
//     }
//     if (orderbookPongTimeout) {
//       clearTimeout(orderbookPongTimeout);
//       orderbookPongTimeout = null;
//     }
//   });
//   ws.on('close', () => {
//     console.warn(`[Bitget] Orderbook WS closed for ${symbol}`);
//     if (orderbookPingInterval) {
//       clearInterval(orderbookPingInterval);
//       orderbookPingInterval = null;
//     }
//     if (orderbookPongTimeout) {
//       clearTimeout(orderbookPongTimeout);
//       orderbookPongTimeout = null;
//     }
//     if (symbol === currentOrderbookSymbol && shouldReconnectOrderbook) { scheduleReconnect() }
//   });
// }
// function scheduleReconnect() {
//   if (!shouldReconnectOrderbook) {console.log('[Bitget] Orderbook reconnect cancelled - service stopped');return;  }
//   if (reconnectOrderbookTimer) return;
//   console.log(`[Bitget] Reconnecting orderbook in ${reconnectOrderbookDelay / 1000}s...`);
//   reconnectOrderbookTimer = setTimeout(() => {
//     reconnectOrderbookTimer = null;
//     if (shouldReconnectOrderbook) {
//       connectBitgetOrderbook(currentOrderbookSymbol, currentOrderbookOnUpdate);
//       reconnectOrderbookDelay = Math.min(reconnectOrderbookDelay * 2, 60000); // exponential backoff max 60s
//     }
//   }, reconnectOrderbookDelay);
// }
// function getBitgetOrderboosk(symbol, onUpdate) {connectBitgetOrderbook(symbol, onUpdate);}
// function stopBitgetOrderbook() {
//   console.log('[Bitget] Stopping orderbook WebSocket connection...');
//   shouldReconnectOrderbook = false;
//   if (reconnectOrderbookTimer) {
//     clearTimeout(reconnectOrderbookTimer);
//     reconnectOrderbookTimer = null;
//     console.log('[Bitget] Orderbook reconnect timer cleared');
//   }
//   if (orderbookPingInterval) {
//     clearInterval(orderbookPingInterval);
//     orderbookPingInterval = null;
//     console.log('[Bitget] Orderbook ping interval cleared');
//   }
//   if (orderbookPongTimeout) {
//     clearTimeout(orderbookPongTimeout);
//     orderbookPongTimeout = null;
//     console.log('[Bitget] Orderbook pong timeout cleared');
//   }
//   if (currentBitgetOrderbookWS) {
//     try {
//       if (currentBitgetOrderbookWS.readyState === WebSocket.OPEN) {
//         currentBitgetOrderbookWS.close(1000, 'Manual close');
//         console.log('[Bitget] Orderbook WebSocket closed');
//       }
//     } catch (e) { console.error('[Bitget] Error closing orderbook WebSocket:', e.message);}
//   }
//   currentBitgetOrderbookWS = null;
//   currentOrderbookSymbol = null;
//   currentOrderbookOnUpdate = null;
//   reconnectOrderbookDelay = 5000;
//   console.log('[Bitget] Orderbook connection stopped completely');
// }

// Cek Koneksi Bitget Websocket
// function getBitgetConnection() {
//   if (typeof activeConnections === 'undefined' || !batchSymbolsMap) return 0;
//   const totalBatches = Object.keys(batchSymbolsMap).length;
//   if (totalBatches === 0) return 0;
//   const activeCount = Object.keys(activeConnections).length;
//   const reconnectingCount = Object.values(isReconnecting || {}).filter(Boolean).length;
//   const failedCount = failedBatches ? failedBatches.size : 0;
//   let percent = (activeCount / totalBatches) * 100;
//   percent -= (reconnectingCount / totalBatches) * 20
//   percent -= (failedCount / totalBatches) * 50
//   percent = Math.max(0, Math.min(100, Math.round(percent)));
//   return percent;
// }

// // Orderbook untuk keseluruhan symbol aktif
// function startBitgetOrderbook(targetSymbols = [], callback) {
//       setTimeout(() => {
//   shouldReconnectBitget = true;
//   const lastPrices = {};
//   const reconnectAttempts = {};
//   const reconnectTimers = {};
//   let restartTimer = Date.now();
//   function clearReconnectTimer(batchId) {
//     if (reconnectTimers[batchId]) {
//       clearTimeout(reconnectTimers[batchId]);
//       delete reconnectTimers[batchId];
//     }
//   }
//   function runWS(symbolBatch, batchId = null, attempt = 0) {
//     if (!shouldReconnectBitget) {console.log(`[Bitget] Autoreconnect disabled, aborting connection for ${batchId}`);return;}
//     if (!batchId) batchId = `batch_${Math.floor(Math.random() * 10000)}`;
//     if (attempt === 0) {
//       clearReconnectTimer(batchId);
//       isReconnecting[batchId] = false;
//       reconnectAttempts[batchId] = 0;
//     }
//     console.log(`[Bitget] Connecting ${batchId} to ${FIXED_URI} (${symbolBatch.length} symbols)`);
//     const ws = new WebSocket(FIXED_URI);
//     let pingInterval;
//     let pongTimeout;
//     let closedOrErrored = false;
//     function cleanup() {
//       clearInterval(pingInterval);
//       clearTimeout(pongTimeout);
//       console.log(`[Bitget] Closed ${batchId}`);
//       clearReconnectTimer(batchId);
//       if (activeConnections[batchId] === ws) delete activeConnections[batchId];
//       closedOrErrored = true;
//     }
//     ws.on('open', () => {
//       if (!shouldReconnectBitget) { ws.close(1000, 'Service stopped');return;}
//       console.log(`[Bitget] Connected ${batchId}`);
//       activeConnections[batchId] = ws;
//       reconnectAttempts[batchId] = 0;
//       isReconnecting[batchId] = false;
//       ws.send(JSON.stringify({
//         op: 'subscribe',
//         args: symbolBatch.map((s) => ({
//           instType: 'SPOT',
//           channel: 'books1',
//           instId: s.toUpperCase(),
//         })),
//       }));
//       console.log(`[Bitget] Subscribed ${batchId} to ${symbolBatch.length} symbols`);
//       pingInterval = setInterval(() => {
//         if (!shouldReconnectBitget) {
//           cleanup();
//           ws.close(1000, 'Service stopped');
//           return;
//         }
//         if (ws.readyState === WebSocket.OPEN) {
//           ws.send(JSON.stringify({ op: 'ping' }));
//           clearTimeout(pongTimeout);
//           pongTimeout = setTimeout(() => {
//             console.warn(`[Bitget] No pong from ${batchId}, reconnecting...`);
//             ws.close();
//           }, 20000);
//         }
//       }, PING_INTERVAL);
//     });
//     ws.on('message', (msg) => {
//       try {
//         const data = JSON.parse(msg);
//         if (data.op === 'pong' || data.event === 'pong') {clearTimeout(pongTimeout);return;}
//         if (data.action === 'snapshot' && Array.isArray(data.data)) {
//           const updates = [];
//           for (const item of data.data) {
//             const symbol = data.arg?.instId?.toUpperCase();
//             if (!symbol) continue;
//             const bestBid = item.bids?.length ? item.bids[0][0] : null;
//             const bestAsk = item.asks?.length ? item.asks[0][0] : null;
//             if (!bestBid || !bestAsk) continue;
//             if (!lastPrices[symbol] || lastPrices[symbol].bid !== bestBid ||lastPrices[symbol].ask !== bestAsk) {
//               lastPrices[symbol] = { bid: bestBid, ask: bestAsk };
//               updates.push({ symbol, bid: bestBid, ask: bestAsk });
//             }
//           }
//           if (updates.length) {callback({ exchange: 'bitget', data: updates, batch_id: batchId });}
//         }
//       } catch (err) { console.error(`[Bitget] Message parse error in ${batchId}:`, err.message);}
//     });
//     ws.on('close', (code, reason) => {
//       if (closedOrErrored) return;
//       closedOrErrored = true;
//       console.warn(`[Bitget] Connection closed for ${batchId}: ${code} ${reason || 'No reason'}`);
//       cleanup();
//       if (shouldReconnectBitget) {tryReconnect();}
//     });
//     ws.on('error', (err) => {
//       if (closedOrErrored) return;
//       closedOrErrored = true;
//       console.error(`[Bitget] Error in ${batchId}:`, err.message);
//       cleanup();
//       if (shouldReconnectBitget) {tryReconnect();}
//     });
//     async function tryReconnect() {
//       if (!shouldReconnectBitget) {
//         console.log(`[Bitget] Autoreconnect disabled, not reconnecting ${batchId}`);
//         isReconnecting[batchId] = false;
//         return;
//       }
//       if (isReconnecting[batchId]) {console.log(`[Bitget] ${batchId} already reconnecting, skipping`);return;}
//       isReconnecting[batchId] = true; 
//       const current = reconnectAttempts[batchId] || 0;
//       if (current >= MAX_RECONNECT_ATTEMPTS) {
//         console.error(`[Bitget] Max reconnection attempts reached for ${batchId}`);
//         failedBatches.add(batchId);
//         isReconnecting[batchId] = false;
//         return;
//       }
//       reconnectAttempts[batchId] = current + 1;
//       const hasNetwork = await checkNetworkConnectivity();
//       if (!hasNetwork) {
//         console.warn(`[Bitget] No network connectivity. Retry in 30s for ${batchId}`);
//         isReconnecting[batchId] = false;
//         reconnectTimers[batchId] = setTimeout(() => {
//           delete reconnectTimers[batchId];
//           tryReconnect();
//         }, 30000);
//         return;
//       }
//       const delay = Math.min(INITIAL_RECONNECT_DELAY * Math.pow(2, current), 60000);
//       console.log(`[Bitget] Reconnecting ${batchId} in ${delay / 1000}s (attempt ${current + 1}/${MAX_RECONNECT_ATTEMPTS})`);
//       reconnectTimers[batchId] = setTimeout(() => {
//         delete reconnectTimers[batchId];
//         if (shouldReconnectBitget) {runWS(symbolBatch, batchId, 0);} }, delay);
//     }
//   }
//   function restartFailedBatches() {
//     if (failedBatches.size === 0) return;
//     console.log(`[Bitget] Restarting ${failedBatches.size} failed batches`);
//     const toRestart = [...failedBatches];
//     failedBatches.clear();
//     toRestart.forEach((batchId, index) => {
//       const symbols = batchSymbolsMap[batchId];
//       if (symbols) {
//         reconnectAttempts[batchId] = 0;
//         isReconnecting[batchId] = false;
//         clearReconnectTimer(batchId);
//         setTimeout(() => {
//           runWS(symbols, batchId, 0);
//         }, index * 2000 + Math.random() * 1000);
//       }
//     });
//   }
//   for (let i = 0; i < targetSymbols.length; i += BATCH_SIZE) {
//     const batch = targetSymbols.slice(i, i + BATCH_SIZE);
//     const batchId = `batch_${Math.floor(i / BATCH_SIZE) + 1}`;
//     batchSymbolsMap[batchId] = batch;
//     setTimeout(() => {
//       if (shouldReconnectBitget) {runWS(batch, batchId); }
//     }, i / BATCH_SIZE * 2000 + Math.random() * 1000);
//   }
//   const expectedBatches = Math.ceil(targetSymbols.length / BATCH_SIZE);
//   console.info(`[Bitget] Started ${expectedBatches} batches for ${targetSymbols.length} symbols`);
//   if (healthCheckTimer) { clearInterval(healthCheckTimer);}
//   healthCheckTimer = setInterval(() => {
//     if (!shouldReconnectBitget) {
//       clearInterval(healthCheckTimer);
//       healthCheckTimer = null;
//       return;
//     }
//     const activeCount = Object.keys(activeConnections).length;
//     const reconnectingCount = Object.values(isReconnecting).filter(Boolean).length;
//     const failedCount = failedBatches.size;
//     console.log(`[Bitget] Health: ${activeCount}/${expectedBatches} active, ${reconnectingCount} reconnecting, ${failedCount} failed`);
//     if (activeCount < expectedBatches) {
//       const ratio = activeCount / expectedBatches;
//       if (ratio < 0.6 && Date.now() - restartTimer > 300000 && reconnectingCount === 0) {
//         console.info('[Bitget] Low connection ratio, restarting failed batches...');
//         restartFailedBatches();
//         restartTimer = Date.now();
//       }
//     }
//   }, HEALTH_CHECK_INTERVAL);
//   }, 2000); // 2 second delay before starting the function
// }