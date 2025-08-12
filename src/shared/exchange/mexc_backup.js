const WebSocket = require('ws');

function startMexcWS(targetSymbols, callback) {
  const latestPrices = {};
  const updatedPrices = [];
  const socketMap = {};

  // Flush setiap 500ms
  setInterval(() => {
    if (updatedPrices.length > 0) {
      callback({
        exchange: 'MEXC',
        data: [...updatedPrices],
      });
      updatedPrices.length = 0;
    }
  }, 500);

  // Buat WebSocket per symbol
  for (const symbol of targetSymbols) {
    const ws = new WebSocket('wss://wbs.mexc.com/ws');

    ws.on('open', () => {
      const sub = {
        method: 'SUBSCRIPTION',
        params: [`spot@public.aggre.deals.v3.api@100ms@${symbol}`],
        // id: 1,
      };
      ws.send(JSON.stringify(sub));
    });

    ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg);
        console.log(data);
        if (data.c === `spot@public.deals.v3.api@${symbol}`) {
          const deals = data.d?.deals || [];
          if (deals.length > 0) {
            const price = deals[0]?.p;
            if (price && latestPrices[symbol] !== price) {
              latestPrices[symbol] = price;
              updatedPrices.push({ symbol, price });
            }
          }
        }
      } catch (err) {
        console.error(`[MEXC:${symbol}] Error parsing message:`, err.message);
      }
    });

    ws.on('error', (err) => {
      console.error(`[MEXC:${symbol}] Error:`, err.message);
    });

    ws.on('close', () => {
      console.log(`[MEXC:${symbol}] Closed`);
    });

    socketMap[symbol] = ws;
  }

  return socketMap; // untuk referensi atau jika ingin close socket nanti
}

module.exports = { startMexcWS };
