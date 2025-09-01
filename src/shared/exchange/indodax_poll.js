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

    setTimeout(() => poll(), 1000);
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

    timeoutId = setTimeout(pollOrderbook, 1000);
  };

  pollOrderbook();
    // Kembalikan fungsi stop yang bisa dipanggil dari luar untuk clearTimeout
  return () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  };
}
function startIndodaxL2Orderbook(symbols, callback) {
  const mapSymbolToIndodax = (sym) => sym.toLowerCase().replace("usdt", "") + "_idr";

  const poll = async () => {
    try {
      const kursRes = await axios.get("https://indodax.com/api/ticker/usdtidr");
      const btcRes = await axios.get("https://indodax.com/api/ticker/btcidr")
      const allRes = await axios.get("https://indodax.com/api/ticker_all");

      const btcIdr = parseFloat(btcRes.data.ticker.last)
      callback({ type: "header", symbol: "BTCUSDT", price: btcIdr });

      const usdtIdr = parseFloat(kursRes.data.ticker.last);
      // console.log(usdtIdr)
      const tickers = allRes.data.tickers;
      // console.log(tickers)
      const updates = [];

      for (const sym of symbols) {
        const iddx = mapSymbolToIndodax(sym);
        // console.log(iddx)
        if (tickers[iddx]) {
          // const idrPrice = parseFloat(tickers[iddx].last);
          const bestBid = parseFloat(tickers[iddx].buy);  // best bid dari tickers
          const bestAsk = parseFloat(tickers[iddx].sell); // best ask dari tickers
          // const usdtPrice = idrPrice / usdtIdr;
          updates.push({ symbol: sym, bid: bestBid, ask: bestAsk });
        }
      }
      // console.log(updates)
      callback(updates, usdtIdr);
    } catch (err) {
      console.error("[Indodax L2 Orderbook Poll] Error:", err.message);
    }

    setTimeout(() => poll(), 1000);
  };

  poll();
}
// async function startIndodaxL2Orderbook(targetSymbols, callback) {
//   // mapping Indodax symbol ke format BTCUSDT, ETHUSDT, dll
//   const symbolMap = targetSymbols.reduce((acc, sym) => {
//     acc[sym.toLowerCase()] = sym.toUpperCase();
//     return acc;
//   }, {});
// updates.push({ symbol: "USDTIDR", price: usdtIdr });
//   const poll = async () => {
//     try {
//       // sekali fetch semua ticker
//       const res = await fetch(`https://indodax.com/api/tickers`);
//       const data = await res.json();

//       if (!data.tickers) {
//         console.warn("No tickers data from Indodax");
//         return;
//       }

//       // filter sesuai targetSymbols
//       const results = targetSymbols.map(symbol => {
//         const pair = symbol.toLowerCase().replace("usdt", "") + "_idr"; // format di tickers pakai _
//         const ticker = data.tickers[pair];

//         if (!ticker) return null;

//         const bestBid = parseFloat(ticker.buy);  // best bid dari tickers
//         const bestAsk = parseFloat(ticker.sell); // best ask dari tickers

//         return {
//           symbol: symbolMap[symbol.toLowerCase()],
//           bid: bestBid,
//           ask: bestAsk
//         };
//       }).filter(Boolean);
//       // console.log(results)
//       callback(results);
//     } catch (err) {
//       console.error("Error fetching tickers from Indodax:", err.message);
//     }
//   };

//   // jalanin langsung sekali supaya ga nunggu interval pertama
//   poll();
//   // ulangi polling
//   return setInterval(poll, 1000);
// }



module.exports = { startIndodaxPolling, startIndodaxOrderbookPolling, startIndodaxL2Orderbook };
