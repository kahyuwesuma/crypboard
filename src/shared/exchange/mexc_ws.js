const WebSocket = require('ws');
const protobuf = require('protobufjs');
const path = require('path');
const axios = require('axios');

let root, PushDataV3ApiWrapper, PublicAggreDealsV3Api, PublicAggreDepthsV3Api;

function loadProtobufDefinitions() {
  return new Promise((resolve, reject) => {
    try {
      if (!root) {
        // Load semua proto files sekaligus
        protobuf.load([
          path.join(__dirname, '../../../proto/PushDataV3ApiWrapper.proto'),
          path.join(__dirname, '../../../proto/PublicAggreDealsV3Api.proto'),
          path.join(__dirname, '../../../proto/PublicAggreDepthsV3Api.proto'), // Pastikan file ini ada
        ])
        .then((loadedRoot) => {
          root = loadedRoot;
          
          // Assign semua types
          PushDataV3ApiWrapper = root.lookupType('PushDataV3ApiWrapper');
          PublicAggreDealsV3Api = root.lookupType('PublicAggreDealsV3Api');
          PublicAggreDepthsV3Api = root.lookupType('PublicAggreDepthsV3Api');
          
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

function startMexcWS(targetSymbols, callback) {
  loadProtobufDefinitions()
    .then((protoLoaded) => {
      if (!protoLoaded) {
        throw new Error('Failed to load protobuf definitions.');
      }

      const latestPrices = {};
      const updatedPrices = [];
      let ws = null;

      // Flush every 500ms
      const flushInterval = setInterval(() => {
        // console.log(updatedPrices )
        if (updatedPrices.length > 0) {
          callback({
            exchange: 'MEXC',
            data: [...updatedPrices],
          });
          updatedPrices.length = 0;
        }
      }, 10);

      // Ping every 30s
      const pingInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ method: 'PING' }));
        }
      }, 30000);

      function parseProtobufMessage(buffer) {
        try {
          const wrapper = PushDataV3ApiWrapper.decode(buffer);

          if (wrapper.publicAggreDeals && wrapper.publicAggreDeals.deals) {
            const dealsData = wrapper.publicAggreDeals;
            if (dealsData.deals.length > 0) {
              const latestDeal = dealsData.deals[0];
              const price = latestDeal.price;
              const symbol = wrapper.symbol;

              if (price && latestPrices[symbol] !== price) {
                latestPrices[symbol] = price;
                updatedPrices.push({
                  symbol,
                  price: parseFloat(price),
                });
                // console.log(`[MEXC] Price update: ${symbol} = ${price}`);
              }
            }
          }
          return wrapper;
        } catch (error) {
          console.error('[MEXC] Error parsing protobuf message:', error.message);
          console.log('[MEXC] Message bytes (first 20):',
            Array.from(buffer.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' ')
          );
          return null;
        }
      }

      function connect() {
        ws = new WebSocket('wss://wbs-api.mexc.com/ws');

        ws.on('open', () => {
          console.log('[MEXC] Connected, subscribing to symbols...');
          targetSymbols.forEach((symbol, index) => {
            const channelName = `spot@public.aggre.deals.v3.api.pb@100ms@${symbol}`;
            const sub = {
              method: 'SUBSCRIPTION',
              params: [channelName],
              id: index + 1,
            };
            setTimeout(() => {
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(sub));
                console.log(`[MEXC] Subscribing to ${symbol}`);
              }
            }, index * 100);
          });
        });

        ws.on('message', (msg) => {
          try {
            if (msg[0] === 0x7B) { // JSON
              const data = JSON.parse(msg.toString());

              if (data.id && data.code !== undefined) {
                if (data.code === 0) {
                  console.log(`[MEXC] Successfully subscribed: ${data.msg}`);
                } else {
                  console.error('[MEXC] Subscription failed:', data.msg);
                }
                return;
              }

              if (data.msg === 'PONG') {
                console.log('[MEXC] PONG received');
                return;
              }
            } else {
              parseProtobufMessage(msg);
            }
          } catch (err) {
            console.error('[MEXC] Error processing message:', err.message);
          }
        });

        ws.on('error', (err) => {
          console.error('[MEXC] WebSocket error:', err.message);
        });

        ws.on('close', (code, reason) => {
          console.log(`[MEXC] Connection closed: ${code} ${reason}`);
          setTimeout(() => {
            console.log('[MEXC] Reconnecting...');
            connect();
          }, 5000);
        });
      }

      connect();

      return {
        close: () => {
          clearInterval(flushInterval);
          clearInterval(pingInterval);
          if (ws) {
            ws.close();
          }
        },
        getConnection: () => ws,
        getLatestPrices: () => ({ ...latestPrices })
      };
    })
    .catch((error) => {
      console.error('[MEXC] Failed to start WebSocket:', error.message);
      throw error;
    });
}

let currentMexcOrderbookWS = null;

function getMexcOrderbook(symbol, callback) {
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
          console.log(bidOrders);
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

module.exports = { startMexcWS, getMexcOrderbook, closeMexcOrderbookWS };