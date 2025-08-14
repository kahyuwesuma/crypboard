const WebSocket = require('ws');
const https = require('https');

/**
 * Ambil simbol Spot aktif dari Bybit (status = Trading)
 * @returns {Promise<Set<string>>}
 */
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

let lastPrices = {};
let currentBybitWS = null;
/**
 * Start WebSocket ke Bybit untuk banyak simbol spot
 * @param {string[]} targetSymbols - Daftar simbol yang ingin disubscribe (misal: ['BTCUSDT', 'ETHUSDT'])
 * @param {function} callback - Fungsi callback dengan data { exchange: "Bybit", data: [{symbol, price}] }
 */
async function startBybitWS(targetSymbols, callback) {
  const socketUrl = 'wss://stream.bybit.com/v5/public/spot';
  const activeSymbols = await getActiveBybitSymbols();

  const filtered = targetSymbols
    .filter(s => activeSymbols.has(s.toUpperCase()))
    .map(s => `tickers.${s.toUpperCase()}`);

  console.log(`[Bybit] Total simbol aktif yang disubscribe: ${filtered.length}`);

  const ws = new WebSocket(socketUrl);
  currentBybitWS = ws; // simpan untuk stop nanti

  ws.on('open', () => {
    const chunkSize = 10;
    for (let i = 0; i < filtered.length; i += chunkSize) {
      const chunk = filtered.slice(i, i + chunkSize);
      const subMsg = {
        op: 'subscribe',
        args: chunk
      };
      ws.send(JSON.stringify(subMsg));
    }
  });

  ws.on('message', (msg) => {
    try {
      const parsed = JSON.parse(msg);
      if (!parsed.data) return;

      const items = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
      const updated = [];

      for (const item of items) {
        const symbol = item.symbol;
        const price = item.lastPrice;

        if (!symbol || price === undefined || price === null) continue;

        if (lastPrices[symbol] !== price) {
          lastPrices[symbol] = price;
          updated.push({ symbol, price });
        }
      }

      if (updated.length > 0) {
        callback({ exchange: 'Bybit', data: updated });
      }
    } catch (err) {
      console.error('[Bybit] Failed to parse message:', err);
    }
  });

  ws.on('error', (err) => {
    console.error('[Bybit] Error:', err.message);
  });

  ws.on('close', () => {
    console.warn('[Bybit] Connection closed');
  });
}

function stopBybitWS() {
  if (currentBybitWS && currentBybitWS.readyState === WebSocket.OPEN) {
    currentBybitWS.close(1000, 'Manual stop');
    console.log('[Bybit] Price stream stopped manually');
  }
  currentBybitWS = null;
}

let currentBybitOrderbookWS = null;
let reconnectBybitTimer = null;
let currentBybitSymbol = null;
let currentBybitOnUpdate = null;
let reconnectBybitDelay = 5000; // 5 detik

// Simpan orderbook penuh
let bidsMap = new Map();
let asksMap = new Map();

function sortDesc(a, b) {
  return b[0] - a[0]; // untuk bids (harga tinggi ke rendah)
}

function sortAsc(a, b) {
  return a[0] - b[0]; // untuk asks (harga rendah ke tinggi)
}

function applyUpdates(map, updates) {
  for (const [priceStr, qtyStr] of updates) {
    const price = parseFloat(priceStr);
    const qty = parseFloat(qtyStr);
    if (qty === 0) {
      map.delete(price);
    } else {
      map.set(price, qty);
    }
  }
}

function connectBybitOrderbook(symbol, onUpdate) {
  if (currentBybitOrderbookWS) {
    try { currentBybitOrderbookWS.close(); } catch (e) {}
    currentBybitOrderbookWS = null;
  }

  currentBybitSymbol = symbol + "USDT";
  currentBybitOnUpdate = onUpdate;

  bidsMap.clear();
  asksMap.clear();

  const ws = new WebSocket('wss://stream.bybit.com/v5/public/spot');
  currentBybitOrderbookWS = ws;

  console.log(`[Bybit] Connecting orderbook for ${currentBybitSymbol}...`);

  ws.on('open', () => {
    console.log(`[Bybit] Connected orderbook for ${currentBybitSymbol}`);
    reconnectBybitDelay = 5000; // reset delay
    ws.send(JSON.stringify({
      op: 'subscribe',
      args: [`orderbook.50.${currentBybitSymbol.toUpperCase()}`]
    }));
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (!msg.data) return;

      // Snapshot awal
      if (msg.type === 'snapshot') {
        bidsMap.clear();
        asksMap.clear();
        applyUpdates(bidsMap, msg.data.b || []);
        applyUpdates(asksMap, msg.data.a || []);
      }

      // Update delta
      if (msg.type === 'delta') {
        applyUpdates(bidsMap, msg.data.b || []);
        applyUpdates(asksMap, msg.data.a || []);
      }

      // Ambil 10 teratas
      const bids = Array.from(bidsMap.entries())
        .sort(sortDesc)
        .slice(0, 10)
        .map(([price, qty]) => ({ price, qty, type: 'bid' }));

      const asks = Array.from(asksMap.entries())
        .sort(sortAsc)
        .slice(0, 10)
        .map(([price, qty]) => ({ price, qty, type: 'ask' }));

      if (typeof onUpdate === 'function') {
        onUpdate([...bids, ...asks]);
      }

    } catch (err) {
      console.error('[Bybit] Orderbook parse error:', err.message);
    }
  });

  ws.on('error', (err) => {
    console.error('[Bybit] Orderbook WS error:', err.message);
  });

  ws.on('close', () => {
    console.warn(`[Bybit] Orderbook WS closed for ${currentBybitSymbol}`);
    if (symbol === currentBybitSymbol) {
      scheduleBybitReconnect();
    }
  });
}

function scheduleBybitReconnect() {
  if (reconnectBybitTimer) return; // biar ga double
  console.log(`[Bybit] Reconnecting orderbook in ${reconnectBybitDelay / 1000}s...`);
  reconnectBybitTimer = setTimeout(() => {
    reconnectBybitTimer = null;
    connectBybitOrderbook(currentBybitSymbol.replace("USDT",""), currentBybitOnUpdate);
    reconnectBybitDelay = Math.min(reconnectBybitDelay * 2, 60000); // exponential backoff max 60s
  }, reconnectBybitDelay);
}

function getBybitOrderbook(symbol, onUpdate) {
  connectBybitOrderbook(symbol, onUpdate);
}

function closeBybitOrderbookWS() {
  if (reconnectBybitTimer) {
    clearTimeout(reconnectBybitTimer);
    reconnectBybitTimer = null;
  }
  if (currentBybitOrderbookWS && currentBybitOrderbookWS.readyState === WebSocket.OPEN) {
    currentBybitOrderbookWS.close(1000, 'Manual close');
  }
  currentBybitOrderbookWS = null;
  currentBybitSymbol = null;
  currentBybitOnUpdate = null;
  bidsMap.clear();
  asksMap.clear();
  console.log('[Bybit] Orderbook connection closed manually');
}

module.exports = { startBybitWS, stopBybitWS, getBybitOrderbook, closeBybitOrderbookWS };
