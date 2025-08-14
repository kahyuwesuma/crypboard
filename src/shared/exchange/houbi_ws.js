const WebSocket = require('ws');
const pako = require('pako');

const HUOBI_ENDPOINTS = [
  'wss://api.huobi.pro/ws',
  'wss://api.huobi.vn/ws',
  'wss://api.huobi.so/ws',
  'wss://api-aws.huobi.pro/ws',
  'wss://api.hbdm.com/ws'
];

const BATCH_SIZE = 25;
const MAX_RETRIES = 5;
const PING_INTERVAL = 30 * 1000;

let lastPrices = {};
let confirmedSymbols = new Set();
let currentHuobiOrderbookWS = null; // simpan WS orderbook aktif

let huobiWSConnections = []; // simpan semua koneksi WS ticker
let huobiShouldReconnect = true;
function startHuobiWS(symbols, callback){
  huobiShouldReconnect = true;
  const batches = splitToBatches(symbols, BATCH_SIZE);
  batches.forEach((batch, idx) => {
    connectToHuobi(batch, `batch_${idx}`, callback);
  });
}

function connectToHuobi(symbols, batchId, callback , uriIndex = 0, attempt = 0) {
  const uri = HUOBI_ENDPOINTS[uriIndex % HUOBI_ENDPOINTS.length];
  const ws = new WebSocket(uri);
  ws.binaryType = 'arraybuffer';
  huobiWSConnections.push(ws);

  ws.on('open', () => {
    console.log(`[Huobi] ✅ Connected: ${batchId} (${symbols.length} symbols)`);
    symbols.forEach((symbol) => {
      const msg = {
        sub: `market.${symbol.toLowerCase()}.ticker`,
        id: `sub_${symbol}_${Date.now()}`
      };
      ws.send(JSON.stringify(msg));
    });
  });

  ws.on('message', async (data) => {
    try {
      const text = decompressMessage(data);
      const json = JSON.parse(text);

      if (json.ping) {
        ws.send(JSON.stringify({ pong: json.ping }));
        return;
      }

      if (json.tick && json.ch) {
        const symbol = json.ch.split('.')[1].toUpperCase();
        const price = json.tick.close;

        if (!confirmedSymbols.has(symbol)) {
          confirmedSymbols.add(symbol);
          console.log(`[Huobi] Receiving data for ${symbol}`);
        }

        if (lastPrices[symbol] !== price) {
          lastPrices[symbol] = price;
          callback([{ symbol, price }]);
        }
      }
    } catch (err) {
      console.error(`[Huobi] ❌ Error parsing message in ${batchId}:`, err.message);
    }
  });

  ws.on('error', (err) => {
    console.error(`[Huobi] ❌ WebSocket error (${batchId}):`, err.message);
  });

  ws.on('close', () => {
    console.warn(`[Huobi] ⚠️ Connection closed: ${batchId}`);
    if (huobiShouldReconnect && attempt < MAX_RETRIES) {
      const nextUriIndex = (uriIndex + 1) % HUOBI_ENDPOINTS.length;
      setTimeout(() => {
        connectToHuobi(symbols, batchId, callback, nextUriIndex, attempt + 1);
      }, getBackoffDelay(attempt));
    } else if (!huobiShouldReconnect) {
      console.log(`[Huobi] 🔌 Manual stop for ${batchId}, not reconnecting.`);
    } else {
      console.error(`[Huobi] ❌ Max retry limit reached for ${batchId}`);
    }
  });

  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ ping: Date.now() }));
    }
  }, PING_INTERVAL);
}
function stopHuobiWS() {
  huobiShouldReconnect = false;
  huobiWSConnections.forEach((ws) => {
    try {
      ws.close();
    } catch (e) {
      console.error("[Huobi] Error closing WS:", e);
    }
  });
  huobiWSConnections = [];
  console.log("[Huobi] 🔌 All ticker WS connections closed.");
}
function decompressMessage(data) {
  const buffer = Buffer.from(data);
  return pako.ungzip(buffer, { to: 'string' });
}

function splitToBatches(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

function getBackoffDelay(attempt) {
  return Math.min(1000 * 2 ** attempt, 30000);
}

// Fungsi untuk orderbook (depth)
function getHuobiOrderbook(symbol, callback) {
  // Tutup koneksi lama kalau ada
  if (currentHuobiOrderbookWS) {
    currentHuobiOrderbookWS.close();
    currentHuobiOrderbookWS = null;
  }
  const lowerSymbol = (symbol + "USDT").toLowerCase();
  const uri = HUOBI_ENDPOINTS[0];
  const ws = new WebSocket(uri);
  ws.binaryType = 'arraybuffer';
  currentHuobiOrderbookWS = ws;

  ws.on('open', () => {
    console.log(`[Huobi] Subscribing orderbook for ${lowerSymbol}`);
    ws.send(JSON.stringify({
      sub: `market.${lowerSymbol}.depth.step0`,
      id: `depth_${lowerSymbol}_${Date.now()}`
    }));
  });

  ws.on('message', (data) => {
    try {
      const text = decompressMessage(data);
      const json = JSON.parse(text);
      console.log(json);

      if (json.ping) {
        ws.send(JSON.stringify({ pong: json.ping }));
        return;
      }

      if (json.tick && json.tick.bids && json.tick.asks) {
      const bids = json.tick.bids
        .slice(0, 10) // ambil 10 level teratas
        .map(([price, qty]) => ({
          price: parseFloat(price),
          qty: parseFloat(qty),
          type: 'bid'
        }));

      console.log("huobi bids", bids);

      const asks = json.tick.asks
        .slice(0, 10) // ambil 10 level teratas
        .map(([price, qty]) => ({
          price: parseFloat(price),
          qty: parseFloat(qty),
          type: 'ask'
        }));

        callback([...bids, ...asks]);
      }
    } catch (err) {
      console.error('[Huobi Orderbook WS Error]', err);
      callback([]);
    }
  });

  ws.on('error', (err) => {
    console.error('[Huobi Orderbook WS Error]', err);
    callback([]);
  });
}

function closeHuobiOrderbookWS() {
  if (currentHuobiOrderbookWS) {
    currentHuobiOrderbookWS.close();
    currentHuobiOrderbookWS = null;
  }
}

function startHuobiWSClient(symbols, callback) {
  startHuobiWS(symbols, (data) => {
    callback({
      exchange: 'Huobi',
      data
    });
  });
}

module.exports = { 
  startHuobiWS: startHuobiWSClient,
  getHuobiOrderbook,
  stopHuobiWS,
  closeHuobiOrderbookWS
};