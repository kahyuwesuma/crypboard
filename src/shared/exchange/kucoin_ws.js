const WebSocket = require('ws');
const axios = require('axios');
const https = require('https');

const lastPrices = {};
let currentKucoinOrderbookWS = null; // koneksi orderbook aktif

async function getKucoinWSInfo() {
  try {
    const response = await axios.post("https://api.kucoin.com/api/v1/bullet-public", null, {
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    });
    const data = response.data.data;
    return {
      token: data.token,
      endpoint: data.instanceServers[0].endpoint,
    };
  } catch (err) {
    console.error("[KuCoin] Failed to fetch WS info:", err);
    return null;
  }
}

function startKucoinWS(targetSymbols, callback) {
  getKucoinWSInfo().then((info) => {
    if (!info) return;

    const { token, endpoint } = info;
    const wsUrl = `${endpoint}?token=${token}`;

    function startConnection() {
      const ws = new WebSocket(wsUrl);

      ws.on('open', () => {
        targetSymbols.forEach((symbol) => {
          let base = symbol.slice(0, -4);
          let quote = symbol.slice(-4);
          const symbolWithDash = `${base}-${quote}`.toUpperCase();

          const subMsg = {
            id: Date.now(),
            type: "subscribe",
            topic: `/market/ticker:${symbolWithDash}`,
            privateChannel: false,
            response: true,
          };

          ws.send(JSON.stringify(subMsg));
          console.log(`[KuCoin] Subscribed to ${symbolWithDash}`);
        });
      });

      ws.on('message', (msg) => {
        try {
          const data = JSON.parse(msg);

          if (data.type === 'message' && data.data) {
            const topic = data.topic || "";
            const ticker = data.data;
            const price = parseFloat(ticker.price || 0);
            if (!topic.startsWith("/market/ticker:") || !price) return;

            const rawSymbol = topic.split(":")[1].toUpperCase();
            const symbol = rawSymbol.replace("-", "");

            if (lastPrices[symbol] !== price) {
              lastPrices[symbol] = price;
              callback({
                exchange: "kucoin",
                data: [{ symbol, price }]
              });
            }

          } else if (data.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
          }

        } catch (err) {
          console.error("[KuCoin] Error parsing message:", err);
        }
      });

      ws.on('error', (err) => {
        console.error("[KuCoin] WebSocket error:", err);
      });

      ws.on('close', (code, reason) => {
        console.warn(`[KuCoin] Disconnected (${code}): ${reason}`);
        console.log("[KuCoin] Reconnecting in 5s...");
        setTimeout(startConnection, 5000); // reconnect
      });
    }

    startConnection();
  });
}

/**
 * Ambil orderbook KuCoin (top 10 bids & asks)
 * @param {string} symbol - contoh: "BTC"
 * @param {function} callback - menerima array {price, qty, type}
 */
function getKucoinOrderbook(symbol, callback) {
  if (currentKucoinOrderbookWS) {
    currentKucoinOrderbookWS.close();
    currentKucoinOrderbookWS = null;
  }

  getKucoinWSInfo().then(async (info) => {
    if (!info) return;

    const { token, endpoint } = info;
    const wsUrl = `${endpoint}?token=${token}`;
    const symbolWithDash = `${symbol}-USDT`.toUpperCase();

    // Step 1: Ambil snapshot awal
    let orderbook = { bids: [], asks: [] };
    try {
      const snap = await axios.get(`https://api.kucoin.com/api/v1/market/orderbook/level2_100?symbol=${symbolWithDash}`);
      orderbook.bids = snap.data.data.bids.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
      orderbook.asks = snap.data.data.asks.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
    } catch (err) {
      console.error("[KuCoin] Gagal ambil snapshot orderbook:", err);
      callback([]);
      return;
    }

    // Step 2: Koneksi WS
    const ws = new WebSocket(wsUrl);
    currentKucoinOrderbookWS = ws;

    ws.on("open", () => {
      const subMsg = {
        id: Date.now(),
        type: "subscribe",
        topic: `/market/level2:${symbolWithDash}`,
        privateChannel: false,
        response: true,
      };
      ws.send(JSON.stringify(subMsg));
      console.log(`[KuCoin] Subscribed orderbook for ${symbolWithDash}`);
    });

    ws.on("message", (msg) => {
      try {
        const data = JSON.parse(msg);

        if (data.type === "message" && data.topic.startsWith("/market/level2:")) {
          if (data.subject === "trade.l2update") {
            const { changes } = data.data || {};
            if (!changes) return;

            // Step 3: Update bids
            if (Array.isArray(changes.bids)) {
              changes.bids.forEach(([price, qty]) => {
                const p = parseFloat(price);
                const q = parseFloat(qty);
                const idx = orderbook.bids.findIndex(([bp]) => bp === p);
                if (q === 0) {
                  if (idx >= 0) orderbook.bids.splice(idx, 1);
                } else {
                  if (idx >= 0) orderbook.bids[idx][1] = q;
                  else orderbook.bids.push([p, q]);
                }
              });
              orderbook.bids.sort((a, b) => b[0] - a[0]);
            }

            // Step 4: Update asks
            if (Array.isArray(changes.asks)) {
              changes.asks.forEach(([price, qty]) => {
                const p = parseFloat(price);
                const q = parseFloat(qty);
                const idx = orderbook.asks.findIndex(([ap]) => ap === p);
                if (q === 0) {
                  if (idx >= 0) orderbook.asks.splice(idx, 1);
                } else {
                  if (idx >= 0) orderbook.asks[idx][1] = q;
                  else orderbook.asks.push([p, q]);
                }
              });
              orderbook.asks.sort((a, b) => a[0] - b[0]);
            }

            // Step 5: Kirim top 10
            const bidOrders = orderbook.bids.slice(0, 10).map(([price, qty]) => ({
              price,
              qty,
              type: "bid",
            }));
            const askOrders = orderbook.asks.slice(0, 10).map(([price, qty]) => ({
              price,
              qty,
              type: "ask",
            }));

            callback([...bidOrders, ...askOrders]);
          }
        } else if (data.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch (err) {
        console.error("[KuCoin] Orderbook parse error:", err);
      }
    });

    ws.on("error", (err) => {
      console.error("[KuCoin] Orderbook WS error:", err);
      callback([]);
    });

    ws.on("close", () => {
      console.warn("[KuCoin] Orderbook WS closed");
    });
  });
}


/**
 * Menutup koneksi orderbook KuCoin
 */
function closeKucoinOrderbookWS() {
  if (currentKucoinOrderbookWS) {
    currentKucoinOrderbookWS.close();
    currentKucoinOrderbookWS = null;
  }
}

module.exports = {
  startKucoinWS,
  getKucoinOrderbook,
  closeKucoinOrderbookWS
};
