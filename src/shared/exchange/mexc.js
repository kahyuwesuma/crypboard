const WebSocket = require('ws');
const path = require('path');
const axios = require('axios');
const { chunkArray } = require('../utils/helper')
const { startPing, getOrderbookSnapshot ,loadProtobufDefinitions, getTypes, stopPing } = require('../utils/mexcHelper');

let mexcLastMessageTime = 0
let isStoppingMexc = false;

const mexcClients = {
  type: null,  
  sockets: [],
  reconnectTimers: {}, // simpan timer reconnect per batch
  activeSymbols: [], // tambahan untuk tracking symbols yang aktif
};

// fungsi reconnect khusus
function handleReconnect(type, targetSymbols, callback, batchNumber) {
  if (mexcClients.reconnectTimers[batchNumber]) {
    return;
  }

  console.log(`[MEXC]: 🔄 scheduling reconnect for batch ${batchNumber} (${type}) in 3s...`);

  mexcClients.reconnectTimers[batchNumber] = setTimeout(() => {
    delete mexcClients.reconnectTimers[batchNumber]; // clear flag
    startMexcWSBatch(type, targetSymbols, callback, batchNumber);
  }, 3000);
}

function stopMexcWS() {
  isStoppingMexc = true; // ✅ kasih tahu semua listener bahwa ini stop manual

  mexcClients.sockets.forEach(ws => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    } catch (err) {
      console.error("Error closing WS:", err.message);
    }
  });
  mexcClients.sockets = [];
  mexcClients.type = null;
  mexcClients.activeSymbols = []; 

  Object.keys(mexcClients.reconnectTimers).forEach(batch => {
    clearTimeout(mexcClients.reconnectTimers[batch]);
  });
  mexcClients.reconnectTimers = {};

  console.log("[MEXC]: all WS stopped");
}


function startMexcWS(type, allSymbols, callback) {
  // Cek apakah sudah ada koneksi aktif dengan type yang sama
  if (mexcClients.type === type && mexcClients.sockets.length > 0) {
    // Cek apakah semua symbols sudah aktif
    const hasActiveConnections = mexcClients.sockets.some(ws => ws.readyState === WebSocket.OPEN);
    const symbolsMatch = JSON.stringify(mexcClients.activeSymbols.sort()) === JSON.stringify(allSymbols.sort());
    
    if (hasActiveConnections && symbolsMatch) {
      console.log(`[MEXC]: connection already active for type ${type} with same symbols, skipping...`);
      return;
    }
  }

  if (mexcClients.type && mexcClients.type !== type) {
    console.log(`[MEXC]: switching from ${mexcClients.type} → ${type}`);
    stopMexcWS();
  }

  mexcClients.type = type;
  mexcClients.activeSymbols = [...allSymbols];
  
  const symbolBatches = chunkArray(allSymbols, 30);
  symbolBatches.forEach((batchSymbols, batchIndex) => {
    startMexcWSBatch(type, batchSymbols, callback, batchIndex + 1);
  });
  isStoppingMexc = false;

}

async function startMexcWSBatch(type, targetSymbols, callback, batchNumber) {
  await loadProtobufDefinitions()
  const { PushDataV3ApiWrapper } = getTypes()

  const ws = new WebSocket('wss://wbs-api.mexc.com/ws')
  mexcClients.sockets.push(ws);

  ws.on('open', () => {
    targetSymbols.forEach((symbol, index) => {
      let channelName
      if (type === 'orderbook'){
        channelName = `spot@public.aggre.bookTicker.v3.api.pb@100ms@${symbol}`;
      } else if (type === 'lastPrice'){
        channelName = `spot@public.aggre.deals.v3.api.pb@100ms@${symbol}`;
      } else {
        console.error('type is undefined')
      }
      const sub = {
        method: 'SUBSCRIPTION',
        params: [channelName],
        id: index + 1,
      };
      setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(sub));
        }
      }, index * 100);
    });
    console.log(`[MEXC]: ws opened for (${type}) batch ${batchNumber}`)
    startPing(ws)
  });

  const lastPrices = {}
  const lastOrderbook = {}
  ws.on('message', (data) => {
    mexcLastMessageTime = Date.now()
    if (data[0] === 0x7B) return

    const payload = PushDataV3ApiWrapper.decode(data);    
    const symbol = payload.symbol
    
    const updates = []

    if (type === 'lastPrice'){
      const itemPrice = payload.publicAggreDeals.deals[0]
      const price = itemPrice.price
      
      if (lastPrices[symbol] !== price){
        lastPrices[symbol] = price
        updates.push({symbol, price})
      }
    }
        
    if (type === 'orderbook') {
      const itemOrderbook = payload.publicAggreBookTicker
      const bid = itemOrderbook.bidPrice
      const ask = itemOrderbook.askPrice

      const prev = lastOrderbook[symbol] || {}
      if (prev.bid !== bid || prev.ask !== ask){
        lastOrderbook[symbol] = {bid, ask}
        updates.push({symbol, bid, ask})
      }
    }

    if (typeof callback === 'function' && updates.length > 0){
      callback(updates)
    }
  });

  ws.on('close', () => {
    console.log(`[MEXC]: ws closed (batch ${batchNumber})`);
    stopPing()
    if (!isStoppingMexc) {
      handleReconnect(type, targetSymbols, callback, batchNumber);
    }
  });


  ws.on('error', (err) => {
    console.error(`[MEXC]: ws error (batch ${batchNumber})`, err.message);
    ws.close()
  });
}



let mexcWS = null;
let mexcChannel = null; // simpan channel supaya bisa di-unsubscribe

async function getMexcOrderbook(targetSymbol, callback){
  await loadProtobufDefinitions()
  const { PushDataV3ApiWrapper } = getTypes()
  const symbol = targetSymbol + 'USDT'
  mexcWS = new WebSocket('wss://wbs-api.mexc.com/ws')
  
  const orderbook = {bids:[], asks:[]}
  await getOrderbookSnapshot(symbol, (data) =>{
    orderbook.bids = data.filter(o => o.type === 'bid').map(o => [o.price, o.qty])
    orderbook.asks = data.filter(o => o.type === 'ask').map(o => [o.price, o.qty])
    callback(data)
  })

  mexcWS.on('open', () => {
    mexcChannel = `spot@public.aggre.depth.v3.api.pb@100ms@${symbol}`
    const sub = {
      method: 'SUBSCRIPTION',
      params: [mexcChannel]
    }
    if (mexcWS && mexcWS.readyState === WebSocket.OPEN) {
      mexcWS.send(JSON.stringify(sub));
    }
    console.log('ws opened for orderbook: ', symbol)
  })

  mexcWS.on('message', (data) => {
    if (data[0] === 0x7B) return
      
    const payload = PushDataV3ApiWrapper.decode(data);
    const item = payload.publicAggreDepths
    
    item.bids.forEach(({price, quantity})=> {
      const prc = parseFloat(price)
      const qty = parseFloat(quantity)

      const idx = orderbook.bids.findIndex(([bidPrice])=>bidPrice === prc)

      if (qty === 0){
        if (idx >= 0) orderbook.bids.splice(idx, 1)
      } else {
        if (idx >= 0) orderbook.bids[idx][1]= qty
        else orderbook.bids.push([prc, qty])
      }
    })
    orderbook.bids.sort((a, b)=> b[0]-a[0])
    orderbook.bids = orderbook.bids.slice(0,50)

    item.asks.forEach(({price, quantity})=> {
      const prc = parseFloat(price)
      const qty = parseFloat(quantity)

      const idx = orderbook.asks.findIndex(([askPrice])=>askPrice === prc)

      if (qty === 0){
        if (idx >= 0) orderbook.asks.splice(idx, 1)
      } else {
        if (idx >= 0) orderbook.asks[idx][1]= qty
        else orderbook.asks.push([prc, qty])
      }
    })
    orderbook.asks.sort((a, b)=> a[0]-b[0])
    orderbook.asks = orderbook.asks.slice(0,50)

    const bid = orderbook.bids.slice(0,10).map(([price, qty]) => ({
      price,
      qty,
      type: 'bid'
    }))

    const ask = orderbook.asks.slice(0,10).map(([price, qty]) => ({
      price,
      qty,
      type: 'ask'
    }))

    callback([...bid, ...ask])
  })
}

function stopMexcOrderbook(){
  if (mexcWS) {
    try {
      if (mexcWS.readyState === WebSocket.OPEN && mexcChannel) {
        const unsub = {
          method: 'UNSUBSCRIPTION',
          params: [mexcChannel]
        }
        mexcWS.send(JSON.stringify(unsub));
        console.log("Unsubscribed from:", mexcChannel)
      }
      mexcWS.close()
      console.log("MEXC orderbook WebSocket closed")
    } catch (err) {
      console.error("Error closing MEXC WebSocket:", err)
    } finally {
      mexcWS = null
      mexcChannel = null
    }
  }
}

function getMexcConnection(){
  const now = Date.now()
  const diff = now - mexcLastMessageTime

  if (diff < 5000) return 100;
  if (diff < 10000) return 75;
  if (diff < 20000) return 50;
  if (diff < 30000) return 25;
  return 0;
}

module.exports = { 
  startMexcWS, 
  stopMexcWS, 
  getMexcOrderbook, 
  stopMexcOrderbook, 
  getMexcConnection, 
};




// --- Fungsi connection strength ---
// 0ms latency = 100%, 2000ms+ = 0%
function getMexcConnectionStrength() {
  if (mexcLatencyMap.size === 0) return 0;
  const latencies = Array.from(mexcLatencyMap.values());
  const avgLatency = latencies.reduce((a,b) => a+b, 0) / latencies.length;
  const percent = Math.max(0, Math.min(100, Math.round((2000 - avgLatency)/2000*100)));
  return percent;
}


// Fungsi stop tambahan untuk price ticker
function stopMexcWsssS() {
  if (currentMexcTickerFlushInterval) {
    clearInterval(currentMexcTickerFlushInterval);
    currentMexcTickerFlushInterval = null;
  }
  if (currentMexcTickerPingInterval) {
    clearInterval(currentMexcTickerPingInterval);
    currentMexcTickerPingInterval = null;
  }
  if (currentMexcTickerWS) {
    try {
      currentMexcTickerWS.close();
      console.log('[MEXC] 🔌 Price ticker WS closed.');
    } catch (e) {
      console.error('[MEXC] Error closing ticker WS:', e.message);
    }
    currentMexcTickerWS = null;
  }
}


let currentMexcOrderbookWS = null;

function getMexcOrderboosssk(symbol, callback) {
  if (currentMexcOrderbookWS) {
    currentMexcOrderbookWS.close();
    currentMexcOrderbookWS = null;
  }

  const symbolUpper = symbol.toUpperCase() + "USDT";
  console.log(`[MEXC-OB] Starting orderbook for: ${symbolUpper}`);
  let orderbook = { bids: [], asks: [] };

  // Step 1: Ambil snapshot awal
  axios.get(
    `https://api.mexc.com/api/v3/depth?symbol=${symbolUpper}&limit=10`,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-MEXC-APIKEY': 'mx0vglc8fNPnaH59vF'
      }
    }
  )
  .then((snap) => {
    orderbook.bids = snap.data.bids.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
    orderbook.asks = snap.data.asks.map(([p, q]) => [parseFloat(p), parseFloat(q)]);
    console.log(`[MEXC-OB] Initial snapshot loaded: ${orderbook.bids.length} bids, ${orderbook.asks.length} asks`);

    // Kirim snapshot awal
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

    // Step 2: Koneksi WS setelah snapshot berhasil
    const ws = new WebSocket('wss://wbs-api.mexc.com/ws');
    currentMexcOrderbookWS = ws;

    ws.on('open', () => {
      const channelName = `spot@public.aggre.depth.v3.api.pb@100ms@${symbolUpper}`;
      const sub = {
        method: 'SUBSCRIPTION',
        params: [channelName],
        id: Date.now(),
      };
      ws.send(JSON.stringify(sub));
      console.log(`[MEXC-OB] Subscribed to orderbook: ${symbolUpper}`);
    });

    ws.on('message', (msg) => {
      try {
        if (msg[0] === 0x7B) {
          // JSON response (subscribe/ping)
          const data = JSON.parse(msg.toString());
          console.log('[MEXC-OB] JSON Response:', data);
          
          if (data.id && data.code !== undefined) {
            if (data.code === 0) {
              console.log(`[MEXC-OB] Successfully subscribed: ${data.msg}`);
            } else {
              console.error('[MEXC-OB] Subscription failed:', data);
            }
          }
          
          if (data.msg === 'PONG') {
            console.log('[MEXC-OB] PONG received');
          }
          return;
        }

        const wrapper = PushDataV3ApiWrapper.decode(msg);
        // Cek berbagai kemungkinan nama field untuk depth data
        let depthData = null;
        
        depthData = wrapper.publicAggreDepths;
        if (depthData && depthData.bids && depthData.asks) {

          // Update bids
          depthData.bids.forEach(({ price, quantity }) => {
            const p = parseFloat(price);
            const q = parseFloat(quantity);
            const idx = orderbook.bids.findIndex(([bp]) => bp === p);
            if (q === 0) {
              if (idx >= 0) orderbook.bids.splice(idx, 1);
            } else {
              if (idx >= 0) orderbook.bids[idx][1] = q;
              else orderbook.bids.push([p, q]);
            }
          });
          orderbook.bids.sort((a, b) => b[0] - a[0]);

          // Update asks
          depthData.asks.forEach(({ price, quantity }) => {
            const p = parseFloat(price);
            const q = parseFloat(quantity);
            const idx = orderbook.asks.findIndex(([ap]) => ap === p);
            if (q === 0) {
              if (idx >= 0) orderbook.asks.splice(idx, 1);
            } else {
              if (idx >= 0) orderbook.asks[idx][1] = q;
              else orderbook.asks.push([p, q]);
            }
          });
          orderbook.asks.sort((a, b) => a[0] - b[0]);

          // Step 4: Kirim top 10
          const bidOrders = orderbook.bids.slice(0, 10).map(([price, qty]) => ({
            price,
            qty,
            type: 'bid',
          }));
          // console.log(bidOrders);
          const askOrders = orderbook.asks.slice(0, 10).map(([price, qty]) => ({
            price,
            qty,
            type: 'ask',
          }));

          callback([...bidOrders, ...askOrders]);
        } else {
          console.log('[MEXC-OB] Depth data structure:', depthData ? Object.keys(depthData) : 'null');
        }
      } catch (err) {
        console.error('[MEXC-OB] Error parsing orderbook:', err.message);
        console.error('[MEXC-OB] Error stack:', err.stack);
        
        // Debug: tampilkan raw message
        if (msg && msg.length > 0 && msg[0] !== 0x7B) {
          console.log('[MEXC-OB] Raw binary message (first 50 bytes):', 
            Array.from(msg.slice(0, 50)).map(b => b.toString(16).padStart(2, '0')).join(' ')
          );
        }
      }
    });

    ws.on('error', (err) => {
      console.error('[MEXC-OB] Orderbook WS error:', err.message);
      callback([]);
    });

    ws.on('close', (code, reason) => {
      console.log(`[MEXC-OB] Orderbook WS closed: ${code} ${reason}`);
      currentMexcOrderbookWS = null;
    });

  })
  .catch((err) => {
    console.error('[MEXC-OB] Gagal ambil snapshot orderbook:', err.message);
    callback([]);
  });

  // Return stop function
  return () => {
    if (currentMexcOrderbookWS && currentMexcOrderbookWS.readyState === WebSocket.OPEN) {
      currentMexcOrderbookWS.close();
    }
  };
}

function closeMexcOrderbookWS() {
  if (currentMexcOrderbookWS) {
    currentMexcOrderbookWS.close();
    currentMexcOrderbookWS = null;
    console.log('[MEXC-OB] Orderbook connection closed');
  }
}

function multipleMexcOrderbook(allSymbols, callback) {
  const symbolBatches = chunkArray(allSymbols, MAX_SUBS_PER_WS);

  symbolBatches.forEach((batchSymbols, batchIndex) => {
    startMexcWSBatchOrderbook(batchSymbols, callback, batchIndex + 1);
  });
}

function startMexcWSBatchOrderbook(targetSymbols, callback, batchNumber) {
  loadProtobufDefinitions()
    .then((protoLoaded) => {
      if (!protoLoaded) throw new Error('Failed to load protobuf definitions.');

      const latestPrices = {};
      const updatedPrices = [];
      let ws = null;

      // Catat waktu update terakhir per batch
      let lastUpdateTimestamp = Date.now();

      const flushInterval = setInterval(() => {
        if (updatedPrices.length > 0) {
          callback({
            exchange: `mexc`,
            data: [...updatedPrices],
          });
          updatedPrices.length = 0;
        }
      }, 10);

      const pingInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ method: 'PING' }));
        }
      }, 30000);

      currentMexcTickerFlushInterval = flushInterval;
      currentMexcTickerPingInterval = pingInterval;

      function parseProtobufMessage(buffer) {
        try {
          const wrapper = PushDataV3ApiWrapper.decode(buffer);

          if (wrapper.publicAggreBookTicker) {
            const symbol = wrapper.symbol;
            const bid = parseFloat(wrapper.publicAggreBookTicker.bidPrice);
            const ask = parseFloat(wrapper.publicAggreBookTicker.askPrice);

            if (!latestPrices[symbol]) latestPrices[symbol] = { bid: null, ask: null };

            const prev = latestPrices[symbol];
            if (prev.bid !== bid || prev.ask !== ask) {
              latestPrices[symbol] = { bid, ask };
              updatedPrices.push({ symbol, bid: bid, ask: ask });
            }
          }

          // console.log(updatedPrices)
        } catch (error) {
          console.error(`[MEXC-${batchNumber}] Error parsing protobuf message:`, error.message);
        }
      }

      function connect() {
        ws = new WebSocket('wss://wbs-api.mexc.com/ws');
        mexcWSConnections.push(ws);

        ws.on('open', () => {
          console.log(`[MEXC-${batchNumber}] Connected, subscribing ${targetSymbols.length} symbols...`);
          targetSymbols.forEach((symbol, index) => {
            const channelName = `spot@public.aggre.bookTicker.v3.api.pb@100ms@${symbol}`;
            const sub = {
              method: 'SUBSCRIPTION',
              params: [channelName],
              // id: index + 1,
            };
            setTimeout(() => {
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(sub));
              }
            }, index * 100);
          });
        });

        ws.on('message', (msg) => {
          if (msg[0] === 0x7B) {
            const data = JSON.parse(msg.toString());
            if (data.msg === 'PONG') return;
          } else {
            parseProtobufMessage(msg);
          }
        });

        ws.on('close', () => {
          console.log(`[MEXC-${batchNumber}] Disconnected, reconnecting...`);
          setTimeout(connect, 5000);
        });

        ws.on('error', (err) => {
          console.error(`[MEXC-${batchNumber}] Error:`, err.message);
        });
      }

      connect();
    })
    .catch((err) => console.error(`[MEXC-${batchNumber}] Failed:`, err.message));
}


// let root, PushDataV3ApiWrapper, PublicAggreDealsV3Api, PublicAggreDepthsV3Api, PublicAggreBookTickerV3Api;

function loadProtobufDefinitionss() {
  return new Promise((resolve, reject) => {
    try {
      if (!root) {
        // Load semua proto files sekaligus
        protobuf.load([
          path.join(__dirname, '../../../proto/PushDataV3ApiWrapper.proto'),
          path.join(__dirname, '../../../proto/PublicAggreDealsV3Api.proto'),
          path.join(__dirname, '../../../proto/PublicAggreDepthsV3Api.proto'),
          path.join(__dirname, '../../../proto/PublicAggreBookTickerV3Api.proto'),
        ])
        .then((loadedRoot) => {
          root = loadedRoot;
          
          // Assign semua types
          PushDataV3ApiWrapper = root.lookupType('PushDataV3ApiWrapper');
          PublicAggreDealsV3Api = root.lookupType('PublicAggreDealsV3Api');
          PublicAggreDepthsV3Api = root.lookupType('PublicAggreDepthsV3Api');
          PublicAggreBookTickerV3Api = root.lookupType('PublicAggreBookTickerV3Api');
          
          console.log('[MEXC-OB] Protobuf orderbook definitions loaded');
          resolve(true);
        })
        .catch((err) => {
          console.error('[MEXC-OB] Gagal load protobuf:', err.message);
          console.error('[MEXC-OB] Stack trace:', err.stack);
          
          // Debug: cek apakah file proto ada
          const fs = require('fs');
          const protoPath = path.join(__dirname, '../../../proto/PublicAggreDepthsV3Api.proto');
          if (!fs.existsSync(protoPath)) {
            console.error('[MEXC-OB] Proto file tidak ditemukan:', protoPath);
          }
          
          reject(err);
        });
      } else {
        resolve(true);
      }
    } catch (err) {
      console.error('[MEXC-OB] Gagal load protobuf:', err.message);
      console.error('[MEXC-OB] Stack trace:', err.stack);
      
      // Debug: cek apakah file proto ada
      const fs = require('fs');
      const protoPath = path.join(__dirname, '../../../proto/PublicAggreDepthsV3Api.proto');
      if (!fs.existsSync(protoPath)) {
        console.error('[MEXC-OB] Proto file tidak ditemukan:', protoPath);
      }
      
      reject(err);
    }
  });
}