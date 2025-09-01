const https = require('https');
async function getActiveBybitSymbols() {
  const url = 'https://api.bybit.com/v5/market/instruments-info?category=spot';

  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';

      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.retCode !== 0) {
            console.log('[Bybit] Gagal ambil simbol:', json.retMsg);
            resolve(new Set());
            return;
          }

          const symbols = new Set(
            json.result.list
              .filter(item => item.status === 'Trading')
              .map(item => item.symbol)
          );

          resolve(symbols);
        } catch (err) {
          console.error('[Bybit] ERROR parsing JSON:', err);
          resolve(new Set());
        }
      });
    }).on('error', (err) => {
      console.error('[Bybit] ERROR:', err.message);
      resolve(new Set());
    });
  });
}

const { DefaultLogger, WebsocketClient } = require('bybit-api');
const { chunkArray } = require('../utils/helper');

let bybitLastMessageTime = 0;
let activeBybitClients = [];
let activeBybitOrderbooks = [];
let activeBybitCallbacks = {};


/**
 * Start Bitget WebSocket dengan batch subscribe
 * @param {string} type - tipe market, contoh: 'orderbook', 'lastPrice'
 * @param {string[]} targetSymbols - list symbol misalnya ['BTCUSDT','ETHUSDT']
 * @param {function} callback - function yg dipanggil tiap ada update
 */
async function startBybitWS(type, targetSymbols, callback) {
  const existingClient = activeBybitClients.find(client => client.type === type);
  if (existingClient) {
    console.log(`Reusing existing Bybit WS connection for type: ${type}`);
    
    // Tambah callback untuk type ini
    if (!activeBybitCallbacks[type]) {
      activeBybitCallbacks[type] = [];
    }
    activeBybitCallbacks[type].push(callback);
    
    return existingClient.wsClient;
  }

  const activeSymbols = await getActiveBybitSymbols();

  const filteredSymbols = targetSymbols.filter(symbol => activeSymbols.has(symbol));
  const logger = {
    ...DefaultLogger,
    trace: (...params) => console.log('trace', ...params),
  };

  const wsClient = new WebsocketClient({}, logger);

  const lastPrices = {};
  const orderbooks = {};

  // Initialize callbacks array untuk type ini
  if (!activeBybitCallbacks[type]) {
    activeBybitCallbacks[type] = [];
  }
  activeBybitCallbacks[type].push(callback);

  wsClient.on('update', (msg) => {
    bybitLastMessageTime = Date.now();
    const updates = [];
    const payload = msg.data;

    if (!payload) return;

    if (type === "lastPrice") {
      const items = Array.isArray(payload) ? payload : [payload];

      for (const item of items) {
        const symbol = item.symbol?.toUpperCase();
        if (!symbol) continue;

        const price = parseFloat(item.lastPrice);
        if (isNaN(price)) continue;

        if (lastPrices[symbol] !== price) {
          lastPrices[symbol] = price;
          updates.push({ symbol, price });
        }
      }
    }

    if (type === "orderbook") {
      const symbol = payload.s?.toUpperCase();
      if (!symbol) return;

      const bestBid = payload.b?.length ? payload.b[0] : null;
      const bid = bestBid ? parseFloat(bestBid[0]) : null;
      const bestAsk = payload.a?.length ? payload.a[0] : null;
      const ask = bestAsk ? parseFloat(bestAsk[0]) : null;

      if (isNaN(bid) || isNaN(ask)) return;

      const prev = orderbooks[symbol] || {};
      if (prev.bid !== bid || prev.ask !== ask) {
        orderbooks[symbol] = { bid, ask };
        updates.push({ symbol, bid, ask });
      }
    }

    // Panggil semua callback yang aktif untuk type ini
    if (updates.length > 0 && activeBybitCallbacks[type]) {
      activeBybitCallbacks[type].forEach(cb => {
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

  const batches = chunkArray(filteredSymbols, 10);

  batches.forEach((batch, idx) => {
    setTimeout(() => {
      if (type === "lastPrice") {
        const topics = batch.map(sym => `tickers.${sym}`);
        wsClient.subscribeV5(topics, "spot");
        console.log(`Subscribed batch ${idx + 1}:`, topics);
      }

      if (type === "orderbook") {
        const topics = batch.map(sym => `orderbook.1.${sym}`);
        wsClient.subscribeV5(topics, "spot");
        console.log(`Subscribed batch ${idx + 1}:`, topics);
      }
    }, idx * 500);
  });

  activeBybitClients.push({ wsClient, type, targetSymbols });
  return wsClient;
}

function stopBybitWS() {
  activeBybitClients.forEach((clientInfo) => {
    const { wsClient, type, targetSymbols } = clientInfo;
    if (!wsClient) return;

    try {
      const batches = chunkArray(targetSymbols, 10);

      batches.forEach((batch, idx) => {
        setTimeout(() => {
          if (type === "lastPrice") {
            const topics = batch.map(sym => `tickers.${sym}`);
            wsClient.unsubscribeV5(topics, "spot");
            console.log(`Unsubscribed batch ${idx + 1}:`, topics);
          }
          if (type === "orderbook") {
            const topics = batch.map(sym => `orderbook.1.${sym}`);
            wsClient.unsubscribeV5(topics, "spot");
            console.log(`Unsubscribed batch ${idx + 1}:`, topics);
          }
        }, idx * 300);
      });

      setTimeout(() => {
        wsClient.removeAllListeners();
        wsClient.closeAll();
        console.log("Stopped Bybit WS:", type);
      }, batches.length * 300 + 1000);
      
    } catch (e) {
      console.error("Error stopping Bybit WS:", e.message);
    }
  });

  activeBybitClients = [];
  activeBybitCallbacks = {}; 
}

/**
 * Start Bybit WebSocket dengan batch subscribe
 * @param {string[]} targetSymbols - list symbol misalnya 'BTCUSDT'
 * @param {function} callback - function yg dipanggil tiap ada update
 */
function getBybitOrderbook(targetSymbols, onUpdate) {
  const symbol = targetSymbols+"USDT";
  const logger = {
    ...DefaultLogger,
    trace: (...params) => console.log('trace', ...params),
  };
  
  const wsClient = new WebsocketClient({}, logger);
  const orderbook = { bids: [], asks: [] };
  let hasSnapshot = false;

  wsClient.on('update', (data) => {
    if (data.type === 'snapshot') {
      hasSnapshot = true;
      orderbook.bids = [];
      orderbook.asks = [];
    }

    if (!hasSnapshot) return;
    if (data.type === 'delta') {
      const bookData = data.data;
      if (!bookData) return;

      // --- update bids ---
      (bookData.b || []).forEach(([price, quantity]) => {
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
      (bookData.a || []).forEach(([price, quantity]) => {
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
  wsClient.subscribeV5(`orderbook.50.${symbol}`, 'spot');
  activeBybitOrderbooks.push({ wsClient, symbol });
  return wsClient;
}

function stopBybitOrderbook() {
  activeBybitOrderbooks.forEach((clientInfo) => {
    const { wsClient, symbol } = clientInfo;
    if (!wsClient) return;

    try {
      wsClient.unsubscribeV5(`orderbook.50.${symbol}`, 'spot');
      // wsClient.closeAll();
      console.log(`Stopped Bybit Orderbook: ${symbol}`);
    } catch (e) {
      console.error("Error stopping Bybit Orderbook:", e.message);
    }
  });

  activeBybitOrderbooks = [];
}
function getBybitConnection() {
  const now = Date.now();
  const diff = now - bybitLastMessageTime;

  if (diff < 5000) return 100;
  if (diff < 10000) return 75;
  if (diff < 20000) return 50;
  if (diff < 30000) return 25;
  return 0;
}
module.exports = {
  startBybitWS, 
  stopBybitWS, 
  getBybitOrderbook,
  stopBybitOrderbook,
  getBybitConnection,
  // multipleBybitOrderbook
};
// const WebSocket = require('ws');
// const https = require('https');

// /**
//  * Ambil simbol Spot aktif dari Bybit (status = Trading)
//  * @returns {Promise<Set<string>>}
//  */
// async function getActiveBybitSymbols() {
//   const url = 'https://api.bybit.com/v5/market/instruments-info?category=spot';

//   return new Promise((resolve) => {
//     https.get(url, (res) => {
//       let data = '';

//       res.on('data', chunk => data += chunk);
//       res.on('end', () => {
//         try {
//           const json = JSON.parse(data);
//           if (json.retCode !== 0) {
//             console.log('[Bybit] Gagal ambil simbol:', json.retMsg);
//             resolve(new Set());
//             return;
//           }

//           const symbols = new Set(
//             json.result.list
//               .filter(item => item.status === 'Trading')
//               .map(item => item.symbol)
//           );

//           resolve(symbols);
//         } catch (err) {
//           console.error('[Bybit] ERROR parsing JSON:', err);
//           resolve(new Set());
//         }
//       });
//     }).on('error', (err) => {
//       console.error('[Bybit] ERROR:', err.message);
//       resolve(new Set());
//     });
//   });
// }
// let bybitLatency = 0;
// let lastBybitUpdate = null;
// let lastPrices = {};
// let currentBybitWS = null;

// async function startBybitWS(targetSymbols, callback) {
//   const socketUrl = 'wss://stream.bybit.com/v5/public/spot';
//   const activeSymbols = await getActiveBybitSymbols();

//   const filtered = targetSymbols
//     .filter(s => activeSymbols.has(s.toUpperCase()))
//     .map(s => `tickers.${s.toUpperCase()}`);

//   console.log(`[Bybit] Total simbol aktif yang disubscribe: ${filtered.length}`);

//   const ws = new WebSocket(socketUrl);
//   currentBybitWS = ws;

//   ws.on('open', () => {
//     const chunkSize = 10;
//     for (let i = 0; i < filtered.length; i += chunkSize) {
//       const chunk = filtered.slice(i, i + chunkSize);
//       const subMsg = {
//         op: 'subscribe',
//         args: chunk
//       };
//       ws.send(JSON.stringify(subMsg));
//     }
//   });

//   ws.on('message', (msg) => {
//     try {
//       const parsed = JSON.parse(msg);
//       if (!parsed.data) return;
//       const now = Date.now();
//       if (lastBybitUpdate) {
//         const delta = now - lastBybitUpdate;
//         bybitLatency = bybitLatency ? bybitLatency * 0.9 + delta * 0.1 : delta;
//       }
//       lastBybitUpdate = now;
//       const items = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
//       const updated = [];
//       for (const item of items) {
//         const symbol = item.symbol;
//         const price = item.lastPrice;
//         if (!symbol || price === undefined || price === null) continue;
//         if (lastPrices[symbol] !== price) {
//           lastPrices[symbol] = price;
//           updated.push({ symbol, price });
//         }
//       }
//       if (updated.length > 0) {
//         callback({ exchange: 'Bybit', data: updated });
//       }
//     } catch (err) {console.error('[Bybit] Failed to parse message:', err);}
//   });

//   ws.on('error', (err) => console.error('[Bybit] Error:', err.message))
//   ws.on('close', () => console.warn('[Bybit] Connection closed'))
// }
// function stopBybitWS() {
//   if (currentBybitWS && currentBybitWS.readyState === WebSocket.OPEN) {
//     currentBybitWS.close(1000, 'Manual stop');
//     console.log('[Bybit] Price stream stopped manually');
//   }
//   currentBybitWS = null;
// }
// function getBybitConnectionStrength() {
//   if (!bybitLatency) return 0;
//   const percent = Math.max(0, Math.min(100, Math.round((2000 - bybitLatency) / 2000 * 100)));
//   return percent;
// }

// let currentBybitOrderbookWS = null;
// let reconnectBybitTimer = null;
// let currentBybitSymbol = null;
// let currentBybitOnUpdate = null;
// let reconnectBybitDelay = 5000;

// // Simpan orderbook penuh
// let bidsMap = new Map();
// let asksMap = new Map();

// function sortDesc(a, b) {
//   return b[0] - a[0]; // untuk bids (harga tinggi ke rendah)
// }

// function sortAsc(a, b) {
//   return a[0] - b[0]; // untuk asks (harga rendah ke tinggi)
// }

// function applyUpdates(map, updates) {
//   for (const [priceStr, qtyStr] of updates) {
//     const price = parseFloat(priceStr);
//     const qty = parseFloat(qtyStr);
//     if (qty === 0) {
//       map.delete(price);
//     } else {
//       map.set(price, qty);
//     }
//   }
// }

// function connectBybitOrderbook(symbol, onUpdate) {
//   if (currentBybitOrderbookWS) {
//     try { currentBybitOrderbookWS.close(); } catch (e) {}
//     currentBybitOrderbookWS = null;
//   }

//   currentBybitSymbol = symbol + "USDT";
//   currentBybitOnUpdate = onUpdate;

//   bidsMap.clear();
//   asksMap.clear();

//   const ws = new WebSocket('wss://stream.bybit.com/v5/public/spot');
//   currentBybitOrderbookWS = ws;

//   console.log(`[Bybit] Connecting orderbook for ${currentBybitSymbol}...`);

//   ws.on('open', () => {
//     console.log(`[Bybit] Connected orderbook for ${currentBybitSymbol}`);
//     reconnectBybitDelay = 5000; // reset delay
//     ws.send(JSON.stringify({
//       op: 'subscribe',
//       args: [`orderbook.50.${currentBybitSymbol.toUpperCase()}`]
//     }));
//   });

//   ws.on('message', (raw) => {
//     try {
//       const msg = JSON.parse(raw);
//       if (!msg.data) return;

//       // Snapshot awal
//       if (msg.type === 'snapshot') {
//         bidsMap.clear();
//         asksMap.clear();
//         applyUpdates(bidsMap, msg.data.b || []);
//         applyUpdates(asksMap, msg.data.a || []);
//       }

//       // Update delta
//       if (msg.type === 'delta') {
//         applyUpdates(bidsMap, msg.data.b || []);
//         applyUpdates(asksMap, msg.data.a || []);
//       }

//       // Ambil 10 teratas
//       const bids = Array.from(bidsMap.entries())
//         .sort(sortDesc)
//         .slice(0, 10)
//         .map(([price, qty]) => ({ price, qty, type: 'bid' }));

//       const asks = Array.from(asksMap.entries())
//         .sort(sortAsc)
//         .slice(0, 10)
//         .map(([price, qty]) => ({ price, qty, type: 'ask' }));

//       if (typeof onUpdate === 'function') {
//         onUpdate([...bids, ...asks]);
//       }

//     } catch (err) {
//       console.error('[Bybit] Orderbook parse error:', err.message);
//     }
//   });

//   ws.on('error', (err) => {
//     console.error('[Bybit] Orderbook WS error:', err.message);
//   });

//   ws.on('close', () => {
//     console.warn(`[Bybit] Orderbook WS closed for ${currentBybitSymbol}`);
//     if (symbol === currentBybitSymbol) {
//       scheduleBybitReconnect();
//     }
//   });
// }

// function scheduleBybitReconnect() {
//   if (reconnectBybitTimer) return; // biar ga double
//   console.log(`[Bybit] Reconnecting orderbook in ${reconnectBybitDelay / 1000}s...`);
//   reconnectBybitTimer = setTimeout(() => {
//     reconnectBybitTimer = null;
//     connectBybitOrderbook(currentBybitSymbol.replace("USDT",""), currentBybitOnUpdate);
//     reconnectBybitDelay = Math.min(reconnectBybitDelay * 2, 60000); // exponential backoff max 60s
//   }, reconnectBybitDelay);
// }

// function getBybitOrderbook(symbol, onUpdate) {
//   connectBybitOrderbook(symbol, onUpdate);
// }

// function closeBybitOrderbookWS() {
//   if (reconnectBybitTimer) {
//     clearTimeout(reconnectBybitTimer);
//     reconnectBybitTimer = null;
//   }
//   if (currentBybitOrderbookWS && currentBybitOrderbookWS.readyState === WebSocket.OPEN) {
//     currentBybitOrderbookWS.close(1000, 'Manual close');
//   }
//   currentBybitOrderbookWS = null;
//   currentBybitSymbol = null;
//   currentBybitOnUpdate = null;
//   bidsMap.clear();
//   asksMap.clear();
//   console.log('[Bybit] Orderbook connection closed manually');
// }

// let lastOrderbook = {};

// async function multipleBybitOrderbook(targetSymbols, callback) {
//   const socketUrl = 'wss://stream.bybit.com/v5/public/spot';

//   // --- Ambil daftar simbol aktif dari Bybit ---
//   const activeSymbols = await getActiveBybitSymbols(); // harus return Set atau Array
//   const filtered = targetSymbols
//     .filter(s => activeSymbols.has(s.toUpperCase()))
//     .map(s => `orderbook.1.${s.toUpperCase()}`);

//   console.log(`[Bybit] Total simbol aktif yang disubscribe: ${filtered.length}`);

//   // --- Tutup koneksi lama biar nggak dobel ---
//   if (currentBybitWS) {
//     try { currentBybitWS.close(); } catch (e) {}
//   }

//   const ws = new WebSocket(socketUrl);
//   currentBybitWS = ws;

//   ws.on('open', () => {
//     console.log('[Bybit] WebSocket connected');
//     // Subscribe dalam batch (max 10 per request)
//     const chunkSize = 10;
//     for (let i = 0; i < filtered.length; i += chunkSize) {
//       const chunk = filtered.slice(i, i + chunkSize);
//       const subMsg = { op: 'subscribe', args: chunk };
//       ws.send(JSON.stringify(subMsg));
//     }
//   });

//   let subscribedSymbols = new Set();

//   ws.on("message", (msg) => {
//     try {
//       const parsed = JSON.parse(msg);

//       // --- Pesan konfirmasi subscribe ---
//       if (parsed.success !== undefined) {
//         if (!parsed.success) {
//           console.warn(`[Bybit] Skip invalid symbol: ${parsed.ret_msg}`);
//         } else {
//           console.log(`[Bybit] Subscribed OK: ${parsed.req_id || ""}`);
//         }
//         return;
//       }

//       if (!parsed.topic || !parsed.data) return;

//       const data = parsed.data;
//       const symbol = data.s; // contoh: BTCUSDT
//       if (!symbol || !data.b || !data.a) return;

//       // Tandai simbol valid
//       if (!subscribedSymbols.has(symbol)) {
//         subscribedSymbols.add(symbol);
//       }

//       // Ambil best bid/ask
//       const bestBid = data.b.length > 0 ? parseFloat(data.b[0][0]) : null;
//       const bestAsk = data.a.length > 0 ? parseFloat(data.a[0][0]) : null;
//       if (!bestBid || !bestAsk) return;

//       const key = symbol;
//       const snapshot = { bid: bestBid, ask: bestAsk };

//       // Hanya kirim callback jika ada update harga
//       if (
//         !lastOrderbook[key] ||
//         lastOrderbook[key].bid !== bestBid ||
//         lastOrderbook[key].ask !== bestAsk
//       ) {
//         lastOrderbook[key] = snapshot;
//         callback({
//           exchange: "Bybit",
//           data: [{ symbol, bid: bestBid, ask: bestAsk }],
//         });
//       }
//     } catch (err) {
//       console.error("[Bybit] Failed to parse message:", err);
//     }
//   });

//   ws.on('error', (err) => {
//     console.error('[Bybit] Error:', err.message);
//   });

//   ws.on('close', () => {
//     console.warn('[Bybit] Connection closed');
//   });
// }