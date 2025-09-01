const axios = require('axios');
async function fetchValidPairs(quote = "USDT") {
  try {
    const response = await axios.get("https://api.gateio.ws/api/v4/spot/currency_pairs");
    const data = response.data;
    return new Set(data.filter(item => item.quote === quote && item.trade_status === "tradable").map(item => item.id.toUpperCase().replace("_", "")));
  }
  catch (err) {console.error("[Gate.io] Failed to fetch valid pairs:", err);return new Set();  }
}
const { DefaultLogger, WebsocketClient } = require('gateio-api')
const { chunkArray } = require('../utils/helper')

let gateioLastMessageTime = 0;
let activeGateioOrderbooks = [];
let activeGateioWS = [];
let activeGateioCallbacks = {}; // Menyimpan callbacks berdasarkan type
let sharedGateioWSClient = null; // Satu WS client yang dibagi untuk semua type
let sharedGateioLastPrices = {}; // Shared state untuk lastPrices
let sharedGateioOrderbooks = {}; // Shared state untuk orderbooks

const logger = {
  ...DefaultLogger,
  trace:(...params) => {console.log('trace', ...params)}
}


async function startGateioWS(type, targetSymbols, callback) {
  // Jika sudah ada WS aktif, tinggal tambah callback
  if (sharedGateioWSClient) {
    console.log(`Reusing existing Gate.io WS connection for type: ${type}`);
    
    // Tambah callback untuk type ini
    if (!activeGateioCallbacks[type]) {
      activeGateioCallbacks[type] = [];
    }
    activeGateioCallbacks[type].push(callback);
    
    return sharedGateioWSClient;
  }

  console.log(`Creating new Gate.io WS connection for type: ${type}`);

  const validSymbols = await fetchValidPairs();
  const filteredSymbols = targetSymbols
    .filter(symbol => validSymbols.has(symbol))
    .map(symbol => symbol.replace("USDT", "_USDT"));

  const wsClient = new WebsocketClient({}, logger)
  sharedGateioWSClient = wsClient; // Set sebagai shared client

  // Initialize callbacks array untuk type ini
  if (!activeGateioCallbacks[type]) {
    activeGateioCallbacks[type] = [];
  }
  activeGateioCallbacks[type].push(callback);

  wsClient.on('open', (data) => {console.log('ws opened:', data.wsKey)})
  wsClient.on('response', (data) => {console.log('ws response:', data)})
  wsClient.on('reconnect', (data) => {console.log('ws reconnect:', data)})
  wsClient.on('reconnected', (data) => {console.log('ws reconnected:', data)})
  wsClient.on('exception', (data) => {console.warn('ws exception:', data)})
  wsClient.on('close', (data) => {console.log('ws closed:', data)})

  wsClient.on('update', (data) => {
    gateioLastMessageTime = Date.now()

    const lastPriceUpdates = []
    const orderbookUpdates = []
    const payload = data.result
    const symbol = payload.currency_pair.replace("_", "")

    // Process lastPrice updates
    const price = payload.last
    if (sharedGateioLastPrices[symbol] !== price){
      sharedGateioLastPrices[symbol] = price
      lastPriceUpdates.push({symbol, price})
    }

    // Process orderbook updates
    const bid = payload.highest_bid
    const ask = payload.lowest_ask

    const prev = sharedGateioOrderbooks[symbol] || {}
    if (prev.bid !== bid || prev.ask !== ask){
      sharedGateioOrderbooks[symbol] = { bid, ask }
      orderbookUpdates.push({symbol, bid, ask})
    }

    // Kirim update ke callbacks sesuai type
    if (lastPriceUpdates.length > 0 && activeGateioCallbacks['lastPrice']) {
      activeGateioCallbacks['lastPrice'].forEach(cb => {
        if (typeof cb === "function") {
          cb(lastPriceUpdates);
        }
      });
    }

    if (orderbookUpdates.length > 0 && activeGateioCallbacks['orderbook']) {
      activeGateioCallbacks['orderbook'].forEach(cb => {
        if (typeof cb === "function") {
          cb(orderbookUpdates);
        }
      });
    }
  })

  const batch = chunkArray(filteredSymbols, 20)

  batch.forEach((batches, idx) => {
    setTimeout(() => {
      const request = { topic: 'spot.tickers', payload: batches }
      wsClient.subscribe(request, 'spotV4')
    }, idx * 500) // tiap batch jeda 500ms
  })
  activeGateioWS.push({ wsClient, type, filteredSymbols });
}

function stopGateioWS(){
  // console.log(activeGateioWS[0])
  const { wsClient, type, filteredSymbols } = activeGateioWS[0]

  const batch = chunkArray(filteredSymbols, 20)
  for (const batches of batch) {
    const request = {
      topic: 'spot.tickers',
      payload: batches
    }
    wsClient.unsubscribe(request, 'spotV4')     
  }
  wsClient.removeAllListeners()
  wsClient.closeAll()
  activeGateioWS = []
  activeGateioCallbacks = {}; // Reset callbacks
  sharedGateioWSClient = null; // Reset shared client
  sharedGateioLastPrices = {}; // Reset shared state
  sharedGateioOrderbooks = {}; // Reset shared state
}

function getGateioOrderbook(targetSymbol, callback){
  const symbol = targetSymbol + "_USDT"

  const wsClient = new WebsocketClient({}, logger)

  wsClient.on('open', (data) => {console.log("ws opened:", data.wsKey)})
  wsClient.on('response', (data) => {console.log("ws response:", data)})
  wsClient.on('reconnect', (data) => {console.log("ws reconnect:", data)})
  wsClient.on('reconnected', (data) => {console.log("ws reconnected:", data)})
  wsClient.on('exception', (data) => {console.warn("ws exception:", data)})
  wsClient.on('close', (data) => {console.log("ws closed:", data)})

  const orderbook = { bids:[], asks: []}
  wsClient.on('update', (data) =>{
    const payload = data.result

    if (data.event === "snapshot") {
      orderbook.bids = (payload.bids || []).map(([p, q]) => [parseFloat(p), parseFloat(q)])
      orderbook.asks = (payload.asks || []).map(([p, q]) => [parseFloat(p), parseFloat(q)])

      orderbook.bids.sort((a, b) => b[0] - a[0])
      orderbook.bids = orderbook.bids.slice(0, 50)

      orderbook.asks.sort((a, b) => a[0] - b[0])
      orderbook.asks = orderbook.asks.slice(0, 50)

      return
    }

    if (data.event === "update") {
      if (!Array.isArray(orderbook.bids)) orderbook.bids = []
      if (!Array.isArray(orderbook.asks)) orderbook.asks = []

      if (Array.isArray(payload.bids)) {
        payload.bids.forEach(([price, quantity]) => {
          const prc = parseFloat(price)
          const qty = parseFloat(quantity)
          const idx = orderbook.bids.findIndex(([bidPrice]) => bidPrice === prc)

          if (qty === 0) {
            if (idx >= 0) orderbook.bids.splice(idx, 1)
          } else {
            if (idx >= 0) orderbook.bids[idx][1] = qty
            else orderbook.bids.push([prc, qty])
          }
        })
      }

      orderbook.bids.sort((a, b) => b[0] - a[0])
      orderbook.bids = orderbook.bids.slice(0, 50)

      if (Array.isArray(payload.asks)) {
        payload.asks.forEach(([price, quantity]) => {
          const prc = parseFloat(price)
          const qty = parseFloat(quantity)
          const idx = orderbook.asks.findIndex(([askPrice]) => askPrice === prc)

          if (qty === 0) {
            if (idx >= 0) orderbook.asks.splice(idx, 1)
          } else {
            if (idx >= 0) orderbook.asks[idx][1] = qty
            else orderbook.asks.push([prc, qty])
          }
        })
      }

      orderbook.asks.sort((a, b) => a[0] - b[0])
      orderbook.asks = orderbook.asks.slice(0, 50)

      const bids = orderbook.bids.slice(0, 10).map(([price, qty]) => ({
        price,
        qty,
        type: "bid",
      }))
      const asks = orderbook.asks.slice(0, 10).map(([price, qty]) => ({
        price,
        qty,
        type: "ask",
      }))

      callback([...bids, ...asks])
    }
  })

  const request = {
    topic: "spot.order_book",
    payload: [symbol, "10", "100ms"]
  }
  wsClient.subscribe(request, 'spotV4')

  activeGateioOrderbooks.push({wsClient, symbol})
}

function stopGateioOrderbook(){
  activeGateioOrderbooks.forEach((data) => {
    const { wsClient, symbol } = data
    if (!wsClient) return
  
    try{
      const request = {
        topic: "spot.order_book",
        payload: [symbol, "10", "100ms"]
      }
      wsClient.unsubscribe(request, 'spotV4')
      console.log("Orderbook stopped:", symbol)
    } catch (error){
      console.error("Error:", error.message)
    }
  })

  activeGateioOrderbooks =[]
}

function getGateioConnection(){
  const now = Date.now()
  const diff = now - gateioLastMessageTime

  if (diff < 5000) return 100;
  if (diff < 10000) return 75;
  if (diff < 20000) return 50;
  if (diff < 30000) return 25;
  return 0;
}
module.exports = {
  startGateioWS,
  stopGateioWS,
  getGateioOrderbook,
  stopGateioOrderbook,
  getGateioConnection,
};

// const WebSocket = require('ws');

// const lastPrices = {};
// const WEBSOCKET_URI = "wss://api.gateio.ws/ws/v4/";
// let shouldReconnectGateio = true;
// let currentGateioWSConnections = [];
// const BATCH_SIZE = 20;
// const gateioLatencyMap = new Map();
// let gateioReconnectTimers = [];

// async function startGateisoWS(type, targetSymbols, callback) {
//   try {
//     // langsung tunggu stop dulu sebelum mulai baru
//     await stopGateioWS();  
//     shouldReconnectGateio = true;

//     const validSymbols = await fetchValidPairs();
//     if (!shouldReconnectGateio) {
//       console.log("[Gate.io] Service stopped during symbol validation");
//       return;
//     }

//     const filteredSymbols = targetSymbols.filter(s => validSymbols.has(s));
//     if (filteredSymbols.length === 0) {
//       console.warn("[Gate.io] No valid symbols to subscribe.");
//       return;
//     }

//     console.log(
//       `[Gate.io] Starting ${Math.ceil(filteredSymbols.length / BATCH_SIZE)} batches (${type}) for ${filteredSymbols.length} symbols`
//     );

//     for (let i = 0; i < filteredSymbols.length; i += BATCH_SIZE) {
//       const batch = filteredSymbols.slice(i, i + BATCH_SIZE);
//       const batchId = `${type}_batch_${Math.floor(i / BATCH_SIZE)}`;
//       setTimeout(() => {
//         if (shouldReconnectGateio)
//           startBatchGateio(type, batch, callback, batchId);
//       }, (i / BATCH_SIZE) * 1000);
//     }
//   } catch (err) {
//     console.error("[Gate.io] Error in startGateioWS:", err.message);
//   }
// }
// /** Core batch handler (both lastPrice & orderbook) */
// function startBatchGateio(type, pairsBatch, callback, batchId = 'unknown') {
//   if (!shouldReconnectGateio) {
//     console.log(`[Gate.io] Service stopped, aborting connection for ${batchId}`);
//     return;
//   }

//   const ws = new WebSocket(WEBSOCKET_URI);
//   ws.batchId = batchId;
//   ws.type = type;
//   ws.pairsBatch = pairsBatch;
//   ws.callback = callback;
//   ws.lastUpdateTime = null;

//   currentGateioWSConnections.push(ws);
//   gateioLatencyMap.set(ws, 100);

//   ws.on('open', () => {
//     if (!shouldReconnectGateio) {
//       ws.close(1000, 'Service stopped');
//       return;
//     }

//     const payloadPairs = pairsBatch.map(s => s.replace("USDT", "_USDT"));
//     const subMsg = {
//       time: 0,
//       channel: "spot.tickers",
//       event: "subscribe",
//       payload: payloadPairs,
//     };
//     ws.send(JSON.stringify(subMsg));
//     console.log(`[Gate.io] Connected ${batchId} (${type}): ${payloadPairs.join(', ')}`);
//   });

//   ws.on('message', (message) => {
//     try {
//       const data = JSON.parse(message);
//       if (data.event !== 'update' || typeof data.result !== 'object') return;

//       const result = data.result;
//       const rawSymbol = result.currency_pair;
//       if (!rawSymbol) return;

//       const symbol = rawSymbol.replace("_", "");

//       if (type === "lastPrice") {
//         const price = result.last;
//         if (!price) return;

//         // update latency
//         const now = Date.now();
//         if (ws.lastUpdateTime) {
//           const delta = now - ws.lastUpdateTime;
//           const alpha = 0.2;
//           const prev = gateioLatencyMap.get(ws) || delta;
//           gateioLatencyMap.set(ws, prev * (1 - alpha) + delta * alpha);
//         }
//         ws.lastUpdateTime = now;

//         if (lastPrices[symbol] !== price && shouldReconnectGateio) {
//           lastPrices[symbol] = price;
//           callback({
//             exchange: "gateio",
//             type,
//             data: [{ symbol, price }],
//             batch_id: batchId
//           });
//         }
//       }

//       else if (type === "orderbook") {
//         const bestBid = result.highest_bid;
//         const bestAsk = result.lowest_ask;
//         if (!bestBid || !bestAsk) return;

//         const prevBid = lastBook[symbol]?.bid;
//         const prevAsk = lastBook[symbol]?.ask;
//         const isBidChanged = bestBid !== prevBid;
//         const isAskChanged = bestAsk !== prevAsk;

//         if (isBidChanged || isAskChanged) {
//           lastBook[symbol] = { bid: bestBid, ask: bestAsk };
//           callback({
//             exchange: "gateio",
//             type,
//             data: [{ symbol, bid: bestBid, ask: bestAsk }],
//             batch_id: batchId
//           });
//         }
//       }
//     } catch (err) {
//       console.error(`[Gate.io] Error parsing message in ${batchId}:`, err.message);
//     }
//   });

//   ws.on('error', (err) => {
//     console.error(`[Gate.io] WS error in ${batchId}:`, err.message);
//     gateioLatencyMap.delete(ws);
//     const wsIndex = currentGateioWSConnections.findIndex(connection => connection === ws);
//     if (wsIndex > -1) currentGateioWSConnections.splice(wsIndex, 1);
//   });

//   ws.on('close', (code, reason) => {
//     console.warn(`[Gate.io] Connection closed for ${batchId}: ${code} ${reason || 'No reason'}`);
//     gateioLatencyMap.delete(ws);

//     const wsIndex = currentGateioWSConnections.findIndex(connection => connection === ws);
//     if (wsIndex > -1) currentGateioWSConnections.splice(wsIndex, 1);

//     if (shouldReconnectGateio) {
//       console.log(`[Gate.io] Reconnecting ${batchId} in 5s...`);
//       const reconnectTimer = setTimeout(() => {
//         const timerIndex = gateioReconnectTimers.indexOf(reconnectTimer);
//         if (timerIndex > -1) gateioReconnectTimers.splice(timerIndex, 1);
//         if (shouldReconnectGateio) {
//           startBatchGateio(type, pairsBatch, callback, batchId);
//         }
//       }, 5000);
//       gateioReconnectTimers.push(reconnectTimer);
//     } else {
//       console.log(`[Gate.io] Manual stop for ${batchId}, not reconnecting`);
//     }
//   });
// }
// /** Stop everything */
// async function stopGateioWSs() {
//   console.log('[Gate.io] Stopping all WebSocket connections...');
//   shouldReconnectGateio = false;

//   // Bersihkan timer reconnect
//   gateioReconnectTimers.forEach(timer => clearTimeout(timer));
//   gateioReconnectTimers = [];

//   const connectionCount = currentGateioWSConnections.length;

//   // Tutup semua koneksi dengan Promise
//   const closePromises = currentGateioWSConnections.map((ws, index) => {
//     return new Promise((resolve) => {
//       try {
//         gateioLatencyMap.delete(ws);

//         if (ws && ws.readyState === WebSocket.OPEN) {
//           ws.once('close', () => {
//             resolve(`[Gate.io] Connection ${ws.batchId || index} closed`);
//           });
//           ws.close(1000, 'Manual close');
//         } else {
//           resolve(`[Gate.io] Connection ${ws.batchId || index} already closed`);
//         }
//       } catch (e) {
//         console.error(`[Gate.io] Error closing connection ${ws.batchId || index}:`, e.message);
//         resolve(`[Gate.io] Connection ${ws.batchId || index} forced resolve`);
//       }
//     });
//   });

//   await Promise.all(closePromises);

//   // Bersihkan state setelah semua close selesai
//   currentGateioWSConnections = [];
//   gateioLatencyMap.clear();
//   Object.keys(lastPrices).forEach(key => delete lastPrices[key]);
//   Object.keys(lastBook).forEach(key => delete lastBook[key]);

//   console.log(`[Gate.io] All ${connectionCount} WebSocket connections and timers stopped successfully`);
// }


// function startGateioLastPrice(targetSymbols, callback) {
//       setTimeout(() => {
//   shouldReconnectGateio = true;
//   fetchValidPairs().then(validSymbols => {
//     if (!shouldReconnectGateio) {console.log("[Gate.io] Service stopped during symbol validation");return;}
//     const filteredSymbols = targetSymbols.filter(s => validSymbols.has(s));
//     if (filteredSymbols.length === 0) {console.warn("[Gate.io] No valid symbols to subscribe.");return;}
//     console.log(`[Gate.io] Starting ${Math.ceil(filteredSymbols.length / BATCH_SIZE)} batches for ${filteredSymbols.length} symbols`);
//     for (let i = 0; i < filteredSymbols.length; i += BATCH_SIZE) {
//       const batch = filteredSymbols.slice(i, i + BATCH_SIZE);
//       const batchId = `batch_${Math.floor(i / BATCH_SIZE)}`;
//       setTimeout(() => {
//         if (shouldReconnectGateio) { startBatch(batch, callback, batchId);}
//       }, (i / BATCH_SIZE) * 1000);
//     }
//   }).catch(err => {console.error("[Gate.io] Error in startGateioWS:", err.message);});
// }, 2000)
// }

// // function startBatch(pairsBatch, callback, batchId = 'unknown') {
// //   if (!shouldReconnectGateio) {console.log(`[Gate.io] Service stopped, aborting connection for ${batchId}`);return;}
// //   const ws = new WebSocket(WEBSOCKET_URI);
// //   ws.batchId = batchId; 
// //   ws.pairsBatch = pairsBatch;
// //   ws.callback = callback; 
// //   currentGateioWSConnections.push(ws);
// //   ws.lastUpdateTime = null;
// //   gateioLatencyMap.set(ws, 100);
// //   ws.on('open', () => {
// //     if (!shouldReconnectGateio) { ws.close(1000, 'Service stopped');return;}
// //     const payloadPairs = pairsBatch.map(s => s.replace("USDT", "_USDT"));
// //     const subMsg = {
// //       time: 0,
// //       channel: "spot.tickers",
// //       event: "subscribe",
// //       payload: payloadPairs,
// //     };
// //     ws.send(JSON.stringify(subMsg));
// //     console.log(`[Gate.io] Connected ${batchId}: ${payloadPairs.join(', ')}`);
// //   });
// //   ws.on('message', (message) => {
// //     try {
// //       const data = JSON.parse(message);
// //       if (data.event !== 'update' || typeof data.result !== 'object') return;
// //       const result = data.result;
// //       const rawSymbol = result.currency_pair;
// //       const price = result.last;
// //       if (!rawSymbol || !price) return;
// //       const symbol = rawSymbol.replace("_", "");
// //       const now = Date.now();
// //       if (ws.lastUpdateTime) {
// //         const delta = now - ws.lastUpdateTime;
// //         const alpha = 0.2;
// //         const prev = gateioLatencyMap.get(ws) || delta;
// //         gateioLatencyMap.set(ws, prev * (1 - alpha) + delta * alpha);
// //       }
// //       ws.lastUpdateTime = now;
// //       if (lastPrices[symbol] !== price && shouldReconnectGateio) {
// //         lastPrices[symbol] = price;
// //         callback({
// //           exchange: "gateio", 
// //           data: [{ symbol, price }],
// //           batch_id: batchId
// //         });
// //       }
// //     }
// //     catch (err) { console.error(`[Gate.io] Error parsing message in ${batchId}:`, err.message); }
// //   });
// //   ws.on('error', (err) => {
// //     console.error(`[Gate.io] WS error in ${batchId}:`, err.message);
// //     gateioLatencyMap.delete(ws);
// //     const wsIndex = currentGateioWSConnections.findIndex(connection => connection === ws);
// //     if (wsIndex > -1) currentGateioWSConnections.splice(wsIndex, 1);
// //   });
// //   ws.on('close', (code, reason) => {
// //     console.warn(`[Gate.io] Connection closed for ${batchId}: ${code} ${reason || 'No reason'}`);
// //     gateioLatencyMap.delete(ws);
// //     const wsIndex = currentGateioWSConnections.findIndex(connection => connection === ws);
// //     if (wsIndex > -1) currentGateioWSConnections.splice(wsIndex, 1);
// //     if (shouldReconnectGateio) {
// //       console.log(`[Gate.io] Reconnecting ${batchId} in 5s...`);
// //       const reconnectTimer = setTimeout(() => {
// //         const timerIndex = gateioReconnectTimers.indexOf(reconnectTimer);
// //         if (timerIndex > -1) gateioReconnectTimers.splice(timerIndex, 1);
// //         if (shouldReconnectGateio) {
// //           startBatch(pairsBatch, callback, batchId);
// //         }
// //       }, 5000);
// //       gateioReconnectTimers.push(reconnectTimer);
// //     }
// //     else {console.log(`[Gate.io] Manual stop for ${batchId}, not reconnecting`);}
// //   });
// // }

// // function stopGateioWS() {
// //   console.log('[Gate.io] Stopping all WebSocket connections...');
// //   shouldReconnectGateio = false;
// //   gateioReconnectTimers.forEach(timer => {
// //     try {clearTimeout(timer);}
// //     catch (e) { console.error('[Gate.io] Error clearing reconnect timer:', e.message); }
// //   });
// //   gateioReconnectTimers = [];
// //   const connectionCount = currentGateioWSConnections.length;
// //   currentGateioWSConnections.forEach((ws, index) => {
// //     try {
// //       gateioLatencyMap.delete(ws);
// //       if (ws && ws.readyState === WebSocket.OPEN) {
// //         ws.close(1000, 'Manual close');
// //       }
// //     } catch (e) {console.error(`[Gate.io] Error closing connection ${ws.batchId || index}:`, e.message);}
// //   });
// //   currentGateioWSConnections = [];
// //   if (currentGateioOrderbookWS) {
// //     try {
// //       if (currentGateioOrderbookWS.readyState === WebSocket.OPEN) {
// //         currentGateioOrderbookWS.close(1000, 'Manual close');
// //       }
// //     } catch (e) {console.error('[Gate.io] Error closing orderbook connection:', e.message); }
// //     currentGateioOrderbookWS = null;
// //   }
// //   gateioLatencyMap.clear();
// //   Object.keys(lastPrices).forEach(key => delete lastPrices[key]);
// //   Object.keys(lastBook).forEach(key => delete lastBook[key]);
// //   console.log(`[Gate.io] All ${connectionCount} WebSocket connections and timers stopped successfully`);
// // }

// function getGateioConnections() {
//   if (currentGateioWSConnections.length === 0) return 0;
//   const latencies = Array.from(gateioLatencyMap.values());
//   if (latencies.length === 0) return 0;
//   const avgLatency = latencies.reduce((a,b)=>a+b,0)/latencies.length;
//   const percent = Math.max(0, Math.min(100, Math.round((2000 - avgLatency)/2000*100)));
//   return percent;
// }

// let currentGateioOrderbookWS = null;
// function getGateioOrderbookss(symbol, callback) {
//   if (currentGateioOrderbookWS) {
//     currentGateioOrderbookWS.close();
//     currentGateioOrderbookWS = null;
//   }
//   const pair = `${symbol}_USDT`;
//   const ws = new WebSocket(WEBSOCKET_URI);
//   currentGateioOrderbookWS = ws;
//   ws.on("open", () => {
//     const subMsg = {
//       time: 0,
//       channel: "spot.order_book_update",
//       event: "subscribe",
//       payload: [pair, "10", "100ms"],
//     };
//     ws.send(JSON.stringify(subMsg));
//     console.log(`[Gate.io] Subscribed orderbook for ${pair}`);
//   });
//   ws.on("message", (message) => {
//     try {
//       const data = JSON.parse(message);
//       if (data.event !== "update" || !data.result) return;
//       const { bids = [], asks = [] } = data.result;
//       const bidOrders = bids.slice(0, 10).map(([price, qty]) => ({ price: parseFloat(price), qty: parseFloat(qty), type: "bid", }));
//       const askOrders = asks.slice(0, 10).map(([price, qty]) => ({price: parseFloat(price),qty: parseFloat(qty),type: "ask",}));
//       callback([...bidOrders, ...askOrders]);
//     }
//     catch (err) { console.error("[Gate.io] Orderbook parse error:", err);}
//   });
//   ws.on("error", (err) => {console.error("[Gate.io] Orderbook WS error:", err);callback([]);});
//   ws.on("close", () => { console.warn("[Gate.io] Orderbook WS closed");});
// }

// function stopGateioOrderbooks() {
//   if (currentGateioOrderbookWS) {
//     currentGateioOrderbookWS.close();
//     currentGateioOrderbookWS = null;
//   }
// }


// const lastBook = {};
// function startGateioOrderbook(targetSymbols, callback) {
//       setTimeout(() => {
//   shouldReconnectGateio = true;
//   fetchValidPairs().then(validSymbols => {
//     if (!shouldReconnectGateio) {console.log("[Gate.io] Service stopped during symbol validation");return;}
//     const filteredSymbols = targetSymbols.filter(s => validSymbols.has(s));
//     if (filteredSymbols.length === 0) {console.warn("[Gate.io] No valid symbols to subscribe.");return;}
//     console.log(`[Gate.io] Starting ${Math.ceil(filteredSymbols.length / BATCH_SIZE)} batches for ${filteredSymbols.length} symbols`);
//     for (let i = 0; i < filteredSymbols.length; i += BATCH_SIZE) {
//       const batch = filteredSymbols.slice(i, i + BATCH_SIZE);
//       const batchId = `batch_${Math.floor(i / BATCH_SIZE)}`;
//       setTimeout(() => {
//         if (shouldReconnectGateio) { startBatchOrderbook(batch, callback, batchId);}
//       }, (i / BATCH_SIZE) * 1000);
//     }
//   }).catch(err => {console.error("[Gate.io] Error in startGateioWS:", err.message);});
// }, 2000)
// }
// function startBatchOrderbook(pairsBatch, callback, batchId = 'unknown') {
//   if (!shouldReconnectGateio) {console.log(`[Gate.io] Service stopped, aborting connection for ${batchId}`);return;}
//   const ws = new WebSocket("wss://api.gateio.ws/ws/v4/");
//   currentGateioWSConnections.push(ws);
//   ws.batchId = batchId; 
//   ws.pairsBatch = pairsBatch;
//   ws.callback = callback; 
//   currentGateioWSConnections.push(ws);
//   ws.lastUpdateTime = null;
//   ws.on('open', () => {
//     if (!shouldReconnectGateio) { ws.close(1000, 'Service stopped');return;}
//     const payloadPairs = pairsBatch.map(s => s.replace("USDT", "_USDT"));
//     const subMsg = {
//       time: 0,
//       channel: "spot.tickers",
//       event: "subscribe",
//       payload: payloadPairs,
//     };
//     ws.send(JSON.stringify(subMsg));
//     console.log(`[Gate.io] Subscribed to: ${payloadPairs.join(', ')}`);
//   });

//   ws.on('message', (message) => {
//     try {
//       const data = JSON.parse(message);
//       if (data.event !== 'update' || typeof data.result !== 'object') return;
//       const result = data.result;
//       const rawSymbol = result.currency_pair;
//       const bestBid = result.highest_bid;
//       const bestAsk = result.lowest_ask;
//       if (!rawSymbol || !bestBid || ! bestAsk) return;
//       const symbol = rawSymbol.replace("_", "");
//       const prevBid = lastBook[symbol]?.bid;
//       const prevAsk = lastBook[symbol]?.ask;
//       const isBidChanged = bestBid !== prevBid;
//       const isAskChanged = bestAsk !== prevAsk;
//       if (isBidChanged || isAskChanged) {
//         lastBook[symbol] = { bid: bestBid, ask: bestAsk };
//         callback([{ symbol, bid: bestBid, ask: bestAsk }]);
//       }
//     }
//     catch (err) {console.error("[Gate.io] Error parsing message:", err); }
//   });
//   ws.on('error', (err) => {
//     console.error(`[Gate.io] WS error in ${batchId}:`, err.message);
//     const wsIndex = currentGateioWSConnections.findIndex(connection => connection === ws);
//     if (wsIndex > -1) currentGateioWSConnections.splice(wsIndex, 1);
//   });

//   ws.on('close', (code, reason) => {
//     console.warn(`[Gate.io] Connection closed for ${batchId}: ${code} ${reason || 'No reason'}`);
//     gateioLatencyMap.delete(ws);
//     const wsIndex = currentGateioWSConnections.findIndex(connection => connection === ws);
//     if (wsIndex > -1) currentGateioWSConnections.splice(wsIndex, 1);
//     if (shouldReconnectGateio) {
//       console.log(`[Gate.io] Reconnecting ${batchId} in 5s...`);
//       const reconnectTimer = setTimeout(() => {
//         const timerIndex = gateioReconnectTimers.indexOf(reconnectTimer);
//         if (timerIndex > -1) gateioReconnectTimers.splice(timerIndex, 1);
//         if (shouldReconnectGateio) {
//           startBatchOrderbook(pairsBatch, callback, batchId);
//         }
//       }, 5000);
//       gateioReconnectTimers.push(reconnectTimer);
//     }
//     else {console.log(`[Gate.io] Manual stop for ${batchId}, not reconnecting`);}
//   });
// }

