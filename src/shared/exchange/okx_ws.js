const WebSocket = require('ws');

function startOkxWS(targetSymbols = [], callback) {
  const wsUrl = 'wss://ws.okx.com:8443/ws/v5/public';

  const dashSymbols = [];
  const symbolMap = {}; // BTC-USDT → BTCUSDT

  // Konversi ke format OKX: BTCUSDT → BTC-USDT
  for (const sym of targetSymbols) {
    if (sym.length >= 6) {
      const base = sym.slice(0, -4);
      const quote = sym.slice(-4);
      const dash = `${base}-${quote}`;
      dashSymbols.push(dash);
      symbolMap[dash] = sym;
    } else {
      dashSymbols.push(sym);
      symbolMap[sym] = sym;
    }
  }

  const lastPrices = {};

  let ws;

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      const args = dashSymbols.map((s) => ({
        channel: 'tickers',
        instId: s,
      }));

      const subMsg = {
        op: 'subscribe',
        args,
      };

      ws.send(JSON.stringify(subMsg));
    });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data.event === 'subscribe') {
          console.log('[OKX] Subscription success:', data);
          return;
        }

        if (Array.isArray(data.data)) {
          const updates = [];

          for (const ticker of data.data) {
            const instId = ticker.instId;
            const price = ticker.last;

            if (!instId || !price) continue;

            const originalSymbol = symbolMap[instId] || instId.replace('-', '');
            if (lastPrices[originalSymbol] !== price) {
              lastPrices[originalSymbol] = price;
              updates.push({ symbol: originalSymbol, price });
            }
          }

          if (updates.length > 0) {
            callback({
              exchange: 'OKX',
              data: updates,
            });
          }
        }
      } catch (err) {
        console.error('[OKX] Message error:', err);
      }
    });

    ws.on('error', (err) => {
      console.error('[OKX] Error:', err.message);
    });

    ws.on('close', (code, reason) => {
      console.warn(`[OKX] Connection closed: ${code} - ${reason}. Reconnecting in 5s...`);
      setTimeout(connect, 5000);
    });
  }

  connect();
}

let currentOkxOrderbookWS = null;

function getOkxOrderbook(symbol, callback) {
  if (currentOkxOrderbookWS) {
    currentOkxOrderbookWS.close();
    currentOkxOrderbookWS = null;
  }

  const symbolOkx = symbol.toUpperCase() + '-USDT';
  const wsUrl = 'wss://ws.okx.com:8443/ws/v5/public';

  let bids = [];
  let asks = [];

  const ws = new WebSocket(wsUrl);
  currentOkxOrderbookWS = ws;

  ws.on('open', () => {
    ws.send(JSON.stringify({
      op: 'subscribe',
      args: [{ channel: 'books', instId: symbolOkx }]
    }));
    console.log(`[OKX-OB] Subscribed to ${symbolOkx} orderbook`);
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.event === 'subscribe') return;
      if (!msg.data || !msg.arg?.channel.includes('books')) return;

      const obData = msg.data[0];

      // Snapshot pertama
      if (msg.action === 'snapshot' || (!msg.action && obData.bids && obData.asks)) {
        bids = obData.bids.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
        asks = obData.asks.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
      }

      // Incremental update
      if (msg.action === 'update') {
        if (obData.bids) updateSide(bids, obData.bids, true);
        if (obData.asks) updateSide(asks, obData.asks, false);
      }

      const bidList = bids
        .sort((a, b) => b[0] - a[0]) // descending
        .slice(0, 10)
        .map(([price, qty]) => ({ price, qty, type: 'bid' }));

      const askList = asks
        .sort((a, b) => a[0] - b[0]) // ascending
        .slice(0, 10)
        .map(([price, qty]) => ({ price, qty, type: 'ask' }));

      callback([...bidList, ...askList]);

    } catch (err) {
      console.error('[OKX Orderbook WS Error] Parse failed:', err);
    }
  });

  ws.on('error', (err) => {
    console.error('[OKX Orderbook WS Error]', err);
    callback([]);
  });

  ws.on('close', () => {
    console.warn('[OKX-OB] Closed');
    currentOkxOrderbookWS = null;
  });

  function updateSide(sideArray, updates, isBid) {
    for (const [p, q] of updates) {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      const idx = sideArray.findIndex(([sp]) => sp === price);
      if (qty === 0) {
        if (idx !== -1) sideArray.splice(idx, 1); // hapus level
      } else {
        if (idx !== -1) {
          sideArray[idx][1] = qty; // update qty
        } else {
          sideArray.push([price, qty]);
        }
      }
    }
  }
}

function closeOkxOrderbookWS() {
  if (currentOkxOrderbookWS) {
    currentOkxOrderbookWS.close();
    currentOkxOrderbookWS = null;
  }
}
module.exports = {
  startOkxWS, getOkxOrderbook, closeOkxOrderbookWS
};
