const { DefaultLogger, WebsocketClient } = require('binance');

let binanceLastMessageTime = 0
let binanceWSClient = null
const binanceCallbacks = {
  lastPrice: [],
  orderbook: []
}

const logger = {
  ...DefaultLogger,
  trace: (...params) => console.log('trace', ...params)
}

function startBinanceWS(type, targetSymbols, callback) {
  if (!binanceWSClient){
    const wsClient = new WebsocketClient({beautify: true},logger)

    binanceWSClient = wsClient
    wsClient.on('open', (data) => {console.log('connection opened:', data.wsKey)})
    wsClient.on('response', (data) => {console.log('ws response received: ', JSON.stringify(data, null, 2))})
    wsClient.on('reconnecting', (data) => {console.log('reconnecting ws: ', data?.wsKey)})
    wsClient.on('reconnected', (data) => {console.log('ws reconnected: ', data?.wsKey)})
    wsClient.on('exception', (data) => {console.error('ws exception: ', data)})

    const targetSets = {}
    const lastPrices = {};
    const lastOrderbook = {};

    wsClient.on('formattedMessage', (data) => {
      binanceLastMessageTime = Date.now()

      Object.keys(binanceCallbacks).forEach((t) => {
        const set = targetSets[t] || new Set()
        const updates = []
        if (t === "lastPrice") {
          for (const item of data) {
            const symbol = item.symbol
            if (!set.has(symbol)) continue
  
            const price = parseFloat(item.currentClose || item.price || 0);
            if (isNaN(price)) continue;
  
            const prev = lastPrices[symbol]
            if (prev !== price) {
              lastPrices[symbol] = price;
              updates.push({ symbol, price })
            }
          }
        }

        if (t === 'orderbook') {
          
          for (const item of data) {
  
            const symbol = item.symbol
            if (!set.has(symbol)) continue
  
            const bid = parseFloat(item.bestBid);
            const ask = parseFloat(item.bestAskPrice);

            const prev = lastOrderbook[symbol] || {}
            if (prev.bid !== bid || prev.ask !== ask) {
              lastOrderbook[symbol] = {bid, ask}
              updates.push({symbol, bid, ask})
            }
          }
        }
        if (updates.length > 0) {
          binanceCallbacks[t].forEach(cb=>cb(updates))
        }
      })
      
    });
    wsClient.subscribeAll24hrTickers('spot')
    
    startBinanceWS._setTargets = (t, symbols) => {
      targetSets[t] = new Set(symbols)
    }
  }

  if (typeof callback === "function") {
    binanceCallbacks[type].push(callback)
  }
  startBinanceWS._setTargets(type, targetSymbols)
}

function stopBinanceWS() {
  if (!binanceWSClient) return;
  try {
    binanceWSClient.unsubscribeAll24hrTickers('spot')
    binanceWSClient.removeAllListeners()
    binanceWSClient.closeAll()
  } catch (e) {
    console.warn("unsubscribe not supported, closing connection");
    binanceWSClient.removeAllListeners()
    binanceWSClient.closeAll?.();
  }
  binanceWSClient = null;
}

let activeBinanceOrderbookWS = []
function getBinanceOrderbook(targetSymbol, callback){
  const symbol = targetSymbol + "USDT"
  const wsClient = new WebsocketClient({beautify: true}, logger)

  wsClient.on('open', (data) => {console.log('ws opened: ', data.wsKey)})
  wsClient.on('response', (data) => {console.log('ws response: ', data)})
  wsClient.on('reconnecting', (data) => {console.log('ws reconnect: ', data)})
  wsClient.on('reconnected', (data) => {console.log('ws reconnected: ', data)})
  wsClient.on('exception', (data) => {console.warn('ws exception: ', data)})
  wsClient.on('close', (data) => {console.log('ws closed: ', data)})

  const orderbook = {bids: [], asks: []}
  wsClient.on('formattedMessage', (data) => {

    data.bids.forEach(([price, quantity]) => {
      const prc = parseFloat(price)
      const qty = parseFloat(quantity)

      const idx = orderbook.bids.findIndex(([bidPrice]) => bidPrice === prc)

      if (qty === 0){
        if (idx>=0) orderbook.bids.splice(idx,1)
      } else {
        if (idx >= 0) orderbook.bids[idx][1] = qty
        else orderbook.bids.push([prc, qty])
      }
    })

    orderbook.bids.sort((a,b)=> b[0] - a[0])
    orderbook.bids = orderbook.bids.slice(0,10)

    data.asks.forEach(([price, quantity]) => {
      const prc = parseFloat(price)
      const qty = parseFloat(quantity)

      const idx = orderbook.asks.findIndex(([bidPrice]) => bidPrice === prc)

      if (qty === 0){
        if (idx>=0) orderbook.asks.splice(idx,1)
      } else {
        if (idx >= 0) orderbook.asks[idx][1] = qty
        else orderbook.asks.push([prc, qty])
      }
    })

    orderbook.asks.sort((a,b)=> a[0] - b[0])
    orderbook.asks = orderbook.asks.slice(0,50)

    const bid = orderbook.bids.slice(0,10).map(([price, qty]) => ({
      price,
      qty,
      type: "bid"
    }))

    const ask = orderbook.asks.slice(0,10).map(([price, qty]) => ({
      price,
      qty,
      type: "ask"
    }))

    callback([...bid, ...ask])
  })

   wsClient.subscribe(`${symbol.toLowerCase()}@depth10`, 'main')

   activeBinanceOrderbookWS.push({symbol, wsClient})
}

function stopBinanceOrderbook(){
  activeBinanceOrderbookWS.forEach((data) => {
    const { symbol, wsClient } = data

    try{
      wsClient.unsubscribe(`${symbol.toLowerCase()}@depth10`, 'main')
    } catch (e){
      console.log('orderbook close error: ', e.message)
    }
  })

  activeBinanceOrderbookWS = []
}

let activeBTCStream = null
function startBTCWS(callback){
  const wsClient = new WebsocketClient({beautify: true}, logger)
  activeBTCStream = wsClient
  wsClient.on('open', (data) => {console.log('connection opened:', data.wsKey)})
  wsClient.on('response', (data) => {console.log('ws response received: ', JSON.stringify(data, null, 2))})
  wsClient.on('reconnecting', (data) => {console.log('reconnecting ws: ', data?.wsKey)})
  wsClient.on('reconnected', (data) => {console.log('ws reconnected: ', data?.wsKey)})
  wsClient.on('exception', (data) => {console.error('ws exception: ', data)})

  let btcPrice = 0

  wsClient.on('formattedMessage', (data) => {
    const price = data.currentClose

    if (price !== btcPrice){
      btcPrice = price
      callback(price)
    }
  })
  wsClient.subscribe("btcusdt@ticker", 'main')
}

function stopBTCWS(){
  if (!activeBTCStream) return;

  try {
    activeBTCStream.unsubscribe("btcusdt@ticker", 'main')
    activeBTCStream.removeAllListeners()
    activeBTCStream.closeAll()
  } catch (e) {
    console.warn("unsubscribe not supported, closing connection");
    activeBTCStream.closeAll?.();
  }
  activeBTCStream = null;
}

function getBinanceConnection(){
  const now = Date.now()
  const diff = now - binanceLastMessageTime

  if (diff < 5000) return 100;
  if (diff < 10000) return 75;
  if (diff < 20000) return 50;
  if (diff < 30000) return 25;
  return 0;
}

module.exports = { 
  startBinanceWS,
  stopBinanceWS,
  getBinanceOrderbook,
  stopBinanceOrderbook,
  startBTCWS,
  stopBTCWS,
  getBinanceConnection
};

// const WebSocket = require('ws');

// let binanceSockets = {};
// let shouldReconnect = {};
// let reconnectTimers = {};
// let checkIntervals = {};
// // let binanceLastMessageTime = {};
// let binanceConnectionStrength = {};

// function makeKey(type, symbols = []) {
//   return `${type}:${[...symbols].sort().join(",")}`;
// }

// function stopBinanceWssS(type, symbols = []) {
//   const key = makeKey(type, symbols);
//   return new Promise((resolve) => {
//     shouldReconnect[key] = false;

//     if (reconnectTimers[key]) {
//       clearTimeout(reconnectTimers[key]);
//       delete reconnectTimers[key];
//     }

//     if (checkIntervals[key]) {
//       clearInterval(checkIntervals[key]);
//       delete checkIntervals[key];
//     }

//     if (binanceSockets[key]) {
//       try {
//         binanceSockets[key].once("close", () => {
//           console.log(`[Binance WS][${key}] Closed`);
//           delete binanceSockets[key];
//           resolve();
//         });
//         binanceSockets[key].close();
//       } catch {
//         delete binanceSockets[key];
//         resolve();
//       }
//     } else {
//       resolve();
//     }
//   });
// }

// async function startBinanceWSs(type, symbols, callback) {
//   const key = makeKey(type, symbols);
//   await stopBinanceWS(type, symbols);
//   shouldReconnect[key] = true;

//   let url = "";
//   if (type === "lastPrice") {
//     url = "wss://stream.binance.com:9443/stream?streams=!ticker@arr";
//   } else if (type === "orderbook") {
//     const streams = symbols.map(s => `${s.toLowerCase()}@bookTicker`);
//     url = `wss://stream.binance.com:9443/stream?streams=${streams.join("/")}`;
//   } else {
//     throw new Error(`Unknown WS type: ${type}`);
//   }

//   console.log(`[Binance WS] Connecting: ${url}`);
//   const ws = new WebSocket(url);
//   binanceSockets[key] = ws;

//   const lastPrices = {};
//   const lastBooks = {};
//   ws.on("ping", (data) => {
//     try {
//       ws.pong(data);
//       console.log(`[Binance WS] -> pong`);
//     } catch (err) {
//       console.error(`[Binance WS][${key}] Pong error:`, err.message);
//     }
//   });

//   ws.on("message", (raw) => {
//     try {
//       const msg = JSON.parse(raw);

//       binanceLastMessageTime[key] = Date.now();
//       binanceConnectionStrength[key] = 100;

//       if (type === "lastPrice") {
//         const data = msg.data || [];
//         const updates = [];
//         for (const ticker of data) {
//           const symbol = ticker.s;
//           const price = ticker.c;
//           if (symbols.includes(symbol)) {
//             if (lastPrices[symbol] !== price) {
//               lastPrices[symbol] = price;
//               updates.push({ type: "lastPrice", symbol, price: parseFloat(price) });
//             }
//           }
//         }
//         if (updates.length) callback(updates);
//       }

//       if (type === "orderbook") {
//         const { data } = msg;
//         if (!data) return;

//         const symbol = data.s;
//         if (symbols.includes(symbol)) {
//           const bestBid = parseFloat(data.b);
//           const bestAsk = parseFloat(data.a);

//           const last = lastBooks[symbol] || {};
//           if (last.bid !== bestBid || last.ask !== bestAsk) {
//             lastBooks[symbol] = { bid: bestBid, ask: bestAsk };
//             callback([{ symbol, bid: bestBid, ask: bestAsk }]);
//           }
//         }
//       }

//     } catch (err) {
//       console.error(`[Binance WS][${key}] Parse Error`, err.message);
//     }
//   });

//   ws.on("error", (err) => {
//     console.error(`[Binance WS][${key}] Error:`, err.message);
//   });

//   ws.on("close", async () => {
//     if (shouldReconnect[key]) {
//       console.warn(`[Binance WS][${key}] Reconnecting in 5s...`);
//       reconnectTimers[key] = setTimeout(async () => {
//         stopBinanceWS(type, symbols); // pastikan bersih dulu
//         startBinanceWS(type, symbols, callback);
//       }, 5000);
//     }
//   });

//   // health check per socket
//   checkIntervals[key] = setInterval(() => {
//     const diff = Date.now() - (binanceLastMessageTime[key] || 0);
//     if (diff > 10000) {
//       binanceConnectionStrength[key] = 0;
//     } else {
//       const lostPercent = Math.min(100, (diff / 10000) * 100);
//       binanceConnectionStrength[key] = Math.max(0, 100 - lostPercent);
//     }
//   }, 1000);
// }

// // async function stopBinanceLastWS() {
// //   return new Promise((resolve) => {
// //     if (currentBinanceLastWS) {
// //       shouldReconnectBinanceLast = false;
// //       currentBinanceLastWS.once("close", () => {
// //         console.log("[Binance Last WS] Closed");
// //         currentBinanceLastWS = null;
// //         resolve();
// //       });
// //       try { currentBinanceLastWS.close(); } catch { resolve(); }
// //     } else resolve();
// //   });
// // }
// // async function startBinanceLastPrices(symbols, callback) {
// //   await stopBinanceLastWS();
// //   shouldReconnectBinanceLast = true;

// //   console.log("[Binance WS] Waiting 5s before connecting to last price stream...");

// //     const ws = new WebSocket("wss://stream.binance.com:9443/stream?streams=!ticker@arr");
// //     currentBinanceLastWS = ws;
// //     const lastPrices = {};

// //     ws.on("message", (raw) => {
// //       binanceLastMessageTime = Date.now();
// //       binanceConnectionStrength = 100;
// //       const msg = JSON.parse(raw);
// //       const data = msg.data || [];
// //       const updates = [];
// //       for (const ticker of data) {
// //         const symbol = ticker.s;
// //         const price = ticker.c;
// //         if (symbols.includes(symbol)) {
// //           if (lastPrices[symbol] !== price) {
// //             lastPrices[symbol] = price;
// //             updates.push({ symbol, price });
// //           }
// //         }
// //       }
// //       if (updates.length) {
// //         callback(updates);
// //       }
// //     });

// //     ws.on("error", (err) => {
// //       console.error("[Binance WS] Error:", err.message);
// //     });

// //     ws.on("close", () => {
// //       if (shouldReconnectBinanceLast) {
// //         console.warn("[Binance WS] Reconnecting in 5s...");
// //         setTimeout(() => startBinanceLastPrice(symbols, callback), 5000);
// //       }
// //     });

// //     if (binanceCheckInterval) clearInterval(binanceCheckInterval);
// //     binanceCheckInterval = setInterval(() => {
// //       const diff = Date.now() - binanceLastMessageTime;
// //       if (diff > 10000) {
// //         binanceConnectionStrength = 0;
// //       } else {
// //         const lostPercent = Math.min(100, (diff / 10000) * 100);
// //         binanceConnectionStrength = Math.max(0, 100 - lostPercent);
// //       }
// //     }, 1000);
// // }

// // function getBinanceConnection() {return binanceConnectionStrength;}
// // function stopBinanceWS() {
// //   return new Promise((resolve) => {
// //     if (currentBinanceWS) {
// //       shouldReconnectBinance = false;

// //       currentBinanceWS.on("close", () => {
// //         console.log("[Binance WS] Closed.");
// //         currentBinanceWS = null;
// //         resolve();
// //       });

// //       try {
// //         currentBinanceWS.close();
// //       } catch (err) {
// //         console.error("[Binance WS] Error closing:", err.message);
// //         currentBinanceWS = null;
// //         resolve();
// //       }
// //     } else {
// //       resolve();
// //     }
// //   });
// // }

// // BTCUSDT untuk header
// let shouldReconnectBTC = true;
// let currentBTCWS = null;
// function startBTCUSDTWS(callback) {
//   shouldReconnectBTC = true;
//   const ws = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@ticker");
//   currentBTCWS = ws
//   let lastBtcPrice = 0;
//   ws.on("message", (raw) => {
//     const ticker = JSON.parse(raw);
//     const price = parseFloat(ticker.c);
//     if (lastBtcPrice !== price) {lastBtcPrice = price;callback({ type: "header", symbol: "BTCUSDT", price: lastBtcPrice });}
//   });
//   ws.on("error", (err) => {console.error("[BTCUSDT WS] Error:", err.message);});
//   ws.on("close", () => {
//     if (shouldReconnectBTC) {
//       console.warn("[BTCUSDT WS] Reconnecting in 5s...");
//       setTimeout(() => startBTCUSDTWS(callback), 5000);
//     }
//   });
// }

// function stopBTCUSDTWS() {
//   shouldReconnectBTC = false;
//   if (currentBTCWS) {
//     try {
//       currentBTCWS.close()
//       console.log("[Binance WS] Connection closed manually")
//     } catch (e) {console.error("[Binance WS] Error closing connection:", e)}
//     currentBTCWS = null
//   }
// }

// // Untuk single pair orderbook
// let currentBinanceOrderbookWS = null;
// function getBinanceOrderbooksss(symbol, callback) {
//   if (currentBinanceOrderbookWS) {currentBinanceOrderbookWS.close();currentBinanceOrderbookWS = null;}
//   const lowerSymbol = (symbol + "USDT").toLowerCase()
//   const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${lowerSymbol}@depth10`)
//   currentBinanceOrderbookWS = ws
//   ws.on('message', (raw) => {
//     const data = JSON.parse(raw);
//     const bids = (data.bids || []).map(([price, qty]) => ({price: parseFloat(price),qty: parseFloat(qty),type: 'bid'}))
//     const asks = (data.asks || []).map(([price, qty]) => ({price: parseFloat(price),qty: parseFloat(qty),type: 'ask'}))
//     const orders = [...bids, ...asks]
//     callback(orders)
//   });
//   ws.on('error', (err) => {
//     console.error('[Binance Orderbook WS Error]', err);
//     callback([]);
//   });
// }
// function stopBinanceOrderbooksss() {
//   if (currentBinanceOrderbookWS) {
//     currentBinanceOrderbookWS.close();
//     currentBinanceOrderbookWS = null;
//   }
// }


// // // Untuk stream orderbook
// // let binanceOrderbookSockets = {};
// // let shouldReconnectBinanceOrderbook = true;
// // async function stopBinanceOrderbookWS() {
// //   shouldReconnectBinanceOrderbook = false;
// //   for (const sym in binanceOrderbookSockets) {
// //     try { binanceOrderbookSockets[sym].close(); } catch {}
// //   }
// //   binanceOrderbookSockets = {};
// // }

// // let latestBooks = {};
// // async function startBinanceOrderbook(targetSymbols, callback) {
// //   await stopBinanceOrderbookWS()
// //   shouldReconnectBinanceOrderbook = true;

// //   for (const sym in binanceOrderbookSockets) {
// //     try { binanceOrderbookSockets[sym].close(); } catch (e) {}
// //   }
// //   binanceOrderbookSockets = {};
// //   let lastBooks = {}; 

// //   console.log("[Binance WS] Waiting 5s before starting connections...");

// //     targetSymbols.forEach((symbol) => {
// //       const lower = symbol.toLowerCase();
// //       const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${lower}@depth5@100ms`);
// //       binanceOrderbookSockets[symbol] = ws;

// //       ws.on("open", () => {
// //         console.log(`[Binance WS] Connected for ${symbol}`);
// //       });

// //       ws.on("message", (raw) => {
// //         try {
// //           const data = JSON.parse(raw);
// //           if (data.bids && data.asks && data.bids.length > 0 && data.asks.length > 0) {
// //             const bestBid = parseFloat(data.bids[0][0]);
// //             const bestAsk = parseFloat(data.asks[0][0]);
// //             const last = lastBooks[symbol] || {};
// //             if (last.bid !== bestBid || last.ask !== bestAsk) {
// //               lastBooks[symbol] = { bid: bestBid, ask: bestAsk };
// //               latestBooks[symbol] = { symbol, bid: bestBid, ask: bestAsk };
// //               callback([{ symbol, bid: bestBid, ask: bestAsk }]);
// //             }
// //           }
// //         } catch (err) {
// //           console.error(`[Binance WS Parse Error][${symbol}]`, err.message);
// //         }
// //       });

// //       ws.on("error", (err) => {
// //         console.error(`[Binance WS Error][${symbol}]`, err.message);
// //       });

// //       ws.on("close", () => {
// //         if (shouldReconnectBinanceOrderbook) {
// //           console.warn(`[Binance WS] Reconnecting in 5s... for ${symbol}`);
// //           setTimeout(() => startBinanceOrderbook(targetSymbols, callback), 5000);
// //         }
// //       });
// //     });
// // }