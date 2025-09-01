const https = require('https');
async function getActiveOkxSymbols() {
  const url = 'https://www.okx.com/api/v5/public/instruments?instType=SPOT';

  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';

      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code !== '0') {
            console.log('[OKX] Gagal ambil simbol:', json.msg);
            resolve(new Set());
            return;
          }

          // ambil hanya simbol aktif (state = live)
          const symbols = new Set(
            json.data
              .filter(item => item.state === 'live')
              .map(item => item.instId)  // contoh: "BTC-USDT"
          );

          resolve(symbols);
        } catch (err) {
          console.error('[OKX] ERROR parsing JSON:', err);
          resolve(new Set());
        }
      });
    }).on('error', (err) => {
      console.error('[OKX] ERROR:', err.message);
      resolve(new Set());
    });
  });
}
const { DefaultLogger, WebsocketClient } = require('okx-api');
const { chunkArray } = require('../utils/helper')

let okxLastMessageTime = 0;
let activeOkxClients = [];
let activeOkxOrderbooks = [];
let activeOkxCallbacks = {};

const logger = {
  ...DefaultLogger,
  trace: (...params) => console.log('trace', ...params),
};
/**
 * Start Bitget WebSocket dengan batch subscribe
 * @param {string} type - tipe market, contoh: 'orderbook', 'lastPrice'
 * @param {string[]} targetSymbols - list symbol misalnya ['BTCUSDT','ETHUSDT']
 * @param {function} callback - function yg dipanggil tiap ada update
 */
async function startOkxWS(type, targetSymbols, callback) {
  const existingClient = activeOkxClients.find(client => client.type === type);
  if (existingClient) {
    console.log(`Reusing existing OKX WS connection for type: ${type}`);
    
    // Tambah callback untuk type ini
    if (!activeOkxCallbacks[type]) {
      activeOkxCallbacks[type] = [];
    }
    activeOkxCallbacks[type].push(callback);
    
    return existingClient.wsClient;
  }

  const validSymbols = await getActiveOkxSymbols();

  const dashSymbols = [];
  const symbolMap = {};

  targetSymbols.forEach(sym => {
    const dash = sym.endsWith("USDT") 
      ? sym.replace(/USDT$/, "-USDT") 
      : sym;

    if (!validSymbols.has(dash)) {
      return;
    }

    dashSymbols.push(dash);
    symbolMap[dash] = sym;
  });

  const wsClient = new WebsocketClient({}, logger);

  const lastPrices = {};
  const orderbooks = {};

  // Initialize callbacks array untuk type ini
  if (!activeOkxCallbacks[type]) {
    activeOkxCallbacks[type] = [];
  }
  activeOkxCallbacks[type].push(callback);

  wsClient.on('update', (msg) => {
    okxLastMessageTime = Date.now();
    const updates = [];
    const payload = msg.data;

    if (!payload) return;

    if (type === "lastPrice") {
      const items = Array.isArray(payload) ? payload : [payload];

      for (const item of items) {
        const symbol = item.instId?.toUpperCase();
        if (!symbol) continue;

        const originalSymbol = symbolMap[symbol] || symbol.replace('-', '');
        const price = parseFloat(item.last);
        if (isNaN(price)) continue;

        if (lastPrices[symbol] !== price) {
          lastPrices[symbol] = price;
          updates.push({ symbol:originalSymbol, price:price });
        }
      }
    }


    if (type === "orderbook") {
      const symbol = msg.arg?.instId?.toUpperCase();
      const originalSymbol = symbolMap[symbol] || symbol.replace('-', '');
      if (!symbol) return;

      const bookData = payload[0];
      if (!bookData) return;

      const bestBid = bookData.bids?.length ? bookData.bids[0] : null;
      const bid = bestBid ? parseFloat(bestBid[0]) : null;
      const bestAsk = bookData.asks?.length ? bookData.asks[0] : null;
      const ask = bestAsk ? parseFloat(bestAsk[0]) : null;

      if (isNaN(bid) || isNaN(ask)) return;

      const prev = orderbooks[symbol] || {};
      if (prev.bid !== bid || prev.ask !== ask) {
        orderbooks[symbol] = { bid, ask };
        updates.push({ symbol: originalSymbol, bid: bid, ask: ask });
      }
    }

    // Panggil semua callback yang aktif untuk type ini
    if (updates.length > 0 && activeOkxCallbacks[type]) {
      activeOkxCallbacks[type].forEach(cb => {
        if (typeof cb === "function") {
          cb(updates);
        }
      });
    }
  });

  wsClient.on('open', (data) => console.log('WS connection opened:', data.wsKey));
  wsClient.on('response', (data) => console.log('WS response:', JSON.stringify(data, null, 2)));
  wsClient.on('reconnect', ({ wsKey }) => console.log('WS reconnecting...', wsKey));
  wsClient.on('reconnected', (data) => console.log('WS reconnected', data?.wsKey));
  wsClient.on('exception', (data) => console.error('WS error', data));

  const batches = chunkArray(dashSymbols, 100);

  batches.forEach((batch, idx) => {
    setTimeout(() => {
      if (type === "lastPrice") {
        const topics = batch.map(sym => ({
          channel: 'tickers',
          instId: sym
        }));
        wsClient.subscribe(topics);
        console.log(`Subscribed batch ${idx + 1}:`, topics);
      }

      if (type === "orderbook") {
        const topics = batch.map(sym => ({
          channel: 'bbo-tbt',
          instId: sym
        }));
        wsClient.subscribe(topics);
        console.log(`Subscribed batch ${idx + 1}:`, topics);
      }
    }, idx * 500);
  });

  activeOkxClients.push({ wsClient, type, dashSymbols });
  return wsClient;
}

function stopOkxWS() {
  activeOkxClients.forEach((clientInfo) => {
    const { wsClient, type, dashSymbols } = clientInfo;
    if (!wsClient) return;

    try {
      const batches = chunkArray(dashSymbols, 100);
      batches.forEach((batch, idx) => {
        setTimeout(() => {
            const topics = batch.map(sym => ({
              channel: 'tickers',
              instId: sym
            }));
            wsClient.unsubscribe(topics);
            console.log(`Subscribed batch ${idx + 1}:`, topics);
        }, idx * 500);
      });
      wsClient.removeAllListeners()
      wsClient.closeAll();
      console.log("Stopped OKX WS:", type, dashSymbols);
    } catch (e) {
      console.error("Error stopping OKX WS:", e.message);
    }
  });

  activeOkxClients = [];
  activeOkxCallbacks = {}; // Reset callbacks juga
}

/**
 * Start Bybit Orderbook 
 * @param {string[]} targetSymbols - list symbol misalnya 'BTCUSDT'
 * @param {function} callback - function yg dipanggil tiap ada update
 */
function getOkxOrderbook(targetSymbols, onUpdate) {
  const symbol = targetSymbols+"USDT";
  const dash = symbol.endsWith("USDT")
    ? symbol.replace(/USDT$/, "-USDT")
    : symbol;

  const wsClient = new WebsocketClient({}, logger);
  const orderbook = { bids: [], asks: [] };
  let hasSnapshot = false;

  wsClient.on('update', (msg) => {
    const action = msg.action;
    const bookData = msg.data?.[0];
    if (!bookData) return;

    if (action === 'snapshot') {
      hasSnapshot = true;
      orderbook.bids = [];
      orderbook.asks = [];
    }

    if (!hasSnapshot) return;

    if (action === 'snapshot' || action === 'update') {
      // --- update bids ---
      (bookData.bids || []).forEach(([price, quantity]) => {
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
      orderbook.bids = orderbook.bids.slice(0, 50);

      // --- update asks ---
      (bookData.asks || []).forEach(([price, quantity]) => {
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
      orderbook.asks = orderbook.asks.slice(0, 50);

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
  wsClient.subscribe({
    channel: 'books',
    instId: dash,
  });
  activeOkxOrderbooks.push({ wsClient, dash })
  return wsClient;
}

function stopOkxOrderbook() {
  activeOkxOrderbooks.forEach((clientInfo) => {
    const { wsClient, dash } = clientInfo;
    if (!wsClient) return;

    try {
      wsClient.unsubscribe({channel:'books', instId: dash});
      // wsClient.closeAll();
      console.log(`Stopped OKX Orderbook: ${dash}`);
    } catch (e) {
      console.error("Error stopping OKX Orderbook:", e.message);
    }
  });

  activeOkxOrderbooks = []; 
}

function getOkxConnection() {
  const now = Date.now();
  const diff = now - okxLastMessageTime;

  if (diff < 5000) return 100;
  if (diff < 10000) return 75;
  if (diff < 20000) return 50;
  if (diff < 30000) return 25;
  return 0;
}

module.exports = {
  startOkxWS, 
  stopOkxWS, 
  getOkxOrderbook, 
  stopOkxOrderbook, 
  getOkxConnection, 
};
// const WebSocket = require('ws');

// let currentOkxTickerWS = null; // simpan koneksi price ticker
// let reconnectOkx=true;

// // Map untuk menyimpan moving average latency
// let okxLatency = 0; // moving average latency ms
// let lastUpdateTimestamp = null;

// function startOkxWS(targetSymbols = [], callback) {
//   reconnectOkx=true
//   const wsUrl = 'wss://ws.okx.com:8443/ws/v5/public';

//   const dashSymbols = [];
//   const symbolMap = {}; // BTC-USDT → BTCUSDT

//   // Konversi ke format OKX: BTCUSDT → BTC-USDT
//   for (const sym of targetSymbols) {
//     if (sym.length >= 6) {
//       const base = sym.slice(0, -4);
//       const quote = sym.slice(-4);
//       const dash = `${base}-${quote}`;
//       dashSymbols.push(dash);
//       symbolMap[dash] = sym;
//     } else {
//       dashSymbols.push(sym);
//       symbolMap[sym] = sym;
//     }
//   }

//   const lastPrices = {};

//   let ws;

//   function connect() {
//     ws = new WebSocket(wsUrl);
//     currentOkxTickerWS = ws; // simpan koneksi ticker

//     ws.on('open', () => {
//       const args = dashSymbols.map((s) => ({
//         channel: 'tickers',
//         instId: s,
//       }));

//       const subMsg = {
//         op: 'subscribe',
//         args,
//       };

//       ws.send(JSON.stringify(subMsg));
//     });

//     ws.on('message', (message) => {
//       try {
//         const data = JSON.parse(message);
//         if (data.event === 'subscribe') {
//           console.log('[OKX] Subscription success:', data);
//           return;
//         }

//         if (Array.isArray(data.data)) {
//           const updates = [];
//           const now = Date.now();

//           if (lastUpdateTimestamp) {
//             const delta = now - lastUpdateTimestamp;
//             // Moving average latency dengan alpha = 0.1
//             okxLatency = okxLatency ? okxLatency * 0.9 + delta * 0.1 : delta;
//           }
//           lastUpdateTimestamp = now;

//           for (const ticker of data.data) {
//             const instId = ticker.instId;
//             const price = ticker.last;

//             if (!instId || !price) continue;

//             const originalSymbol = symbolMap[instId] || instId.replace('-', '');
//             if (lastPrices[originalSymbol] !== price) {
//               lastPrices[originalSymbol] = price;
//               updates.push({ symbol: originalSymbol, price });
//             }
//           }

//           if (updates.length > 0) {
//             callback({
//               exchange: 'OKX',
//               data: updates,
//             });
//           }
//         }
//       } catch (err) {
//         console.error('[OKX] Message error:', err);
//       }
//     });

//     ws.on('error', (err) => {
//       console.error('[OKX] Error:', err.message);
//     });

//     ws.on('close', (code, reason) => {
//       if(reconnectOkx){
//         console.warn(`[OKX] Connection closed: ${code} - ${reason}. Reconnecting in 5s...`);
//         setTimeout(connect, 5000);
//       }
//       console.log("[OKX] Manually Closed Connection")

//     });
//   }

//   connect();
// }
// function getOkxConnectionStrength() {
//   if (!okxLatency) return 0;
//   const percent = Math.max(0, Math.min(100, Math.round((2000 - okxLatency) / 2000 * 100)));
//   return percent;
// }


// let currentOkxOrderbookWS = null;

// function getOkxOrderbook(symbol, callback) {
//   if (currentOkxOrderbookWS) {
//     currentOkxOrderbookWS.close();
//     currentOkxOrderbookWS = null;
//   }

//   const symbolOkx = symbol.toUpperCase() + '-USDT';
//   const wsUrl = 'wss://ws.okx.com:8443/ws/v5/public';

//   let bids = [];
//   let asks = [];

//   const ws = new WebSocket(wsUrl);
//   currentOkxOrderbookWS = ws;

//   ws.on('open', () => {
//     ws.send(JSON.stringify({
//       op: 'subscribe',
//       args: [{ channel: 'books', instId: symbolOkx }]
//     }));
//     console.log(`[OKX-OB] Subscribed to ${symbolOkx} orderbook`);
//   });

//   ws.on('message', (raw) => {
//     try {
//       const msg = JSON.parse(raw);

//       if (msg.event === 'subscribe') return;
//       if (!msg.data || !msg.arg?.channel.includes('books')) return;

//       const obData = msg.data[0];

//       // Snapshot pertama
//       if (msg.action === 'snapshot' || (!msg.action && obData.bids && obData.asks)) {
//         bids = obData.bids.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
//         asks = obData.asks.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
//       }

//       // Incremental update
//       if (msg.action === 'update') {
//         if (obData.bids) updateSide(bids, obData.bids, true);
//         if (obData.asks) updateSide(asks, obData.asks, false);
//       }

//       const bidList = bids
//         .sort((a, b) => b[0] - a[0]) // descending
//         .slice(0, 10)
//         .map(([price, qty]) => ({ price, qty, type: 'bid' }));

//       const askList = asks
//         .sort((a, b) => a[0] - b[0]) // ascending
//         .slice(0, 10)
//         .map(([price, qty]) => ({ price, qty, type: 'ask' }));

//       callback([...bidList, ...askList]);

//     } catch (err) {
//       console.error('[OKX Orderbook WS Error] Parse failed:', err);
//     }
//   });

//   ws.on('error', (err) => {
//     console.error('[OKX Orderbook WS Error]', err);
//     callback([]);
//   });

//   ws.on('close', () => {
//     console.warn('[OKX-OB] Closed');
//     currentOkxOrderbookWS = null;
//   });

//   function updateSide(sideArray, updates, isBid) {
//     for (const [p, q] of updates) {
//       const price = parseFloat(p);
//       const qty = parseFloat(q);
//       const idx = sideArray.findIndex(([sp]) => sp === price);
//       if (qty === 0) {
//         if (idx !== -1) sideArray.splice(idx, 1); // hapus level
//       } else {
//         if (idx !== -1) {
//           sideArray[idx][1] = qty; // update qty
//         } else {
//           sideArray.push([price, qty]);
//         }
//       }
//     }
//   }
// }

// function closeOkxOrderbookWS() {
//   if (currentOkxOrderbookWS) {
//     currentOkxOrderbookWS.close();
//     currentOkxOrderbookWS = null;
//   }
// }

// function stopOkxWS() {
//   reconnectOkx=false;
//   if (currentOkxTickerWS) {
//     try {
//       currentOkxTickerWS.close();
//       console.log('[OKX] 🔌 Price ticker WS closed.');
//     } catch (e) {
//       console.error('[OKX] Error closing ticker WS:', e.message);
//     }
//     currentOkxTickerWS = null;
//   }
// }

// function multipleOkxOrderbook(targetSymbols = [], callback) {
//   reconnectOkx=true
//   const wsUrl = 'wss://ws.okx.com:8443/ws/v5/public';

//   const dashSymbols = [];
//   const symbolMap = {};

//   for (const sym of targetSymbols) {
//     if (sym.length >= 6) {
//       const base = sym.slice(0, -4);
//       const quote = sym.slice(-4);
//       const dash = `${base}-${quote}`;
//       dashSymbols.push(dash);
//       symbolMap[dash] = sym;
//     } else {
//       dashSymbols.push(sym);
//       symbolMap[sym] = sym;
//     }
//   }

//   const lastPrices = {};

//   let ws;

//   function connect() {
//     ws = new WebSocket(wsUrl);
//     currentOkxTickerWS = ws; // simpan koneksi ticker

//     ws.on('open', () => {
//       const args = dashSymbols.map((s) => ({
//         channel: 'bbo-tbt',
//         instId: s,
//       }));

//       const subMsg = {
//         op: 'subscribe',
//         args,
//       };

//       ws.send(JSON.stringify(subMsg));
//     });

//     ws.on('message', (message) => {
//       try {
//         const data = JSON.parse(message);

//         // Subscription sukses
//         if (data.event === 'subscribe') {
//           console.log('[OKX] Subscription success:', data);
//           return;
//         }

//         if (Array.isArray(data.data) && data.data.length > 0) {
//           const updates = [];

//           for (const item of data.data) {
//             const instId = item.instId || data.arg?.instId;
//             if (!instId || !item.bids || !item.asks) continue;

//             const bestBid = parseFloat(item.bids[0][0]);
//             const bestAsk = parseFloat(item.asks[0][0]);
//             const originalSymbol = symbolMap[instId] || instId.replace('-', '');

//             const last = lastPrices[originalSymbol] || {};
//             if (last.bid !== bestBid || last.ask !== bestAsk) {
//               lastPrices[originalSymbol] = { bid: bestBid, ask: bestAsk };
//               updates.push({ symbol: originalSymbol, bid: bestBid, ask: bestAsk });
//             }
//           }

//           if (updates.length > 0) {
//             callback({
//               exchange: 'OKX',
//               data: updates,
//             });
//           }
//         }
//       } catch (err) {
//         console.error('[OKX] Message error:', err);
//       }
//     });


//     ws.on('error', (err) => {
//       console.error('[OKX] Error:', err.message);
//     });

//     ws.on('close', (code, reason) => {
//       if(reconnectOkx){
//         console.warn(`[OKX] Connection closed: ${code} - ${reason}. Reconnecting in 5s...`);
//         setTimeout(connect, 5000);
//       }
//       console.log("[OKX] Manually Closed Connection")

//     });
//   }

//   connect();
// }

