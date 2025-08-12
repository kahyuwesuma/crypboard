const WebSocket = require('ws');
const axios = require('axios');

// Simpan harga terakhir untuk deteksi perubahan
const lastPrices = {};

// Simpan koneksi orderbook aktif
let currentGateioOrderbookWS = null;

// Ambil pasangan mata uang yang valid dari Gate.io
async function fetchValidPairs(quote = "USDT") {
  try {
    const response = await axios.get("https://api.gateio.ws/api/v4/spot/currency_pairs");
    const data = response.data;

    return new Set(
      data
        .filter(item => item.quote === quote && item.trade_status === "tradable")
        .map(item => item.id.toUpperCase().replace("_", ""))
    );
  } catch (err) {
    console.error("[Gate.io] Failed to fetch valid pairs:", err);
    return new Set();
  }
}

function startGateioWS(targetSymbols, callback) {
  const BATCH_SIZE = 20;

  fetchValidPairs().then((validSymbols) => {
    const filteredSymbols = targetSymbols.filter(s => validSymbols.has(s));
    if (filteredSymbols.length === 0) {
      console.warn("[Gate.io] No valid symbols to subscribe.");
      return;
    }

    // Bagi menjadi beberapa batch
    for (let i = 0; i < filteredSymbols.length; i += BATCH_SIZE) {
      const batch = filteredSymbols.slice(i, i + BATCH_SIZE);
      startBatch(batch, callback);
    }
  });
}

function startBatch(pairsBatch, callback) {
  const ws = new WebSocket("wss://api.gateio.ws/ws/v4/");

  ws.on('open', () => {
    const payloadPairs = pairsBatch.map(s => s.replace("USDT", "_USDT"));
    const subMsg = {
      time: 0,
      channel: "spot.tickers",
      event: "subscribe",
      payload: payloadPairs,
    };
    ws.send(JSON.stringify(subMsg));
    console.log(`[Gate.io] Subscribed to: ${payloadPairs.join(', ')}`);
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.event !== 'update' || typeof data.result !== 'object') return;

      const result = data.result;
      const rawSymbol = result.currency_pair;
      const price = result.last;

      if (!rawSymbol || !price) return;

      const symbol = rawSymbol.replace("_", "");

      if (lastPrices[symbol] !== price) {
        lastPrices[symbol] = price;
        callback({
          exchange: "gateio",
          data: [{ symbol, price }],
        });
      }
    } catch (err) {
      console.error("[Gate.io] Error parsing message:", err);
    }
  });

  ws.on('error', (err) => {
    console.error("[Gate.io] WebSocket error:", err);
  });

  ws.on('close', () => {
    console.warn("[Gate.io] WebSocket closed");
  });
}

/**
 * Stream orderbook Gate.io untuk 10 level (bids & asks)
 * @param {string} symbol - Contoh: "BTC"
 * @param {function} callback - Terima array order {price, qty, type}
 */
function getGateioOrderbook(symbol, callback) {
  // Tutup koneksi sebelumnya jika ada
  if (currentGateioOrderbookWS) {
    currentGateioOrderbookWS.close();
    currentGateioOrderbookWS = null;
  }

  const pair = `${symbol}_USDT`;
  const ws = new WebSocket("wss://api.gateio.ws/ws/v4/");
  currentGateioOrderbookWS = ws;

  ws.on("open", () => {
    const subMsg = {
      time: 0,
      channel: "spot.order_book_update",
      event: "subscribe",
      payload: [pair, "10", "100ms"], // 10 level, update setiap 100ms
    };
    ws.send(JSON.stringify(subMsg));
    console.log(`[Gate.io] Subscribed orderbook for ${pair}`);
  });

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);
      if (data.event !== "update" || !data.result) return;

      const { bids = [], asks = [] } = data.result;
      const bidOrders = bids.slice(0, 10).map(([price, qty]) => ({
        price: parseFloat(price),
        qty: parseFloat(qty),
        type: "bid",
      }));

      const askOrders = asks.slice(0, 10).map(([price, qty]) => ({
        price: parseFloat(price),
        qty: parseFloat(qty),
        type: "ask",
      }));

      callback([...bidOrders, ...askOrders]);
    } catch (err) {
      console.error("[Gate.io] Orderbook parse error:", err);
    }
  });

  ws.on("error", (err) => {
    console.error("[Gate.io] Orderbook WS error:", err);
    callback([]);
  });

  ws.on("close", () => {
    console.warn("[Gate.io] Orderbook WS closed");
  });
}

/**
 * Menutup koneksi orderbook Gate.io
 */
function closeGateioOrderbookWS() {
  if (currentGateioOrderbookWS) {
    currentGateioOrderbookWS.close();
    currentGateioOrderbookWS = null;
  }
}

module.exports = {
  startGateioWS,
  getGateioOrderbook,
  closeGateioOrderbookWS
};
