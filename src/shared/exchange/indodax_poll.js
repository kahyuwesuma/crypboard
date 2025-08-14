const axios = require('axios');

function startIndodaxPolling(symbols, callback) {
  const mapSymbolToIndodax = (sym) => sym.toLowerCase().replace("usdt", "") + "_idr";

  const poll = async () => {
    try {
      const kursRes = await axios.get("https://indodax.com/api/ticker/usdtidr");
      const allRes = await axios.get("https://indodax.com/api/ticker_all");

      const usdtIdr = parseFloat(kursRes.data.ticker.last);
      // console.log(usdtIdr)
      const tickers = allRes.data.tickers;

      const updates = [];
      // Pastikan BTC/IDR selalu dikirim
      if (tickers["btc_idr"]) {
        const btcIdr = parseFloat(tickers["btc_idr"].last);
        // console.log(btcIdr)
        updates.push({ type: "header", symbol: "BTCUSDT", price: btcIdr }); // kirim sebagai BTCUSDT agar konsisten
      }

      // Pastikan USDT/IDR selalu dikirim sebagai reference
      updates.push({ symbol: "USDTIDR", price: usdtIdr });
      for (const sym of symbols) {
        const iddx = mapSymbolToIndodax(sym);
        if (tickers[iddx]) {
          const idrPrice = parseFloat(tickers[iddx].last);
          const usdtPrice = idrPrice / usdtIdr;
          updates.push({ symbol: sym, price: idrPrice });
        }
      }

      callback(updates, usdtIdr);
    } catch (err) {
      console.error("[Indodax Poll] Error:", err.message);
    }

    setTimeout(() => poll(), 500);
  };

  poll();
}

// Polling orderbook setiap 3 detik
function startIndodaxOrderbookPolling(symbol, callback) {
  const pair = symbol.toLowerCase().replace("usdt", "") + "idr";
  let timeoutId = null;
  const pollOrderbook = async () => {
    try {
      const res = await axios.get(`https://indodax.com/api/depth/${pair}`);
      // console.log(res);
      const bids = (res.data.buy || [])
        .slice(0, 10)
        .map(([price, qty]) => ({
          price: parseFloat(price),
          qty: parseFloat(qty),
          type: 'bid'
        }));
      // console.log("IDX",bids);

      const asks = (res.data.sell || [])
        .slice(0, 10)
        .map(([price, qty]) => ({
          price: parseFloat(price),
          qty: parseFloat(qty),
          type: 'ask'
        }));

      const orders = [...bids, ...asks];
      callback(orders);
    } catch (err) {
      console.error("[Indodax Orderbook Error]", err.message);
      callback([]);
    }

    timeoutId = setTimeout(pollOrderbook, 500);
  };

  pollOrderbook();
    // Kembalikan fungsi stop yang bisa dipanggil dari luar untuk clearTimeout
  return () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  };
}
module.exports = { startIndodaxPolling, startIndodaxOrderbookPolling };
