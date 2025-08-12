const WebSocket = require('ws');

function startBinanceWS(symbols, callback) {
  const ws = new WebSocket("wss://stream.binance.com:9443/stream?streams=!ticker@arr");
  const lastPrices = {};

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw);
    const data = msg.data || [];

    const updates = [];

    for (const ticker of data) {
      const symbol = ticker.s;
      const price = ticker.c;

      if (symbols.includes(symbol)) {
        if (lastPrices[symbol] !== price) {
          lastPrices[symbol] = price;
          updates.push({ symbol, price });
        }
      }
    }

    if (updates.length) {
      callback(updates);
    }
  });

  ws.on("error", (err) => {
    console.error("[Binance WS] Error:", err.message);
  });

  ws.on("close", () => {
    console.warn("[Binance WS] Closed, reconnecting in 5s...");
    setTimeout(() => startBinanceWS(symbols, callback), 5000);
  });
}
let currentBinanceOrderbookWS = null;
function getBinanceOrderbook(symbol, callback) {
  
  // Tutup koneksi sebelumnya jika ada
  if (currentBinanceOrderbookWS) {
    currentBinanceOrderbookWS.close();
    currentBinanceOrderbookWS = null;
  }
  const lowerSymbol = (symbol + "USDT").toLowerCase();
  const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${lowerSymbol}@depth10`);
  currentBinanceOrderbookWS = ws; // simpan referensi

  ws.on('message', (raw) => {
    const data = JSON.parse(raw);
    // Format pesan sesuai kebutuhan
    const bids = (data.bids || []).map(([price, qty]) => ({
      price: parseFloat(price),
      qty: parseFloat(qty),
      type: 'bid'
    }));

    const asks = (data.asks || []).map(([price, qty]) => ({
      price: parseFloat(price),
      qty: parseFloat(qty),
      type: 'ask'
    }));

    // Gabungkan, atau pisahkan sesuai kebutuhan tampilan UI
    const orders = [...bids, ...asks];

    callback(orders);

    // ws.close(); // Ambil sekali saja
  });

  ws.on('error', (err) => {
    console.error('[Binance Orderbook WS Error]', err);
    callback([]);
  });
}

// Fungsi tambahan untuk menutup WebSocket dari luar, misal saat modal ditutup
function closeBinanceOrderbookWS() {
  if (currentBinanceOrderbookWS) {
    currentBinanceOrderbookWS.close();
    currentBinanceOrderbookWS = null;
  }
}

module.exports = { startBinanceWS, getBinanceOrderbook, closeBinanceOrderbookWS};