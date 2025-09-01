const https = require('https');
async function fetchValidSymbols() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.huobi.pro',
      path: '/v1/common/symbols',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.status === 'ok' && response.data) {
            const symbols = response.data
              .filter(item => item.state === 'online')
              .map(item => item.symbol.toLowerCase())
            console.log(`Fetched ${symbols.length} valid symbols from Huobi`);
            resolve(new Set(symbols))
          } else {
            reject(new Error('Invalid response from Huobi API'));
          }
        } catch (error) {
          reject(new Error('Failed to parse Huobi API response: ' + error.message));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(new Error('Failed to fetch symbols from Huobi: ' + error.message));
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Timeout fetching symbols from Huobi'));
    });
    
    req.end();
  });
}


const huobi = require('node-api-huobi');
const { chunkArray } = require('../utils/helper')

const reconnectState = {}; 
let isStoppingHuobi = false;

let huobiLastMessageTime = 0
const wsClient = {}
const handlers = {
  lastPrice: [],
  orderbook: []
};

function createConnection(symbolsBatch, batchId) {
  if (!wsClient[batchId]) {
    const client = huobi.sockets.marketApi();
    wsClient[batchId] = client

    client.socket._ws.on('open', () => {
      console.log(`Huobi WS Connected (Batch ${batchId}): ${symbolsBatch}`);
      reconnectState[batchId] = false

      symbolsBatch.forEach((symbol, index) => {
        setTimeout(() => {
          try {
            client.subscribeTicker(symbol);
          } catch (error) {
            console.error(`Error subscribing to ${symbol}:`, error.message);
          }
        }, index * 100);
      });
    });

    client.socket._ws.on('error', (error) => {
      console.error(`ws error:`, error.message);
    });
    client.socket._ws.on('closed', () => {
      console.log(`🔌 Connection closed (Batch ${batchId})`);
      delete wsClient[batchId];

      if (!isStoppingHuobi) {   // ✅ hanya reconnect kalau bukan manual stop
        handleReconnect(symbolsBatch, batchId);
      }
    });


    client.socket._ws.on('error', (error) => {
      console.error(`Huobi Websocket Error in ${batchId}: `, error.message)
      client.socket._ws.close()
    })

    const lastPrices = {}
    const lastOrderbook = {}
    client.setHandler('market.ticker', (method, tick, symbol) => {
      huobiLastMessageTime = Date.now()
      if (!method || !tick || !symbol) {
        console.log('Invalid handler data:', { method, tick, symbol, batchId });
        return;
      }
      
      try {
        const sym = symbol.toUpperCase()
        const updatesLast = []
        const updatesOB = []

        // --- lastPrice ---
        const price = tick.lastPrice || tick.close;
        if (lastPrices[sym] !== price){
          lastPrices[sym] = price
          updatesLast.push({symbol: sym, price})
        }

        // --- orderbook ---
        const bid = parseFloat(tick.bid)
        const ask = parseFloat(tick.ask)

        const prev = lastOrderbook[sym] || {}
        if(prev.bid !== bid || prev.ask !== ask){
          lastOrderbook[sym] = {bid, ask}
          updatesOB.push({symbol: sym, bid, ask})
        }

        // kirim ke handler yang terdaftar
        if (updatesLast.length > 0) {
          handlers.lastPrice.forEach(cb => cb(updatesLast))
        }
        if (updatesOB.length > 0) {
          handlers.orderbook.forEach(cb => cb(updatesOB))
        }
      } catch (error) {
        console.error(`❌ Handler error for ${symbol}:`, error.message);
      }
    });
  } else {
    symbolsBatch.forEach((symbol, index) => {
      setTimeout(() => {
        try {
          if (wsClient[batchId] && wsClient[batchId].socket && wsClient[batchId].socket._ws && wsClient[batchId].socket._ws.readyState === 1) {
            wsClient[batchId].subscribeTicker(symbol);
          } else {
            console.warn(`⚠️ Skip subscribe ${symbol}, WS (Batch ${batchId}) not ready`);
          }
        } catch (error) {
          console.error(`Error subscribing to ${symbol}:`, error.message);
        }
      }, index * 100);
    });
  }
}

function handleReconnect(symbolsBatch, batchId) {
  if (reconnectState[batchId]) return;
  
  reconnectState[batchId] = true;
  console.log(`🔄 Reconnecting Batch ${batchId} in 2 seconds...`);
  
  setTimeout(() => {
    createConnection(symbolsBatch, batchId);
  }, 2000);
}

async function startHuobiWS(type, targetSymbols, callback) {
  isStoppingHuobi = false; 

  const validSymbols = await fetchValidSymbols()

  const lowerSymbols = targetSymbols
    .map(sym => sym.toLowerCase())
    .filter(sym => validSymbols.has(sym))

  const batch = chunkArray(lowerSymbols, 25);

  if (typeof callback === 'function' && handlers[type]) {
    handlers[type].push(callback)
  }

  batch.forEach((symbols, idx) => {
    setTimeout(() => {
      createConnection(symbols, idx);
    }, idx * 2000);
  });
}

function stopHuobiWS() {
  try {
    isStoppingHuobi = true; // ⬅️ tambahin ini

    if (wsClient && typeof wsClient === 'object') {
      Object.keys(wsClient).forEach(batchId => {
        const client = wsClient[batchId];
        if (client && client.socket && client.socket._ws) {
          try {
            client.socket._ws.close();
            console.log(`✅ Closed WS for Batch ${batchId}`);
          } catch (e) {
            console.error(`❌ Error closing WS for Batch ${batchId}:`, e.message);
          }
        }
      });
    }

    // clear semua state
    Object.keys(handlers).forEach(key => (handlers[key] = []));
    Object.keys(reconnectState).forEach(key => (reconnectState[key] = false));
    Object.keys(wsClient).forEach(key => delete wsClient[key]);

    console.log("Huobi WS stopped and all handlers cleared.");
  } catch (err) {
    console.error("Error stopping Huobi WS:", err.message);
  }
}



let activeHuobiOrderbookWS = []

function getHuobiOrderbook(targetSymbols, callback){
  try {
    const symbol = targetSymbols.toLowerCase() + "usdt"

    const wsClientt = huobi.sockets.marketApi()

    wsClientt.socket._ws.on('open', () => {
      console.log('✅ ws opened')
      wsClientt.subscribeMarketDepth(symbol, 'step1')  // pakai step
      wsClientt.unsubscribeMarketDepth
    })

    wsClientt.socket._ws.on('error', (error) => {
      console.log('❌ ws error: ', error.message)
    })

    const orderbook = { bids: [], asks: [] }

    wsClientt.setHandler('market.depth', (method, data) => {
      console.log(data)
      if (!data) return
      const payload = data

      // --- update bids ---
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
        orderbook.bids.sort((a, b) => b[0] - a[0])
        orderbook.bids = orderbook.bids.slice(0, 50)
      }

      // --- update asks ---
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
        orderbook.asks.sort((a, b) => a[0] - b[0])
        orderbook.asks = orderbook.asks.slice(0, 50)
      }

      // --- hasil ---
      const bid = orderbook.bids.slice(0, 10).map(([price, qty]) => ({ price, qty, type: 'bid' }))
      const ask = orderbook.asks.slice(0, 10).map(([price, qty]) => ({ price, qty, type: 'ask' }))

      callback([...bid, ...ask])
    })

    activeHuobiOrderbookWS.push({ symbol, wsClientt })
  } catch (e) {
    console.log('error getHuobiOrderbook:', e)
  }
}

function stopHuobiOrderbook(){
  activeHuobiOrderbookWS.forEach((data)=>{
    const { symbol, wsClientt } = data
    try{
      wsClientt.unsubscribeMarketDepth(symbol, 'step1')
      console.log('ws stopped')
    } catch (e) {
      console.log('error stopping: ', e.message)
    }
    
  })
  activeHuobiOrderbookWS = []
}

function getHuobiConnection(){
  const now = Date.now()
  const diff = now - huobiLastMessageTime
  // console.log('huobi', diff)
  if (diff < 5000) return 100;
  if (diff < 10000) return 75;
  if (diff < 20000) return 50;
  if (diff < 30000) return 25;
  return 0;
}

module.exports = { 
  startHuobiWS,
  stopHuobiWS,
  getHuobiOrderbook,
  stopHuobiOrderbook,
  getHuobiConnection,
};

// const WebSocket = require('ws');
// const pako = require('pako');
// // const HUOBI_ENDPOINTS = ['wss://api.huobi.pro/ws','wss://api.huobi.vn/ws','wss://api.huobi.so/ws','wss://api-aws.huobi.pro/ws','wss://api.hbdm.com/ws'];
// // const BATCH_SIZE = 25;
// // const MAX_RETRIES = 5;
// const PING_INTERVAL = 30000;
// // let huobiShouldReconnect = true;
// // let confirmedSymbols = new Set();
// // let lastPrices = {};
// // let huobiPingSent = {};
// // let huobiConnStrength = {}; 
// // let huobiWSConnections = [];
// // let huobiReconnectTimers = [];
// // let huobiPingIntervals = []; 

// // function startHuobiLastPrice(symbols, callback) {
// //   stopHuobiWS()
// //   huobiShouldReconnect = true;
// //   const batches = splitToBatches(symbols, BATCH_SIZE);

// //   // kasih delay 5 detik sebelum mulai koneksi
  
// //     batches.forEach((batch, idx) => {
// //       connectToHuobi(batch, `batch_${idx}`, callback);
// //     });

// // }


// // function connectToHuobi(symbols, batchId, callback, uriIndex = 0, attempt = 0) {
// //   huobiShouldReconnect = true;
// //   if (!huobiShouldReconnect) {console.log(`[Huobi] Service stopped, aborting connection for ${batchId}`);return;}
// //   const uri = HUOBI_ENDPOINTS[uriIndex % HUOBI_ENDPOINTS.length];
// //   const ws = new WebSocket(uri);
// //   ws.binaryType = 'arraybuffer';
// //   ws.batchId = batchId;
// //   huobiWSConnections.push(ws);
// //   let pingInterval = null;
// //   ws.on('open', () => {
// //     if (!huobiShouldReconnect) {
// //       ws.close(1000, 'Service stopped');
// //       return;
// //     }
// //     console.log(`[Huobi] ✅ Connected: ${batchId} (${symbols.length} symbols)`);
// //     symbols.forEach((symbol) => {
// //       const msg = {
// //         sub: `market.${symbol.toLowerCase()}.ticker`,
// //         id: `sub_${symbol}_${Date.now()}`
// //       };
// //       ws.send(JSON.stringify(msg));
// //     });
// //     pingInterval = setInterval(() => {
// //       if (!huobiShouldReconnect) {
// //         clearInterval(pingInterval);
// //         ws.close(1000, 'Service stopped');
// //         return;
// //       }
// //       if (ws.readyState === WebSocket.OPEN) {
// //         huobiPingSent[batchId] = Date.now();
// //         ws.send(JSON.stringify({ ping: Date.now() }));
// //       }
// //     }, 3000);
// //     huobiPingIntervals.push(pingInterval);
// //   });
// //   ws.on('message', async (data) => {
// //     try {
// //       const text = decompressMessage(data);
// //       const json = JSON.parse(text);
// //       if (json.ping) {
// //         ws.send(JSON.stringify({ pong: json.ping }));
// //         return;
// //       }
// //       if (json.pong) {
// //         const sentAt = huobiPingSent[batchId];
// //         if (sentAt) {
// //           const latency = Date.now() - sentAt;
// //           const strength = Math.max(0, Math.min(100, 100 - ((latency - 100) / 9)));
// //           huobiConnStrength[batchId] = Math.round(strength);
// //           delete huobiPingSent[batchId];
// //         }
// //         return;
// //       }
// //       if (json.tick && json.ch) {
// //         const symbol = json.ch.split('.')[1].toUpperCase();
// //         const price = json.tick.close;
// //         if (!confirmedSymbols.has(symbol)) {
// //           confirmedSymbols.add(symbol);
// //           console.log(`[Huobi] Receiving data for ${symbol}`);
// //         }
// //         if (lastPrices[symbol] !== price && huobiShouldReconnect) {
// //           lastPrices[symbol] = price;
// //           callback([{ symbol, price }]);
// //         }
// //       }
// //     } catch (err) {console.error(`[Huobi] ❌ Error parsing message in ${batchId}:`, err.message);}
// //   });
// //   ws.on('error', (err) => {
// //     console.error(`[Huobi] WebSocket error (${batchId}):`, err.message);
// //     if (pingInterval) {
// //       clearInterval(pingInterval);
// //       const index = huobiPingIntervals.indexOf(pingInterval);
// //       if (index > -1) huobiPingIntervals.splice(index, 1);
// //     }
// //   });
// //   ws.on('close', () => {
// //     console.warn(`[Huobi] Connection closed: ${batchId}`);
// //     if (pingInterval) {
// //       clearInterval(pingInterval);
// //       const index = huobiPingIntervals.indexOf(pingInterval);
// //       if (index > -1) huobiPingIntervals.splice(index, 1);
// //     }
// //     const wsIndex = huobiWSConnections.findIndex(connection => connection === ws);
// //     if (wsIndex > -1) huobiWSConnections.splice(wsIndex, 1);
// //     if (huobiShouldReconnect && attempt < MAX_RETRIES) {
// //       const nextUriIndex = (uriIndex + 1) % HUOBI_ENDPOINTS.length;
// //       const delay = getBackoffDelay(attempt);
// //       console.log(`[Huobi] Reconnecting ${batchId} in ${delay/1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
// //       const reconnectTimer = setTimeout(() => {
// //         const timerIndex = huobiReconnectTimers.indexOf(reconnectTimer);
// //         if (timerIndex > -1) huobiReconnectTimers.splice(timerIndex, 1);
// //         if (huobiShouldReconnect) { connectToHuobi(symbols, batchId, callback, nextUriIndex, attempt + 1);}
// //       }, delay);
// //       huobiReconnectTimers.push(reconnectTimer);
// //     }
// //     else if (!huobiShouldReconnect) { console.log(`[Huobi] 🔌 Last Price stop for ${batchId}, not reconnecting.`);}
// //     else { console.error(`[Huobi] Max retry limit reached for ${batchId}`);}
// //   });
// // }

// // function stopHuobiWS() {
// //   console.log('[Huobi] Stopping all WebSocket connections...');
// //   huobiShouldReconnect = false;
// //   huobiReconnectTimers.forEach(timer => {
// //     try { clearTimeout(timer);}
// //     catch (e) { console.error('[Huobi] Error clearing reconnect timer:', e.message);}
// //   });
// //   huobiReconnectTimers = [];
// //   huobiPingIntervals.forEach(interval => {
// //     try {
// //       clearInterval(interval);
// //     } catch (e) {
// //       console.error('[Huobi] Error clearing ping interval:', e.message);
// //     }
// //   });
// //   huobiPingIntervals = [];
// //   const connectionCount = huobiWSConnections.length;
// //   huobiWSConnections.forEach((ws, index) => {
// //     try {
// //       if (ws && ws.readyState === WebSocket.OPEN) {
// //         ws.close(1000, 'Manual close');
// //         console.log(`[Huobi] Closed connection ${ws.batchId || index}`);
// //       }
// //     } catch (e) {console.error(`[Huobi] Error closing connection ${index}:`, e.message); }
// //   });
// //   huobiWSConnections = [];
// //   huobiPingSent = {};
// //   huobiConnStrength = {};
// //   confirmedSymbols.clear();
// //   lastPrices = {};
// //   console.log(`[Huobi] All ${connectionCount} WebSocket connections and timers stopped successfully`);
// // }
// // const BATCH_SIZE = 25;
// const MAX_RETRIES = 5;
// const REQ_INTERVAL = 120; // >100ms biar aman
// const HUOBI_ENDPOINT = "wss://api.huobi.pro/ws";

// let huobiShouldReconnect = true;
// let huobiWSConnections = [];
// let huobiReconnectTimers = [];
// let huobiReqQueue = [];
// let huobiReqTimer = null;

// let state = {
//   confirmedSymbols: new Set(),
//   lastPrices: {},
//   lastBook: {},
//   connStrength: {}, // batchId -> persen health
//   lastPing: {},     // batchId -> timestamp terakhir ping diterima
// };

// /**
//  * Start Huobi stream
//  */
// function startHuobiWSs(type, symbols, callback) {
//   stopHuobi(type);
//   huobiShouldReconnect = true;
//   const batches = splitToBatches(symbols, BATCH_SIZE);

//   batches.forEach((batch, idx) => {
//     connectToHuobi(type, batch, `batch_${idx}`, callback);
//   });
// }

// function connectToHuobi(type, symbols, batchId, callback, attempt = 0) {
//   if (!huobiShouldReconnect) {
//     console.log(`[Huobi] Service stopped, aborting connection for ${batchId}`);
//     return;
//   }

//   const ws = new WebSocket(HUOBI_ENDPOINT);
//   ws.binaryType = "arraybuffer";
//   ws.batchId = batchId;
//   ws.type = type;
//   huobiWSConnections.push(ws);

//   ws.on("open", () => {
//     console.log(`[Huobi] ✅ Connected: ${batchId} (${symbols.length} symbols) [${type}]`);

//     // Subscribe sesuai type
//     symbols.forEach((symbol) => {
//       const msg = {
//         sub:
//           type === "lastPrice"
//             ? `market.${symbol.toLowerCase()}.ticker`
//             : `market.${symbol.toLowerCase()}.bbo`,
//         id: `sub_${symbol}_${Date.now()}`,
//       };
//       ws.send(JSON.stringify(msg));
//     });

//     // inisialisasi connStrength
//     state.connStrength[batchId] = 100;
//     state.lastPing[batchId] = Date.now();
//   });

//   ws.on("message", (data) => {
//     try {
//       const text = decompressMessage(data);
//       const json = JSON.parse(text);

//       // Handle heartbeat (server → client)
//       if (json.ping) {
//         const now = Date.now();
//         const last = state.lastPing[batchId] || now;
//         const interval = now - last;

//         // normal interval ≈ 5000ms → kita ukur strength
//         const strength = Math.max(0, Math.min(100, 100 - Math.abs(interval - 5000) / 50));
//         state.connStrength[batchId] = Math.round(strength);
//         state.lastPing[batchId] = now;

//         ws.send(JSON.stringify({ pong: json.ping }));
//         return;
//       }

//       if (json.pong) {
//         // kalau kita kirim ping manual → opsional
//         return;
//       }

//       // Handle data
//       if (json.tick && json.ch) {
//         const symbol = json.ch.split(".")[1].toUpperCase();

//         if (!state.confirmedSymbols.has(symbol)) {
//           state.confirmedSymbols.add(symbol);
//           console.log(`[Huobi] Receiving data for ${symbol} [${type}]`);
//         }

//         if (type === "lastPrice") {
//           const price = json.tick.close;
//           if (state.lastPrices[symbol] !== price) {
//             state.lastPrices[symbol] = price;
//             callback([{ symbol, price }]);
//           }
//         } else if (type === "orderbook") {
//           const bestBid = json.tick.bid || null;
//           const bestAsk = json.tick.ask || null;
//           if (!state.lastBook[symbol]) {
//             state.lastBook[symbol] = { bid: null, ask: null };
//           }
//           const bidChanged = bestBid !== state.lastBook[symbol].bid;
//           const askChanged = bestAsk !== state.lastBook[symbol].ask;
//           if (bidChanged || askChanged) {
//             state.lastBook[symbol].bid = bestBid;
//             state.lastBook[symbol].ask = bestAsk;
//             callback([{ symbol, bid: bestBid, ask: bestAsk }]);
//           }
//         }
//       }
//     } catch (err) {
//       console.error(`[Huobi] ❌ Error parsing message in ${batchId}:`, err.message);
//     }
//   });

//   ws.on("error", (err) => {
//     console.error(`[Huobi] WebSocket error (${batchId}):`, err.message);
//   });

//   ws.on("close", () => {
//     console.warn(`[Huobi] Connection closed: ${batchId} [${type}]`);
//     delete state.connStrength[batchId];
//     delete state.lastPing[batchId];

//     const wsIndex = huobiWSConnections.findIndex((connection) => connection === ws);
//     if (wsIndex > -1) huobiWSConnections.splice(wsIndex, 1);

//     if (huobiShouldReconnect && attempt < MAX_RETRIES) {
//       const delay = getBackoffDelay(attempt);
//       console.log(`[Huobi] Reconnecting ${batchId} in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
//       const reconnectTimer = setTimeout(() => {
//         connectToHuobi(type, symbols, batchId, callback, attempt + 1);
//       }, delay);
//       huobiReconnectTimers.push(reconnectTimer);
//     }
//   });
// }

// /**
//  * Rate limited request (req)
//  */
// // function huobiRequest(ws, msg) {
// //   huobiReqQueue.push({ ws, msg });

// //   if (!huobiReqTimer) {
// //     huobiReqTimer = setInterval(() => {
// //       if (huobiReqQueue.length === 0) {
// //         clearInterval(huobiReqTimer);
// //         huobiReqTimer = null;
// //         return;
// //       }
// //       const { ws, msg } = huobiReqQueue.shift();
// //       if (ws && ws.readyState === WebSocket.OPEN) {
// //         ws.send(JSON.stringify(msg));
// //       }
// //     }, REQ_INTERVAL);
// //   }
// // }

// /**
//  * Stop semua koneksi Huobi
//  */
// function stopHuobi(type) {
//   console.log(`[Huobi] Stopping all WebSocket connections [${type}]...`);
//   huobiShouldReconnect = false;

//   huobiReconnectTimers.forEach((timer) => clearTimeout(timer));
//   huobiReconnectTimers = [];

//   const connectionCount = huobiWSConnections.length;
//   huobiWSConnections.forEach((ws) => {
//     try {
//       if (ws.readyState === WebSocket.OPEN) {
//         ws.close(1000, "Manual close");
//       }
//     } catch (e) {}
//   });
//   huobiWSConnections = [];

//   state.confirmedSymbols.clear();
//   state.lastPrices = {};
//   state.lastBook = {};
//   state.connStrength = {};
//   state.lastPing = {};

//   console.log(`[Huobi] All ${connectionCount} WebSocket connections stopped successfully`);
// }

// function decompressMessage(data) {const buffer = Buffer.from(data); return pako.ungzip(buffer, { to: 'string' });
// }
// function splitToBatches(array, size) {
//   const result = [];
//   for (let i = 0; i < array.length; i += size) {result.push(array.slice(i, i + size));}
//   return result;
// }
// function getBackoffDelay(attempt) {return Math.min(1000 * 2 ** attempt, PING_INTERVAL);}

// let currentHuobiOrderbookWS = null;
// function getHuobiOrderbooksss(symbol, callback) {
//   if (currentHuobiOrderbookWS) {currentHuobiOrderbookWS.close();currentHuobiOrderbookWS = null;  }
//   const lowerSymbol = (symbol + "USDT").toLowerCase();
//   const uri = HUOBI_ENDPOINTS[0];
//   const ws = new WebSocket(uri);
//   ws.binaryType = 'arraybuffer';
//   currentHuobiOrderbookWS = ws;
//   ws.on('open', () => {
//     console.log(`[Huobi] Subscribing orderbook for ${lowerSymbol}`);
//     ws.send(JSON.stringify({
//       sub: `market.${lowerSymbol}.depth.step0`,
//       id: `depth_${lowerSymbol}_${Date.now()}`
//     }));
//   });
//   ws.on('message', (data) => {
//     try {
//       const text = decompressMessage(data);
//       const json = JSON.parse(text);
//       if (json.ping) { ws.send(JSON.stringify({ pong: json.ping }));return; }
//       if (json.tick && json.tick.bids && json.tick.asks) {
//       const bids = json.tick.bids.slice(0, 10).map(([price, qty]) => ({price: parseFloat(price),qty: parseFloat(qty), type: 'bid'}));
//       const asks = json.tick.asks.slice(0, 10).map(([price, qty]) => ({ price: parseFloat(price), qty: parseFloat(qty), type: 'ask'}));
//         callback([...bids, ...asks]);
//       }
//     } catch (err) {console.error('[Huobi Orderbook WS Error]', err); callback([]);}
//   });
//   ws.on('error', (err) => {console.error('[Huobi Orderbook WS Error]', err);callback([]);});
// }

// function stopHuobiOrderbooksss() {
//   if (currentHuobiOrderbookWS) {
//     currentHuobiOrderbookWS.close();
//     currentHuobiOrderbookWS = null;
//   }
// }

// function getHuobiConnectiosssn() {
//   const strengths = Object.values(state.connStrength);
//   if (strengths.length === 0) return 0;
//   const avg = strengths.reduce((a, b) => a + b, 0) / strengths.length;
//   return avg;
// }

// let huobiOrderbookReconnect = true;
// let orderbookConfirmedSymbols = new Set();
// let lastBook = {};
// let huobiOrderbookWSConnections = [];
// let huobiOrderbookReconnectTimers = [];
// let huobiOrderbookPingIntervals = []; 
// function startHuobiOrderbook(symbols, callback){
//   stopHuobiWS()
//   huobiOrderbookReconnect = true;
//   const batches = splitToBatches(symbols, BATCH_SIZE);

//     batches.forEach((batch, idx) => {
//       connectToHuobiOrderbook(batch, `batch_${idx}`, callback);
//     });

// }

// function connectToHuobiOrderbook(symbols, batchId, callback , uriIndex = 0, attempt = 0) {
//   huobiOrderbookReconnect = true;
//   if (!huobiOrderbookReconnect) {console.log(`[Huobi] Service stopped, aborting connection for ${batchId}`);return;}
//   const uri = HUOBI_ENDPOINTS[uriIndex % HUOBI_ENDPOINTS.length];
//   const ws = new WebSocket(uri);
//   ws.binaryType = 'arraybuffer';
//   ws.batchId = batchId;
//   huobiOrderbookWSConnections.push(ws);
//   let pingInterval = null;
//   ws.on('open', () => {
//     if (!huobiOrderbookReconnect) {
//       ws.close(1000, 'Service stopped');
//       return;
//     }
//     console.log(`[Huobi] ✅ Connected: ${batchId} (${symbols.length} symbols)`);
//     symbols.forEach((symbol) => {
//       const msg = {
//         sub: `market.${symbol.toLowerCase()}.bbo`,
//         id: `sub_${symbol}_${Date.now()}`
//       };
//       ws.send(JSON.stringify(msg));
//     });
//     pingInterval = setInterval(() => {
//       if (!huobiOrderbookReconnect) {
//         clearInterval(pingInterval);
//         ws.close(1000, 'Service stopped');
//         return;
//       }
//       if (ws.readyState === WebSocket.OPEN) {
//         huobiPingSent[batchId] = Date.now();
//         ws.send(JSON.stringify({ ping: Date.now() }));
//       }
//     }, 3000);
//     huobiOrderbookPingIntervals.push(pingInterval);
//   });
//   ws.on('message', async (data) => {
//     try {
//       const text = decompressMessage(data);
//       const json = JSON.parse(text);
//       if (json.ping) {ws.send(JSON.stringify({ pong: json.ping }));return; }
//       if (json.tick && json.ch) {
//         const symbol = json.ch.split('.')[1].toUpperCase();
//         const bestBid = json.tick.bid || null;
//         const bestAsk = json.tick.ask || null;
//         if (!orderbookConfirmedSymbols.has(symbol)) {
//           orderbookConfirmedSymbols.add(symbol);
//           console.log(`[Huobi] Receiving data for ${symbol}`);
//         }
//         if (!lastBook[symbol]) {lastBook[symbol] = { bid: null, ask: null }; }
//         const bidChanged = bestBid !== lastBook[symbol].bid;
//         const askChanged = bestAsk !== lastBook[symbol].ask;
//         if (bidChanged || askChanged) {
//           lastBook[symbol].bid = bestBid;
//           lastBook[symbol].ask = bestAsk;
//           callback([{ symbol, bid: bestBid, ask: bestAsk }]);
//         }
//       }
//     } catch (err) {console.error(`[Huobi] ❌ Error parsing message in ${batchId}:`, err.message);}
//   });

//   ws.on('error', (err) => {
//     console.error(`[Huobi] WebSocket error (${batchId}):`, err.message);
//     if (pingInterval) {
//       clearInterval(pingInterval);
//       const index = huobiOrderbookPingIntervals.indexOf(pingInterval);
//       if (index > -1) huobiOrderbookPingIntervals.splice(index, 1);
//     }
//   });
//   ws.on('close', () => {
//     console.warn(`[Huobi] Connection closed: ${batchId}`);
//     if (pingInterval) {
//       clearInterval(pingInterval);
//       const index = huobiOrderbookPingIntervals.indexOf(pingInterval);
//       if (index > -1) huobiOrderbookPingIntervals.splice(index, 1);
//     }
//     const wsIndex = huobiOrderbookWSConnections.findIndex(connection => connection === ws);
//     if (wsIndex > -1) huobiOrderbookWSConnections.splice(wsIndex, 1);
//     if (huobiOrderbookReconnect && attempt < MAX_RETRIES) {
//       const nextUriIndex = (uriIndex + 1) % HUOBI_ENDPOINTS.length;
//       const delay = getBackoffDelay(attempt);
//       console.log(`[Huobi] Reconnecting ${batchId} in ${delay/1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
//       const reconnectTimer = setTimeout(() => {
//         const timerIndex = huobiOrderbookReconnectTimers.indexOf(reconnectTimer);
//         if (timerIndex > -1) huobiOrderbookReconnectTimers.splice(timerIndex, 1);
//         if (huobiOrderbookReconnect) { connectToHuobiOrderbook(symbols, batchId, callback, nextUriIndex, attempt + 1);}
//       }, delay);
//       huobiOrderbookReconnectTimers.push(reconnectTimer);
//     }
//     else if (!huobiOrderbookReconnect) { console.log(`[Huobi] 🔌 Manual stop for ${batchId}, not reconnecting.`);}
//     else { console.error(`[Huobi] Max retry limit reached for ${batchId}`);}
//   });
// }
