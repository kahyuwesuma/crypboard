const protobuf = require('protobufjs');
const path = require('path');

let root, PushDataV3ApiWrapper, PublicAggreDealsV3Api, PublicAggreDepthsV3Api, PublicAggreBookTickerV3Api;

async function loadProtobufDefinitions() {
  try {
    if (root) {
      return true; // sudah pernah load
    }

    const loadedRoot = await protobuf.load([
      path.join(__dirname, '../../../proto/PushDataV3ApiWrapper.proto'),
      path.join(__dirname, '../../../proto/PublicAggreDealsV3Api.proto'),
      path.join(__dirname, '../../../proto/PublicAggreDepthsV3Api.proto'),
      path.join(__dirname, '../../../proto/PublicAggreBookTickerV3Api.proto'),
    ]);

    root = loadedRoot;

    // Assign semua types
    PushDataV3ApiWrapper = root.lookupType('PushDataV3ApiWrapper');
    PublicAggreDealsV3Api = root.lookupType('PublicAggreDealsV3Api');
    PublicAggreDepthsV3Api = root.lookupType('PublicAggreDepthsV3Api');
    PublicAggreBookTickerV3Api = root.lookupType('PublicAggreBookTickerV3Api');

    console.log('[MEXC-OB] Protobuf orderbook definitions loaded');
    return true;

  } catch (err) {
    console.error('[MEXC-OB] Gagal load protobuf:', err.message);
    console.error('[MEXC-OB] Stack trace:', err.stack);

    throw err;
  }
}

function startPing(ws) {
  try {
    ws._pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ method: "ping" }));
        console.log("✅ success send ping");
      }
    }, 10000);
  } catch (e) {
    console.log("❌ sending ping error:", e.message);
  }
}

function stopPing(ws) {
  try {
    if (ws._pingInterval) {
      clearInterval(ws._pingInterval);
      delete ws._pingInterval;
      console.log("⏹️ ping stopped for this WS");
    }
  } catch (e) {
    console.log("❌ stop ping error:", e.message);
  }
}


const axios = require('axios');
const { getMexcAPI } = require('./helper');

async function getOrderbookSnapshot(targetSymbol, callback) {
  const apiKey = getMexcAPI()
  const orderbook = { bids: [], asks: [] };

  try {
    // Step 1: Ambil snapshot awal
    const snap = await axios.get(
      `https://api.mexc.com/api/v3/depth?symbol=${targetSymbol}&limit=10`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-MEXC-APIKEY': apiKey.apiKey
        }
      }
    );

    orderbook.bids = snap.data.bids.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
    orderbook.asks = snap.data.asks.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
    orderbook.bids.sort((a,b)=> b[0]-a[0])
    orderbook.asks.sort((a,b)=> a[0]-b[0])

    const initialBidOrders = orderbook.bids.slice(0, 10).map(([price, qty]) => ({
      price,
      qty,
      type: 'bid',
    }));
    const initialAskOrders = orderbook.asks.slice(0, 10).map(([price, qty]) => ({
      price,
      qty,
      type: 'ask',
    }));

    callback([...initialBidOrders, ...initialAskOrders]);
  } catch (err) {
    console.error(`[MEXC-OB] Failed to fetch snapshot for ${symbolUpper}:`, err.message);
  }
}


module.exports = {
  startPing,
  stopPing,
  getOrderbookSnapshot,
  loadProtobufDefinitions,
  getTypes: () => ({
    PushDataV3ApiWrapper,
    PublicAggreDealsV3Api,
    PublicAggreDepthsV3Api,
    PublicAggreBookTickerV3Api,
  }),
};
