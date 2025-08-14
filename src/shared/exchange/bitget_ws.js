const WebSocket = require('ws');
const dns = require('dns');

const FIXED_URI = 'wss://ws.bitget.com/v2/ws/public'; // selalu pakai endpoint ini

const BATCH_SIZE = 50;
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 10000; // ms
const PING_INTERVAL = 30000; // ms
const HEALTH_CHECK_INTERVAL = 120000; // ms
let shouldReconnectBitget = true;
function startBitgetWS(targetSymbols = [], callback) {
  shouldReconnectBitget = true;
  const lastPrices = {};
  const activeConnections = {};
  const reconnectAttempts = {};
  const failedBatches = new Set();
  const batchSymbolsMap = {};
  const isReconnecting = {};
  const reconnectTimers = {};
  let restartTimer = Date.now();

  function checkNetworkConnectivity() {
    return new Promise((resolve) => {
      dns.lookup('google.com', (err) => {
        resolve(!err);
      });
    });
  }

  function clearReconnectTimer(batchId) {
    if (reconnectTimers[batchId]) {
      clearTimeout(reconnectTimers[batchId]);
      delete reconnectTimers[batchId];
    }
  }

function runWS(symbolBatch, batchId = null, attempt = 0) {
  if (!batchId) batchId = `batch_${Math.floor(Math.random() * 10000)}`;

  // Reset state saat awal koneksi (attempt 0)
  if (attempt === 0) {
    clearReconnectTimer(batchId);
    isReconnecting[batchId] = false;
    reconnectAttempts[batchId] = 0;
  }

  console.log(`[Bitget] Connecting ${batchId} to ${FIXED_URI} (${symbolBatch.length} symbols)`);

  const ws = new WebSocket(FIXED_URI);
  let pingInterval;
  let pongTimeout;
  let closedOrErrored = false;

  function cleanup() {
    clearInterval(pingInterval);
    clearTimeout(pongTimeout);
    console.log("[Bitget] Closed Manually")
    clearReconnectTimer(batchId);
    if (activeConnections[batchId] === ws) delete activeConnections[batchId];
  }

  ws.on('open', () => {
    console.log(`[Bitget] Connected ${batchId}`);
    activeConnections[batchId] = ws;
    reconnectAttempts[batchId] = 0;
    isReconnecting[batchId] = false;

    // Subscribe
    ws.send(JSON.stringify({
      op: 'subscribe',
      args: symbolBatch.map((s) => ({
        instType: 'SPOT',
        channel: 'ticker',
        instId: s.toUpperCase(),
      })),
    }));
    console.log(`[Bitget] Subscribed ${batchId} to ${symbolBatch.length} symbols`);

    // // Ping setiap 30 detik + cek pong
    // pingInterval = setInterval(() => {
    //   if (ws.readyState === WebSocket.OPEN) {
    //     ws.send(JSON.stringify({ op: 'ping' }));
    //     clearTimeout(pongTimeout);
    //     pongTimeout = setTimeout(() => {
    //       console.warn(`[Bitget] No pong from ${batchId}, reconnecting...`);
    //       ws.close();
    //     }, 20000); // 20s tanpa pong dianggap mati
    //   }
    // }, 30000);
  });

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.op === 'pong' || data.event === 'pong') {
        clearTimeout(pongTimeout);
        return;
      }
      if (data.action === 'snapshot' && Array.isArray(data.data)) {
        const updates = [];
        for (const item of data.data) {
          const symbol = item.instId?.toUpperCase();
          const price = parseFloat(item.lastPr);
          if (!symbol || isNaN(price)) continue;
          if (lastPrices[symbol] !== price) {
            lastPrices[symbol] = price;
            updates.push({ symbol, price });
          }
        }
        if (updates.length) {
          callback({ exchange: 'Bitget', data: updates, batch_id: batchId });
        }
      }
    } catch (err) {
      console.error(`[Bitget] Message parse error in ${batchId}:`, err.message);
    }
  });

  ws.on('close', (code, reason) => {
    if (closedOrErrored) return;
    closedOrErrored = true;
    console.warn(`[Bitget] Connection closed for ${batchId}: ${code} ${reason || 'No reason'}`);
    cleanup();
    if (shouldReconnectBitget) {
      tryReconnect();
    }
  });

  ws.on('error', (err) => {
    if (closedOrErrored) return;
    closedOrErrored = true;
    console.error(`[Bitget] Error in ${batchId}:`, err.message);
    cleanup();
    if (shouldReconnectBitget) {
      tryReconnect();
    }
  });

  async function tryReconnect() {
    if (!shouldReconnectBitget) {
      console.log(`[Bitget] Autoreconnect disabled, not reconnecting ${batchId}`);
      return;
    }
    if (isReconnecting[batchId]) {
      console.log(`[Bitget] ${batchId} already reconnecting, skipping`);
      return;
    }
    isReconnecting[batchId] = true; // set paling awal

    const current = reconnectAttempts[batchId] || 0;
    if (current >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[Bitget] Max reconnection attempts reached for ${batchId}`);
      failedBatches.add(batchId);
      isReconnecting[batchId] = false;
      return;
    }
    reconnectAttempts[batchId] = current + 1;

    const hasNetwork = await checkNetworkConnectivity();
    if (!hasNetwork) {
      console.warn(`[Bitget] No network connectivity. Retry in 30s for ${batchId}`);
      isReconnecting[batchId] = false;
      reconnectTimers[batchId] = setTimeout(() => {
        delete reconnectTimers[batchId];
        tryReconnect();
      }, 30000);
      return;
    }

    const delay = Math.min(INITIAL_RECONNECT_DELAY * Math.pow(2, current), 60000);
    console.log(`[Bitget] Reconnecting ${batchId} in ${delay / 1000}s (attempt ${current + 1}/${MAX_RECONNECT_ATTEMPTS})`);

    reconnectTimers[batchId] = setTimeout(() => {
      delete reconnectTimers[batchId];
      runWS(symbolBatch, batchId, 0); // reset attempt saat sudah delay selesai
    }, delay);
  }
}


  function restartFailedBatches() {
    if (failedBatches.size === 0) return;
    console.log(`[Bitget] Restarting ${failedBatches.size} failed batches`);
    const toRestart = [...failedBatches];
    failedBatches.clear();

    toRestart.forEach((batchId, index) => {
      const symbols = batchSymbolsMap[batchId];
      if (symbols) {
        reconnectAttempts[batchId] = 0;
        isReconnecting[batchId] = false;
        clearReconnectTimer(batchId);
        setTimeout(() => {
          runWS(symbols, batchId, 0);
        }, index * 2000 + Math.random() * 1000);
      }
    });
  }

  for (let i = 0; i < targetSymbols.length; i += BATCH_SIZE) {
    const batch = targetSymbols.slice(i, i + BATCH_SIZE);
    const batchId = `batch_${Math.floor(i / BATCH_SIZE) + 1}`;
    batchSymbolsMap[batchId] = batch;
    setTimeout(() => runWS(batch, batchId), i / BATCH_SIZE * 2000 + Math.random() * 1000);
  }

  const expectedBatches = Math.ceil(targetSymbols.length / BATCH_SIZE);
  console.info(`[Bitget] Started ${expectedBatches} batches for ${targetSymbols.length} symbols`);

  const healthCheckTimer = setInterval(() => {
    const activeCount = Object.keys(activeConnections).length;
    const reconnectingCount = Object.values(isReconnecting).filter(Boolean).length;
    const failedCount = failedBatches.size;

    console.log(`[Bitget] Health: ${activeCount}/${expectedBatches} active, ${reconnectingCount} reconnecting, ${failedCount} failed`);

    if (activeCount < expectedBatches) {
      const ratio = activeCount / expectedBatches;
      if (ratio < 0.6 && Date.now() - restartTimer > 300000 && reconnectingCount === 0) {
        console.info('[Bitget] Low connection ratio, restarting failed batches...');
        restartFailedBatches();
        restartTimer = Date.now();
      }
    }
  }, HEALTH_CHECK_INTERVAL);

  return {
    close: () => {
      clearInterval(healthCheckTimer);
      Object.values(reconnectTimers).forEach(timer => clearTimeout(timer));
      Object.values(activeConnections).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'Manual close');
        }
      });
      console.log('[Bitget] All connections closed');
    },
    getStatus: () => ({
      active: Object.keys(activeConnections).length,
      expected: expectedBatches,
      reconnecting: Object.values(isReconnecting).filter(Boolean).length,
      failed: failedBatches.size,
      batches: Object.keys(batchSymbolsMap).map(batchId => ({
        id: batchId,
        symbols: batchSymbolsMap[batchId].length,
        connected: !!activeConnections[batchId],
        reconnecting: !!isReconnecting[batchId],
        attempts: reconnectAttempts[batchId] || 0
      }))
    })
  };
}
// --- Tambahan flag & fungsi stop untuk Bitget ticker WS ---


function stopBitgetWS() {
  shouldReconnectBitget = false;

  // Tutup semua koneksi aktif
  if (typeof activeConnections !== 'undefined') {
    Object.values(activeConnections).forEach(ws => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'Manual close');
        }
      } catch (e) {}
    });
  }

  // Bersihkan semua timer reconnect
  if (typeof reconnectTimers !== 'undefined') {
    Object.values(reconnectTimers).forEach(timer => clearTimeout(timer));
  }

  console.log('[Bitget] All ticker WS connections closed manually');
}


let currentBitgetOrderbookWS = null;
let reconnectOrderbookTimer = null;
let currentOrderbookSymbol = null;
let currentOrderbookOnUpdate = null;
let reconnectOrderbookDelay = 5000; // 5 detik

function connectBitgetOrderbook(symbol, onUpdate) {
  if (currentBitgetOrderbookWS) {
    try { currentBitgetOrderbookWS.close(); } catch (e) {}
    currentBitgetOrderbookWS = null;
  }

  currentOrderbookSymbol = symbol;
  currentOrderbookOnUpdate = onUpdate;

  const ws = new WebSocket('wss://ws.bitget.com/v2/ws/public');
  currentBitgetOrderbookWS = ws;

  const fixSymbol = symbol + "USDT";
  console.log(`[Bitget] Connecting orderbook for ${fixSymbol}...`);

  ws.on('open', () => {
    console.log(`[Bitget] Connected orderbook for ${fixSymbol}`);
    reconnectOrderbookDelay = 5000; // reset delay kalau berhasil
    ws.send(JSON.stringify({
      op: 'subscribe',
      args: [
        {
          instType: 'SPOT',
          channel: 'books',
          instId: fixSymbol.toUpperCase(),
        }
      ]
    }));
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);

      // Heartbeat
      if (msg.op === 'pong' || msg.event === 'pong') return;

      if ((msg.action === 'snapshot' || msg.action === 'update') && Array.isArray(msg.data)) {
        const bookData = msg.data[0];
        if (!bookData) return;

        const bids = (bookData.bids || [])
          .map(([price, qty]) => ({
            price: parseFloat(price),
            qty: parseFloat(qty),
            type: 'bid',
          }))
          .slice(0, 10);

        const asks = (bookData.asks || [])
          .map(([price, qty]) => ({
            price: parseFloat(price),
            qty: parseFloat(qty),
            type: 'ask',
          }))
          .slice(0, 10);

        if (typeof onUpdate === 'function') {
          onUpdate([...bids, ...asks]);
        }
      }

    } catch (err) {
      console.error('[Bitget] Orderbook parse error:', err.message);
    }
  });

  ws.on('error', (err) => {
    console.error('[Bitget] Orderbook WS error:', err.message);
  });

  ws.on('close', () => {
    console.warn(`[Bitget] Orderbook WS closed for ${symbol}`);
    if (symbol === currentOrderbookSymbol) {
      scheduleReconnect();
    }
  });
}

function scheduleReconnect() {
  if (reconnectOrderbookTimer) return; // biar ga double
  console.log(`[Bitget] Reconnecting orderbook in ${reconnectOrderbookDelay / 1000}s...`);
  reconnectOrderbookTimer = setTimeout(() => {
    reconnectOrderbookTimer = null;
    connectBitgetOrderbook(currentOrderbookSymbol, currentOrderbookOnUpdate);
    reconnectOrderbookDelay = Math.min(reconnectOrderbookDelay * 2, 60000); // exponential backoff max 60s
  }, reconnectOrderbookDelay);
}

function getBitgetOrderbook(symbol, onUpdate) {
  connectBitgetOrderbook(symbol, onUpdate);
}

function closeBitgetOrderbookWS() {
  if (reconnectOrderbookTimer) {
    clearTimeout(reconnectOrderbookTimer);
    reconnectOrderbookTimer = null;
  }
  if (currentBitgetOrderbookWS && currentBitgetOrderbookWS.readyState === WebSocket.OPEN) {
    currentBitgetOrderbookWS.close(1000, 'Manual close');
  }
  currentBitgetOrderbookWS = null;
  currentOrderbookSymbol = null;
  currentOrderbookOnUpdate = null;
  console.log('[Bitget] Orderbook connection closed manually');
}
module.exports = { startBitgetWS, stopBitgetWS,getBitgetOrderbook, closeBitgetOrderbookWS };