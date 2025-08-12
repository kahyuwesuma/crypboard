document.getElementById('management-button').addEventListener('click', () => {
  window.dashboardAPI.navigate('manajemen');
});



let currentUsdtIdrRate = 15800; // Default value
window.indodaxAPI.onHeaderData((data) => {
  const { btcIdr, btcUsdt, usdtIdr } = data;
  currentUsdtIdrRate = usdtIdr;
  document.getElementById("btcIdr").innerText = btcIdr?.toLocaleString("id-ID") || "-";
  document.getElementById("btcUsdt").innerText = btcUsdt?.toFixed(2) || "-";
  document.getElementById("usdtIdr").innerText = usdtIdr?.toLocaleString("id-ID") || "-";
});

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

// Global state management
const favoriteSymbols = new Set();
const allExchangeData = {};
const exchangeList = ['binance', 'huobi', 'gateio', 'kucoin', 'mexc', 'okx', 'bitget', 'bybit'];

// Batch update untuk multiple exchanges
let pendingRenders = new Set();
let isRendering = false;

const debouncedBatchRender = debounce(() => {
  if (pendingRenders.size > 0 && !isRendering) {
    isRendering = true;
    const exchangesToRender = Array.from(pendingRenders);
    pendingRenders.clear();
    
    // Render dalam batch untuk performa lebih baik
    requestAnimationFrame(() => {
      exchangesToRender.forEach(exchange => {
        renderTableImmediate(exchange);
      });
      isRendering = false;
    });
  }
}, 100); // 100ms batch delay

exchangeList.forEach((exchange) => {
  const searchInput = document.getElementById(`search-${exchange}`);

  // Simpan data ke objek global dengan batching
  window.marketAPI.onExchangeUpdate(exchange, (data) => {
    allExchangeData[exchange] = data;
    
    // Add to pending renders instead of immediate render
    pendingRenders.add(exchange);
    debouncedBatchRender();
  });

  // Event saat user ngetik di input - dengan debounce yang lebih agresif untuk search
  searchInput?.addEventListener('input', debounce(() => {
    renderTable(exchange);
  }, 300)); // Increased delay untuk search
});

// Load dari localStorage
const favoriteSymbolsPerExchange = JSON.parse(localStorage.getItem('favoriteSymbolsPerExchange') || '{}');

// Pastikan struktur awal ada
function getFavorites(exchange) {
  return new Set(favoriteSymbolsPerExchange[exchange] || []);
}

function toggleFavorite(exchange, symbol) {
  const favs = getFavorites(exchange);
  if (favs.has(symbol)) {
    favs.delete(symbol);
  } else {
    favs.add(symbol);
  }
  favoriteSymbolsPerExchange[exchange] = Array.from(favs);
  localStorage.setItem('favoriteSymbolsPerExchange', JSON.stringify(favoriteSymbolsPerExchange));
}

// Tambahkan di global state
const lastGaps = {}; // key: `${exchange}-${symbol}`, value: gap sebelumnya

// Immediate render function (ditambah highlight)
function renderTableImmediate(exchange) {
  const tbody = document.getElementById(`${exchange}TableBody`);
  const searchValue = document.getElementById(`search-${exchange}`)?.value?.toUpperCase() || '';
  const data = allExchangeData[exchange] || [];

  if (!tbody) return;

  const fragment = document.createDocumentFragment();
  const favSet = getFavorites(exchange);

  const filteredData = data.filter(({ symbol }) => symbol.toUpperCase().includes(searchValue));

  const favorites = [];
  const nonFavorites = [];

  for (const item of filteredData) {
    if (favSet.has(item.symbol)) {
      favorites.push(item);
    } else {
      nonFavorites.push(item);
    }
  }

  const finalData = searchValue
    ? [...favorites, ...nonFavorites]
    : [...favorites.slice(0, 10), ...nonFavorites.slice(0, 20 - favorites.length)];

  finalData.forEach(({ symbol, priceA, priceB, gap }) => {
    const isFavorite = favSet.has(symbol);
    const star = isFavorite ? "★" : "☆";
    const favClass = isFavorite ? 'favorited' : '';

    let colorClass = '';
    let arrow = '';

    if (gap >= 10) {
      colorClass = 'yellow';
      arrow = '▲';
    } else if (gap <= -10) {
      colorClass = 'yellow';
      arrow = '▼';
    } else if (gap >= 5) {
      colorClass = 'white';
      arrow = '▲';
    } else if (gap <= -5) {
      colorClass = 'white';
      arrow = '▼';
    } else if (gap > 0) {
      colorClass = 'lightgreen';
      arrow = '▲';
    } else if (gap < 0) {
      colorClass = 'red';
      arrow = '▼';
    }


    const tr = document.createElement('tr');
    const gapKey = `${exchange}-${symbol}`;
    const prevGap = lastGaps[gapKey];
    lastGaps[gapKey] = gap; // update nilai terbaru

    // Jika ada gap sebelumnya, cek perubahan dan beri highlight
let highlightClass = '';
if (prevGap !== undefined) {
  if (gap > prevGap) {
    highlightClass = 'flash-green'; // sekarang pakai class ke <tr>
  } else if (gap < prevGap) {
    highlightClass = 'flash-red';
  }
}

const priceBTdClass = highlightClass ? `flash-${highlightClass.split('-')[1]}` : '';

tr.innerHTML = `
  <td>
    <span class="favorite-toggle ${favClass}" data-symbol="${symbol}" data-exchange="${exchange}" style="cursor:pointer; margin-left:6px;">
      ${star}
    </span>
    <span class="coin-name ${favClass}">${symbol}</span>
  </td>
  <td>${priceA}</td>
  <td class="${priceBTdClass}">${priceB}</td>
  <td class="${priceBTdClass}">
    <button class="gap-button" style="color: ${colorClass};" data-symbol="${symbol}" data-exchange="${exchange}">
      ${arrow} ${Math.abs(gap)}%
    </button>
  </td>
`;

    fragment.appendChild(tr);
  });

  tbody.innerHTML = '';
  tbody.appendChild(fragment);
}


// Public render function dengan debounce (untuk search)
const renderTable = debounce((exchange) => {
  renderTableImmediate(exchange);
}, 150);

// Event delegation untuk favorite toggle dan gap buttons
document.body.addEventListener('click', (e) => {
  if (e.target.classList.contains('favorite-toggle')) {
    const symbol = e.target.dataset.symbol;
    const exchange = e.target.dataset.exchange;
    toggleFavorite(exchange, symbol);
    renderTableImmediate(exchange); // Immediate render untuk UI responsiveness
  }
  
  if (e.target.classList.contains('gap-button')) {
    const symbol = e.target.getAttribute('data-symbol');
    const exchange = e.target.getAttribute('data-exchange');
    
    // Kirim permintaan orderbook ke main
    window.electron.send('request-orderbook', { symbol, exchange });

    // Tampilkan modal langsung (tunggu konten menyusul)
    const modal = document.getElementById('orderbookModal');
    modal.style.display = 'block';
    document.getElementById('modalTitle').innerText = `Detail ${symbol} - ${exchange}`;
    const modalContent = document.getElementById('modalContent');
    modalContent.innerHTML = '<div style="padding: 10px; text-align: center;">Loading...</div>';
  }
});

document.getElementById('closeOrderbookModal').addEventListener('click', () => {
  document.getElementById('orderbookModal').style.display = 'none';

  const modalTitle = document.getElementById('modalTitle').innerText; // Contoh: "Order Book - BTCUSDT (binance)"
  // Parsing simbol dan exchange dari title
  const symbolMatch = modalTitle.match(/Detail\s+(\S+)\s*-\s*(\S+)/);
  const symbol = symbolMatch ? symbolMatch[1] : null;
  const exchange = symbolMatch ? symbolMatch[2] : null;


  if (symbol && exchange) {
    window.electron.send('close-orderbook', { symbol, exchange });
  }
});

// Simpan state orderbook terakhir
const latestOrders = {};

// Terima update orderbook-response
window.electron.receive('orderbook-response', ({ symbol, exchange, orders }) => {
  // Inisialisasi object jika belum ada
  if (!latestOrders[exchange]) latestOrders[exchange] = [];
  if (!latestOrders['indodax']) latestOrders['indodax'] = [];

  // Update data exchange utama jika ada
  if (orders[exchange]) {
    latestOrders[exchange] = orders[exchange];
  }
  // Update data Indodax jika ada
  if (orders.indodax) {
    latestOrders.indodax = orders.indodax;
  }
  const modal = document.getElementById('orderbookModal');
  if (modal.style.display === 'block') {
    const modalTitle = document.getElementById('modalTitle').innerText;
    const symbolMatch = modalTitle.match(/Detail\s+(\S+)\s*-\s*(\S+)/)
    // const exchangeMatch = modalTitle.match(/\(([^)]+)\)/);
    const currentSymbol = symbolMatch ? symbolMatch[1] : null;
    const currentExchange = symbolMatch ? symbolMatch[2] : null;

    if (currentSymbol === symbol && currentExchange === exchange) {
      const gapKey = `${exchange}-${symbol}`;
      const gap = lastGaps[gapKey] || 0;
      renderCombinedOrderbook(symbol, exchange, gap);
    }
  }
});
// Helper: dapatkan order filter by symbol & type dengan aman
function getOrdersByTypeAndSymbol(orders, type, symbol) {
  if (!orders || !Array.isArray(orders)) return [];
  const s = symbol.toLowerCase();
  return orders.filter(o => o.type === type && (o.symbol ? o.symbol.toLowerCase() === s : true));
}

let currentCurrency = "IDR"; // default awal

document.getElementById("currencySwitchBtn").addEventListener("click", () => {
  currentCurrency = currentCurrency === "IDR" ? "USD" : "IDR";
  document.getElementById("currencySwitchBtn").innerText = `Switch to ${currentCurrency === "IDR" ? "USD" : "IDR"}`;
  renderCombinedOrderbook(lastSymbol, lastExchange, lastGap); // render ulang tabel
});


const { formatPrice } = window.utils;
function renderCombinedOrderbook(symbol, exchange, gap) {
  const indodaxOrders = latestOrders.indodax || [];
  const otherOrders = latestOrders[exchange] || [];

  const indodaxBids = getOrdersByTypeAndSymbol(indodaxOrders, 'bid', symbol);
  const indodaxAsks = getOrdersByTypeAndSymbol(indodaxOrders, 'ask', symbol);
  const otherBids = getOrdersByTypeAndSymbol(otherOrders, 'bid', symbol);
  const otherAsks = getOrdersByTypeAndSymbol(otherOrders, 'ask', symbol);

  let leftOrders = [];
  let rightOrders = [];
  let leftHeaderText = '';
  let rightHeaderText = '';
  let leftType = '';
  let rightType = '';

  function calculateGap(leftPrice, rightPrice) {
    if (!leftPrice || !rightPrice) return '-';
    const gapPercent = ((rightPrice - leftPrice) / leftPrice) * 100;
    return gapPercent.toFixed(2) + '%';
  }

  if (gap < 0) {
    leftOrders = otherAsks;
    rightOrders = indodaxBids;
    leftHeaderText = `${exchange.toUpperCase()} SELL Price`;
    rightHeaderText = 'IDX BUY Price';
    leftType = 'sell';
    rightType = 'buy';
  } else if (gap > 0) {
    leftOrders = indodaxAsks;
    rightOrders = otherBids;
    leftHeaderText = 'IDX SELL Price';
    rightHeaderText = `${exchange.toUpperCase()} BUY Price`;
    leftType = 'sell';
    rightType = 'buy';
  } else {
    leftOrders = [...indodaxBids, ...otherBids];
    rightOrders = [...indodaxAsks, ...otherAsks];
    leftHeaderText = 'BUY Orders';
    rightHeaderText = 'SELL Orders';
    leftType = 'buy';
    rightType = 'sell';
  }

  if (leftType === 'sell') leftOrders.sort((a, b) => a.price - b.price);
  else leftOrders.sort((a, b) => b.price - a.price);

  if (rightType === 'sell') rightOrders.sort((a, b) => a.price - b.price);
  else rightOrders.sort((a, b) => b.price - a.price);

  const maxRows = Math.max(leftOrders.length, rightOrders.length);

  let html = `
    <table class="orderbook-table">
      <thead>
        <tr>
          <th class="${leftType === 'sell' ? 'sell-price' : 'buy-price'}">${leftHeaderText}</th>
          <th>${leftType === 'sell' ? 'Sell Qty' : 'Buy Qty'}</th>
          <th>Total (${currentCurrency})</th>
          <th>Gap %</th>
          <th class="${rightType === 'sell' ? 'sell-price' : 'buy-price'}">${rightHeaderText}</th>
          <th>${rightType === 'sell' ? 'Sell Qty' : 'Buy Qty'}</th>
          <th>Total (${currentCurrency})</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (let i = 0; i < maxRows; i++) {
    const left = leftOrders[i] || null;
    const right = rightOrders[i] || null;

    const leftPrice = left ? left.price : null;
    const leftQty = left ? left.qty : null;
    const rightPrice = right ? right.price : null;
    const rightQty = right ? right.qty : null;

    let leftPriceIDR = leftPrice !== null ? 
      (exchange.toLowerCase() === 'indodax' || leftOrders === indodaxBids || leftOrders === indodaxAsks
        ? leftPrice 
        : leftPrice * currentUsdtIdrRate) 
      : null;

    let rightPriceIDR = rightPrice !== null ? 
      (exchange.toLowerCase() === 'indodax' || rightOrders === indodaxBids || rightOrders === indodaxAsks
        ? rightPrice 
        : rightPrice * currentUsdtIdrRate) 
      : null;

    const gapStr = (leftPriceIDR !== null && rightPriceIDR !== null) 
      ? calculateGap(leftPriceIDR, rightPriceIDR) 
      : '-';

    let gapClass = 'gap-neutral';
    if (gapStr !== '-' && !isNaN(parseFloat(gapStr))) {
      const val = parseFloat(gapStr);
      if (val > 0) gapClass = 'gap-positive';
      else if (val < 0) gapClass = 'gap-negative';
    }

let leftPriceDisplay = leftPrice !== null
  ? (
      (leftOrders === otherAsks || leftOrders === otherBids)
        // Exchange lain
        ? (
            currentCurrency === "IDR"
              ? `${formatPrice(leftPrice, "USD")} (${formatPrice(leftPriceIDR, "IDR")})`
              : `${formatPrice(leftPriceIDR, "IDR")} (${formatPrice(leftPrice, "USD")})`
          )
        // Indodax → langsung sesuai currency
        : formatPrice(
            currentCurrency === "IDR"
              ? leftPriceIDR
              : leftPriceIDR / currentUsdtIdrRate,
            currentCurrency
          )
    )
  : '-';

let rightPriceDisplay = rightPrice !== null
  ? (
      (rightOrders === otherAsks || rightOrders === otherBids)
        // Exchange lain
        ? (
            currentCurrency === "IDR"
              ? `${formatPrice(rightPrice, "USD")} (${formatPrice(rightPriceIDR, "IDR")})`
              : `${formatPrice(rightPriceIDR, "IDR")} (${formatPrice(rightPrice, "USD")})`
          )
        // Indodax → langsung sesuai currency
        : formatPrice(
            currentCurrency === "IDR"
              ? rightPriceIDR
              : rightPriceIDR / currentUsdtIdrRate,
            currentCurrency
          )
    )
  : '-';



const leftTotal = (leftPriceIDR !== null && leftQty !== null)
  ? formatPrice(
      currentCurrency === "IDR"
        ? leftPriceIDR * leftQty
        : (leftPriceIDR * leftQty) / currentUsdtIdrRate,
      currentCurrency
    )
  : '-';

const rightTotal = (rightPriceIDR !== null && rightQty !== null)
  ? formatPrice(
      currentCurrency === "IDR"
        ? rightPriceIDR * rightQty
        : (rightPriceIDR * rightQty) / currentUsdtIdrRate,
      currentCurrency
    )
  : '-';


    html += `
      <tr>
        <td class="${leftType === 'sell' ? 'sell-price' : 'buy-price'}">${leftPriceDisplay}</td>
        <td class="${leftType === 'sell' ? 'sell-qty' : 'buy-qty'}">${leftQty ?? '-'}</td>
        <td style="text-align: left;">${leftTotal}</td>
        <td class="gap-cell ${gapClass}">${gapStr}</td>
        <td class="${rightType === 'sell' ? 'sell-price' : 'buy-price'}">${rightPriceDisplay}</td>
        <td class="${rightType === 'sell' ? 'sell-qty' : 'buy-qty'}">${rightQty ?? '-'}</td>
        <td style="text-align: left;">${rightTotal}</td>
      </tr>
    `;
  }

  html += `</tbody></table>`;

  const modalContent = document.getElementById('modalContent');
  if (modalContent) {
    modalContent.innerHTML = html;
  } else {
    const modal = document.getElementById('orderbookModal');
    const newContent = document.createElement('div');
    newContent.id = 'modalContent';
    newContent.style.marginTop = '20px';
    newContent.innerHTML = html;
    modal.appendChild(newContent);
  }
}