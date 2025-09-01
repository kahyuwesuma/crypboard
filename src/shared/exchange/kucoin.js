const { DefaultLogger, WebsocketClient } = require('kucoin-api')
const axios = require('axios')

const logger = {
  ...DefaultLogger,
  trace:(...params) => {console.log('trace', ...params)}
}

let kucoinLastMessageTime = 0
let kucoinOrderbookWS = []
let kucoinWSClient = null;
const kucoinCallbacks = {
  lastPrice: [],
  orderbook: []
};

function startKucoinWS(type, targetSymbols, callback) {
  if (!kucoinWSClient) {
    const wsClient = new WebsocketClient({}, logger);
    kucoinWSClient = wsClient;

    const lastPrices = {};
    const lastOrderbook = {};
    const targetSets = {}; // per type, biar fleksibel

    wsClient.on('open', (data) => console.log("ws opened:", data.wsKey));
    wsClient.on('response', (data) => console.log("ws response:", data));
    wsClient.on('reconnect', (data) => console.log("ws reconnect:", data));
    wsClient.on('reconnected', (data) => console.log("ws reconnected:", data));
    wsClient.on('exception', (data) => console.warn("ws exception:", data));
    wsClient.on('close', (data) => console.log("ws closed:", data));
    wsClient.on('error', (data) => console.log("ws error:", data));

    wsClient.on('update', (data) => {
      kucoinLastMessageTime = Date.now()
      const rawSymbol = data.subject;
      const symbol = rawSymbol.replace("-", "");

      // cek untuk setiap type
      Object.keys(kucoinCallbacks).forEach((t) => {
        const set = targetSets[t] || new Set();
        if (!set.has(symbol)) return;

        const payload = data.data;
        const updates = [];

        if (t === "lastPrice") {
          const price = payload.price;
          if (lastPrices[symbol] !== price) {
            lastPrices[symbol] = price;
            updates.push({ symbol, price });
          }
        }

        if (t === "orderbook") {
          const bid = payload.bestBid;
          const ask = payload.bestAsk;
          const prev = lastOrderbook[symbol] || {};
          if (prev.bid !== bid || prev.ask !== ask) {
            lastOrderbook[symbol] = { bid, ask };
            updates.push({ symbol, bid, ask });
          }
        }

        if (updates.length > 0) {
          kucoinCallbacks[t].forEach(cb => cb(updates));
        }
      });
    });

    wsClient.subscribe('/market/ticker:all', 'spotPublicV1');

    startKucoinWS._setTargets = (t, symbols) => {
      targetSets[t] = new Set(symbols.map(s => s.toUpperCase()));
    };
  }

  if (typeof callback === "function") {
    kucoinCallbacks[type].push(callback);
  }
  
  startKucoinWS._setTargets(type, targetSymbols);
}

function stopKucoinWS() {
  if (!kucoinWSClient) return;

  try {
    kucoinWSClient.unsubscribe('/market/ticker:all', 'spotPublicV1');
    kucoinWSClient.removeAllListeners()
    kucoinWSClient.closeAll();
  } catch (e) {
    console.warn("unsubscribe not supported, closing connection");
    kucoinWSClient.removeAllListeners()
    kucoinWSClient.closeAll?.();
  }
  kucoinWSClient = null;
}

function getKucoinOrderbook(targetSymbol, callback){
  const symbol = targetSymbol + "-USDT"

  const wsClient = new WebsocketClient({}, logger)
  
  wsClient.on('open', (data) => {console.log('ws opened: ', data.wsKey)})
  wsClient.on('response', (data) => {console.log('ws response: ', data)})
  wsClient.on('reconnect', (data) => {console.log('ws reconnect: ', data)})
  wsClient.on('reconnected', (data) => {console.log('ws reconnected: ', data)})
  wsClient.on('exception', (data) => {console.warn('ws exception: ', data)})
  wsClient.on('error', (data) => {console.error('ws error: ', data)})
  wsClient.on('close', (data) => {console.log('ws closed: ', data)})

  const orderbook = {bids:[], asks:[]};

  (async() => {    
    try {
      const snap = await axios.get(`https://api.kucoin.com/api/v1/market/orderbook/level2_100?symbol=${symbol}`);
      orderbook.bids = snap.data.data.bids.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
      orderbook.asks = snap.data.data.asks.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
    } catch (err) {
      console.error("[KuCoin] Gagal ambil snapshot orderbook:", err);
      callback([]);
      return;
    }
  })();

  wsClient.on('update', (data) => {
    const payload = data.data?.changes || {}

    if (Array.isArray(payload.bids)) {
      payload.bids.forEach(([price, quantity])=> {
        const prc = parseFloat(price)
        const qty = parseFloat(quantity)
        const idx = orderbook.bids.findIndex(([bidPrice]) => bidPrice === prc)

        if (qty === 0) {
          if (idx >= 0) orderbook.bids.splice(idx,1)
        } else {
          if (idx >= 0) orderbook.bids[idx][1] = qty
          else orderbook.bids.push([prc, qty])
        }
      })
      orderbook.bids.sort((a,b)=> b[0]-a[0])
      orderbook.bids = orderbook.bids.slice(0,50)
    }

    if (Array.isArray(payload.asks)) {
      payload.asks.forEach(([price, quantity])=> {
        const prc = parseFloat(price)
        const qty = parseFloat(quantity)
        const idx = orderbook.asks.findIndex(([bidPrice]) => bidPrice === prc)

        if (qty === 0) {
          if (idx >= 0) orderbook.asks.splice(idx,1)
        } else {
          if (idx >= 0) orderbook.asks[idx][1] = qty
          else orderbook.asks.push([prc, qty])
        }
      })
      orderbook.asks.sort((a,b)=> a[0]-b[0])
      orderbook.asks = orderbook.asks.slice(0,50)
    }
    
    const bid = orderbook.bids.slice(0,10).map(([price, qty])=> ({
      price,
      qty,
      type: "bid"
    }))

    const ask = orderbook.asks.slice(0,10).map(([price, qty])=> ({
      price,
      qty,
      type: "ask"
    }))
    callback([...bid, ...ask])
  })

  wsClient.subscribe(`/market/level2:${symbol}`, 'spotPublicV1')

  kucoinOrderbookWS.push({symbol, wsClient})
}

function stopKucoinOrderbook(){
  kucoinOrderbookWS.forEach((data) => {
    const { symbol, wsClient } = data
    try{
      wsClient.unsubscribe(`/market/level2:${symbol}`, 'spotPublicV1')
      console.log('ws unsubscribe: ', symbol)
    } catch (e){
      console.log('error: ', e.message)
    }
  })

  kucoinOrderbookWS = []
}

function getKucoinConnection(){
  const now = Date.now()
  const diff = now - kucoinLastMessageTime

  if (diff < 5000) return 100;
  if (diff < 10000) return 75;
  if (diff < 20000) return 50;
  if (diff < 30000) return 25;
  return 0;
}

module.exports = {
  startKucoinWS,
  stopKucoinWS,
  getKucoinOrderbook,
  stopKucoinOrderbook,
  getKucoinConnection,
};
// const WebSocket = require('ws');
// // const axios = require('axios');
// const https = require('https');

// const lastPrices = {};
// const lastBook = {};
// let currentKucoinWSConnections = [];
// let shouldReconnectKucoin = true;
// const kucoinLatencyMap = new Map();
// // --- helper debounce per symbol ---
// const debounceMap = new Map();

// function debounceSymbol(symbol, fn, delay = 200) {
//   if (debounceMap.has(symbol)) {
//     clearTimeout(debounceMap.get(symbol));
//   }
//   const timeout = setTimeout(fn, delay);
//   debounceMap.set(symbol, timeout);
// }
// // --- Ambil info WS dari KuCoin ---
// async function getKucoinWSInfo() {
//   try {
//     const response = await axios.post(
//       "https://api.kucoin.com/api/v1/bullet-public",
//       null,
//       { httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
//     );
//     const data = response.data.data;
//     return {
//       token: data.token,
//       endpoint: data.instanceServers[0].endpoint,
//     };
//   } catch (err) {
//     console.error("[KuCoin] Failed to fetch WS info:", err);
//     return null;
//   }
// }

// // --- Start KuCoin WS (lastPrice atau orderbook) ---
// function startKucoinWSs(type, targetSymbols, callback) {
//   stopKucoinWS();
//   shouldReconnectKucoin = true;

//   getKucoinWSInfo().then(info => {
//     if (!info) return;
//     const { token, endpoint } = info;
//     const wsUrl = `${endpoint}?token=${token}`;
//     const targetSet = new Set(targetSymbols.map(s => s.toUpperCase()));

//     function startConnection() {
//       const ws = new WebSocket(wsUrl);
//       ws.lastUpdateTime = null;
//       kucoinLatencyMap.set(ws, 100);
//       currentKucoinWSConnections.push(ws);

//       let pingInterval = null;

//       ws.on('open', () => {
//         console.log(`[KuCoin ${type}] Connected, subscribing...`);

//         ws.send(JSON.stringify({
//           id: Date.now(),
//           type: "subscribe",
//           topic: "/market/ticker:all",
//           response: true,
//         }));

//         pingInterval = setInterval(() => {
//           if (ws.readyState === WebSocket.OPEN) {
//             ws.send(JSON.stringify({ id: Date.now(), type: "ping" }));
//           }
//         }, 20000);
//       });

//       ws.on('message', (msg) => {
//         try {
//           const payload = JSON.parse(msg);
//           // console.log(payload)
//           if (payload.type !== 'message' || !payload.data) return;

//           const rawSymbol = payload.subject || "";
//           const symbol = rawSymbol.replace("-", "").toUpperCase();
//           if (!targetSet.has(symbol)) return;

//           const now = Date.now();
//           if (ws.lastUpdateTime) {
//             const delta = now - ws.lastUpdateTime;
//             const alpha = 0.2;
//             const prev = kucoinLatencyMap.get(ws) || delta;
//             kucoinLatencyMap.set(ws, prev * (1 - alpha) + delta * alpha);
//           }
//           ws.lastUpdateTime = now;

//           if (type === "lastPrice") {
//             const price = parseFloat(payload.data.price || 0);
//             if (price && lastPrices[symbol] !== price) {
//               lastPrices[symbol] = price;
//     debounceSymbol(symbol, () => {
//       callback({ exchange: "kucoin", data: [{ symbol, price }] });
//     }, 200);
//             }
//           }

//           if (type === "orderbook") {
//             const bestBid = parseFloat(payload.data.bestBid);
//             const bestAsk = parseFloat(payload.data.bestAsk);
//             if (!lastBook[symbol]) lastBook[symbol] = { bid: null, ask: null };
//             const prev = lastBook[symbol];
//             if (prev.bid !== bestBid || prev.ask !== bestAsk) {
//               lastBook[symbol] = { bid: bestBid, ask: bestAsk };
//     debounceSymbol(symbol, () => {
//       callback([{ symbol, bid: bestBid, ask: bestAsk }]);
//     }, 200);
//             }
//           }

//         } catch (err) {
//           console.error(`[KuCoin ${type}] Error parsing message:`, err);
//         }
//       });

//       ws.on('error', err => {
//         console.error(`[KuCoin ${type}] WS error:`, err.message);
//         kucoinLatencyMap.delete(ws);
//       });

//       ws.on('close', (code, reason) => {
//         console.warn(`[KuCoin ${type}] Disconnected (${code}): ${reason}`);
//         kucoinLatencyMap.delete(ws);
//         clearInterval(pingInterval);
//         currentKucoinWSConnections = currentKucoinWSConnections.filter(c => c !== ws);
//         if (shouldReconnectKucoin) {
//           console.log(`[KuCoin ${type}] Reconnecting in 5s...`);
//           setTimeout(startConnection, 5000);
//         }
//       });
//     }

//     startConnection();
//   }).catch(err => {
//     console.error(`[KuCoin ${type}] Failed to get WS info:`, err);
//   });
// }

// // --- Stop semua WS KuCoin ---
// function stopKucoinWS() {
//   shouldReconnectKucoin = false;
//   currentKucoinWSConnections.forEach(ws => {
//     try {
//       ws.close();
//     } catch (_) {}
//   });
//   currentKucoinWSConnections = [];
//   kucoinLatencyMap.clear();
//   console.log("[KuCoin] All WS connections closed manually");
// }
// // const WebSocket = require('ws');
// // const axios = require('axios');
// // const https = require('https');

// // const lastPrices = {};
// // let currentKucoinWSConnections = [];
// // let shouldReconnectKucoin = true;

// // // Map simpan latency tiap WS batch
// // const kucoinLatencyMap = new Map();

// // // Ambil info WS dari KuCoin
// // async function getKucoinWSInfo() {
// //   try {
// //     const response = await axios.post(
// //       "https://api.kucoin.com/api/v1/bullet-public",
// //       null,
// //       { httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
// //     );
// //     const data = response.data.data;
// //     return {
// //       token: data.token,
// //       endpoint: data.instanceServers[0].endpoint,
// //     };
// //   } catch (err) {
// //     console.error("[KuCoin] Failed to fetch WS info:", err);
// //     return null;
// //   }
// // }

// // function startKucoinWS(targetSymbols, callback, batchSize = 50) {
// //   shouldReconnectKucoin = true;

// //   const batches = [];
// //   for (let i = 0; i < targetSymbols.length; i += batchSize) {
// //     batches.push(targetSymbols.slice(i, i + batchSize));
// //   }

// //   batches.forEach((batchSymbols, batchIndex) => {
// //     connectKucoinBatch(batchSymbols, batchIndex + 1, callback);
// //   });
// // }

// // // Koneksi batch
// // async function connectKucoinBatch(batchSymbols, batchNumber, callback) {
// //   const info = await getKucoinWSInfo();
// //   if (!info) return;

// //   const { token, endpoint } = info;
// //   const wsUrl = `${endpoint}?token=${token}`;

// //   function startConnection() {
// //     const ws = new WebSocket(wsUrl);
// //     ws.lastUpdateTime = null;
// //     kucoinLatencyMap.set(ws, 100); // default awal
// //     currentKucoinWSConnections.push(ws);

// //     let pingInterval = null;

// //     ws.on('open', () => {
// //       console.log(`[KuCoin Batch ${batchNumber}] Connected, subscribing...`);
// //       batchSymbols.forEach(symbol => {
// //         const base = symbol.slice(0, -4);
// //         const quote = symbol.slice(-4);
// //         const symbolWithDash = `${base}-${quote}`.toUpperCase();
// //         const subMsg = {
// //           id: Date.now(),
// //           type: "subscribe",
// //           topic: `/market/ticker:${symbolWithDash}`,
// //           privateChannel: false,
// //           response: true,
// //         };
// //         ws.send(JSON.stringify(subMsg));
// //       });

// //       pingInterval = setInterval(() => {
// //         if (ws.readyState === WebSocket.OPEN) {
// //           ws.send(JSON.stringify({ id: Date.now(), type: "ping" }));
// //         }
// //       }, 20000);
// //     });

// //     ws.on('message', (msg) => {
// //       try {
// //         const data = JSON.parse(msg);

// //         if (data.type === 'message' && data.data) {
// //           const topic = data.topic || "";
// //           const ticker = data.data;
// //           const price = parseFloat(ticker.price || 0);
// //           if (!topic.startsWith("/market/ticker:") || !price) return;

// //           const rawSymbol = topic.split(":")[1].toUpperCase();
// //           const symbol = rawSymbol.replace("-", "");

// //           // --- Hitung latency moving average antar update ---
// //           const now = Date.now();
// //           if (ws.lastUpdateTime) {
// //             const delta = now - ws.lastUpdateTime;
// //             const alpha = 0.2; // smoothing factor
// //             const prev = kucoinLatencyMap.get(ws) || delta;
// //             kucoinLatencyMap.set(ws, prev * (1 - alpha) + delta * alpha);
// //           }
// //           ws.lastUpdateTime = now;

// //           if (lastPrices[symbol] !== price) {
// //             lastPrices[symbol] = price;
// //             callback({
// //               exchange: "kucoin",
// //               data: [{ symbol, price }],
// //             });
// //           }

// //         }
// //       } catch (err) {
// //         console.error(`[KuCoin Batch ${batchNumber}] Error parsing message:`, err);
// //       }
// //     });

// //     ws.on('error', err => {
// //       console.error(`[KuCoin Batch ${batchNumber}] WS error:`, err.message);
// //       kucoinLatencyMap.delete(ws);
// //     });

// //     ws.on('close', (code, reason) => {
// //       console.warn(`[KuCoin Batch ${batchNumber}] Disconnected (${code}): ${reason}`);
// //       kucoinLatencyMap.delete(ws);
// //       clearInterval(pingInterval);
// //       currentKucoinWSConnections = currentKucoinWSConnections.filter(c => c !== ws);
// //       if (shouldReconnectKucoin) {
// //         console.log(`[KuCoin Batch ${batchNumber}] Reconnecting in 5s...`);
// //         setTimeout(startConnection, 5000);
// //       }
// //     });
// //   }

// //   startConnection();
// // }
// // Hitung persentase kekuatan koneksi
// function getKucoinConnectionStrength() {
//   if (currentKucoinWSConnections.length === 0) return 0;
//   const latencies = Array.from(kucoinLatencyMap.values());
//   if (latencies.length === 0) return 0;

//   const avgLatency = latencies.reduce((a,b)=>a+b,0)/latencies.length;
//   // misal 0ms = 100%, 2000ms+ = 0%
//   const percent = Math.max(0, Math.min(100, Math.round((2000 - avgLatency)/2000*100)));
//   return percent;
// }

// let currentKucoinOrderbookWS = null
// /**
//  * Ambil orderbook KuCoin (top 10 bids & asks)
//  * @param {string} symbol - contoh: "BTC"
//  * @param {function} callback - menerima array {price, qty, type}
//  */
// function getKucoinOrderbookss(symbol, callback) {
//   shouldReconnectKucoin = true;

//   if (currentKucoinOrderbookWS) {
//     currentKucoinOrderbookWS.close();
//     currentKucoinOrderbookWS = null;
//   }

//   getKucoinWSInfo().then(async (info) => {
//     if (!info) return;

//     const { token, endpoint } = info;
//     const wsUrl = `${endpoint}?token=${token}`;
//     const symbolWithDash = `${symbol}-USDT`.toUpperCase();

//     // Step 1: Ambil snapshot awal
//     let orderbook = { bids: [], asks: [] };
//     try {
//       const snap = await axios.get(`https://api.kucoin.com/api/v1/market/orderbook/level2_100?symbol=${symbolWithDash}`);
//       orderbook.bids = snap.data.data.bids.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
//       orderbook.asks = snap.data.data.asks.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
//     } catch (err) {
//       console.error("[KuCoin] Gagal ambil snapshot orderbook:", err);
//       callback([]);
//       return;
//     }

//     // Step 2: Koneksi WS
//     const ws = new WebSocket(wsUrl);
//     currentKucoinOrderbookWS = ws;

//     ws.on("open", () => {
//       const subMsg = {
//         id: Date.now(),
//         type: "subscribe",
//         topic: `/market/level2:${symbolWithDash}`,
//         privateChannel: false,
//         response: true,
//       };
//       ws.send(JSON.stringify(subMsg));
//       console.log(`[KuCoin] Subscribed orderbook for ${symbolWithDash}`);
//     });

//     ws.on("message", (msg) => {
//       try {
//         const data = JSON.parse(msg);

//         if (data.type === "message" && data.topic.startsWith("/market/level2:")) {
//           if (data.subject === "trade.l2update") {
//             const { changes } = data.data || {};
//             if (!changes) return;

//             // Step 3: Update bids
//             if (Array.isArray(changes.bids)) {
//               changes.bids.forEach(([price, qty]) => {
//                 const p = parseFloat(price);
//                 const q = parseFloat(qty);
//                 const idx = orderbook.bids.findIndex(([bp]) => bp === p);
//                 if (q === 0) {
//                   if (idx >= 0) orderbook.bids.splice(idx, 1);
//                 } else {
//                   if (idx >= 0) orderbook.bids[idx][1] = q;
//                   else orderbook.bids.push([p, q]);
//                 }
//               });
//               orderbook.bids.sort((a, b) => b[0] - a[0]);
//             }

//             // Step 4: Update asks
//             if (Array.isArray(changes.asks)) {
//               changes.asks.forEach(([price, qty]) => {
//                 const p = parseFloat(price);
//                 const q = parseFloat(qty);
//                 const idx = orderbook.asks.findIndex(([ap]) => ap === p);
//                 if (q === 0) {
//                   if (idx >= 0) orderbook.asks.splice(idx, 1);
//                 } else {
//                   if (idx >= 0) orderbook.asks[idx][1] = q;
//                   else orderbook.asks.push([p, q]);
//                 }
//               });
//               orderbook.asks.sort((a, b) => a[0] - b[0]);
//             }

//             // Step 5: Kirim top 10
//             const bidOrders = orderbook.bids.slice(0, 10).map(([price, qty]) => ({
//               price,
//               qty,
//               type: "bid",
//             }));
//             const askOrders = orderbook.asks.slice(0, 10).map(([price, qty]) => ({
//               price,
//               qty,
//               type: "ask",
//             }));

//             callback([...bidOrders, ...askOrders]);
//           }
//         } else if (data.type === "ping") {
//           ws.send(JSON.stringify({ type: "pong" }));
//         }
//       } catch (err) {
//         console.error("[KuCoin] Orderbook parse error:", err);
//       }
//     });

//     ws.on("error", (err) => {
//       console.error("[KuCoin] Orderbook WS error:", err);
//       callback([]);
//     });

//     ws.on("close", () => {
//       console.warn("[KuCoin] Orderbook WS closed");
//     });
//   });
// }

// // function closeKucoinWS() {
// //   shouldReconnectKucoin = false;
// //   if (currentKucoinWS) {
// //     currentKucoinWS.close();
// //     currentKucoinWS = null;
// //     console.log("[KuCoin] Ticker WS closed manually");
// //   }
// // }

// /**
//  * Menutup koneksi orderbook KuCoin
//  */
// function closeKucoinOrderbookWS() {
//   if (currentKucoinOrderbookWS) {
//     currentKucoinOrderbookWS.close();
//     currentKucoinOrderbookWS = null;
//   }
// }

// // // Multiple L2 Orderbook Data
// // const lastBook = {}
// // function multipleKucoinOrderbook(targetSymbols, callback) {
// //   getKucoinWSInfo().then(info => {
// //     if (!info) return;

// //     const { token, endpoint } = info;
// //     const wsUrl = `${endpoint}?token=${token}`;
// //     const targetSet = new Set(targetSymbols.map(s => s.toUpperCase()));

// //     function startConnection() {
// //       const ws = new WebSocket(wsUrl);
// //       currentKucoinWSConnections.push(ws);

// //       let pingInterval = null;

// //       ws.on('open', () => {
// //         console.log(`[KuCoin Connected, subscribing to ALL symbols...`);

// //         ws.send(JSON.stringify({
// //           id: Date.now(),
// //           type: "subscribe",
// //           topic: "/market/ticker:all",
// //           response: true,
// //         }));

// //         pingInterval = setInterval(() => {
// //           if (ws.readyState === WebSocket.OPEN) {
// //             ws.send(JSON.stringify({ id: Date.now(), type: "ping" }));
// //           }
// //         }, 20000);
// //       });

// //       ws.on('message', (msg) => {
// //         try {
// //           const payload = JSON.parse(msg);
// //           if (payload.type !== 'message' || !payload.data) return;

// //           const symbol = payload.subject.replace("-", "").toUpperCase(); // LQTY-USDT -> LQTYUSDT
// //           if (!targetSet.has(symbol)) return;

// //           const bestBid = parseFloat(payload.data.bestBid);
// //           const bestAsk = parseFloat(payload.data.bestAsk);

// //           if (!lastBook[symbol]) lastBook[symbol] = { bid: null, ask: null };
// //           const prev = lastBook[symbol];

// //           if (prev.bid !== bestBid || prev.ask !== bestAsk) {
// //             lastBook[symbol] = { bid: bestBid, ask: bestAsk };
// //             callback([{ symbol, bid: bestBid, ask: bestAsk }]);
// //           }
// //         } catch (err) {
// //           console.error(`[KuCoin WS] Error parsing message:`, err);
// //         }
// //       });


// //       ws.on('error', err => {
// //         console.error(`[KuCoin Batch] WS error:`, err.message);
// //         kucoinLatencyMap.delete(ws);
// //       });

// //       ws.on('close', (code, reason) => {
// //         console.warn(`[KuCoin Batch ] Disconnected (${code}): ${reason}`);
// //         kucoinLatencyMap.delete(ws);
// //         clearInterval(pingInterval);
// //         currentKucoinWSConnections = currentKucoinWSConnections.filter(c => c !== ws);
// //         if (shouldReconnectKucoin) {
// //           console.log(`[KuCoin Batch] Reconnecting in 5s...`);
// //           setTimeout(startConnection, 5000);
// //         }
// //       });
// //     }

// //     startConnection();

// //   }).catch(err => {
// //     console.error(`[KuCoin Batch Failed to get WS info:`, err);
// //   });
// // }