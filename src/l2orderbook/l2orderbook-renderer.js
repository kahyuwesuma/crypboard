const { formatPrice } = window.l2ElectronAPI;
let currentUsdtIdrRate = 15800;

window.l2ElectronAPI.onHeaderData((data) => {
  const { btcIdr, btcUsdt, usdtIdr } = data;
  currentUsdtIdrRate = usdtIdr;
  document.getElementById("btcIdr").innerText = formatPrice(btcIdr, "IDR") || "-";
  document.getElementById("btcUsdt").innerText = formatPrice(btcUsdt, "USD") || "-";
  document.getElementById("usdtIdr").innerText = formatPrice(usdtIdr, "IDR") || "-";
});

let activeExchanges = [];
const allExchangeData = {};
let filterConfig = {};
const rowCache = {};                  
const mountedSymbols = new Set();     
let pendingExchangeUpdates = new Set(); 
let scheduled = false;                
let scheduledDataApply = false;       

const virtualState = {
  rowHeight: 28,      
  measured: false,
  buffer: 10,
  totalRows: 0,
  symbols: [],
  startIdx: 0,
  endIdx: 0,
  lastScrollTop: 0
};

function createGlobalTable(exchanges) {
  const exchangeMap = {
    binance: "BNC",
    huobi: "HUB",
    gateio: "GAT",
    kucoin: "KUC",
    mexc: "MEX",
    okx: "OKX",
    bybit: "BYB",
    bitget: "BIT"
  };

  let headerCols = `<th>Pair Coin</th>`;

  // idx-ex
  exchanges.forEach(ex => {
    const exUpper = exchangeMap[ex] || ex.toUpperCase();
    const allowedConfig = filterConfig[ex] || {};
    if (allowedConfig[`idx-${ex}`] === true) {
      headerCols += `<th>IDX-${exUpper}</th>`;
    }
  });
  // ex-idx
  exchanges.forEach(ex => {
    const exUpper = exchangeMap[ex] || ex.toUpperCase();
    const allowedConfig = filterConfig[ex] || {};
    if (allowedConfig[`${ex}-idx`] === true) {
      headerCols += `<th>${exUpper}-IDX</th>`;
    }
  });

  return `
    <div class="exchange-section" id="global-section">
      <div class="exchange-header">
        <div class="search-container">
          <input type="text" id="search-global" class="search-input" placeholder="Search..." />
        </div>
      </div>
      <div class="table-container">
        <div class="virtual-scroll-container" id="virtualContainer" style="height:500px;overflow:auto;position:relative;">
          <table class="crypto-table" style="border-collapse:collapse;width:100%;font-size:14px;">
            <thead><tr>${headerCols}</tr></thead>
            <tbody id="globalTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// TAMBAH: Fungsi helper untuk menghitung jumlah kolom aktif
function getActiveColumnCount() {
  let count = 1; // pair coin column
  
  activeExchanges.forEach(ex => {
    const allowedConfig = filterConfig[ex] || {};
    if (allowedConfig[`idx-${ex}`] === true) count++;
    if (allowedConfig[`${ex}-idx`] === true) count++;
  });
  
  return count;
}

async function initializeL2Orderbook(){
  try {
    activeExchanges = await window.dashboardAPI.getActiveExchange();
    filterConfig = await window.dashboardAPI.getActiveFilter();
  } catch {
    activeExchanges = ['binance', 'okx', 'kucoin', 'bybit'];
  }

  const container = document.getElementById('l2orderbook-container');
  console.time("renderGlobal");
  container.innerHTML = createGlobalTable(activeExchanges);
  console.timeEnd("renderGlobal");

  setupExchangeHandlers();
  setupFavoriteHandlers();
  setupGapClickHandlers();
  setupVirtualScroll();

  // initial compute & render - AKAN dipanggil ulang setelah data masuk
  renderGlobalTable();
}

/* -------------------- Data flow & batching -------------------- */

function setupExchangeHandlers() {
  activeExchanges.forEach(exchange => {
    window.marketAPI.onExchangeUpdate(exchange, (data) => {
      queueDataApply(exchange, data);
    });
  });

  const searchEl = document.getElementById('search-global');
  searchEl?.addEventListener('input', debounce(() => {
    renderGlobalTable();         
  }, 200));
}

function queueDataApply(exchangeName, newData) {
  const wasEmpty = Object.keys(allExchangeData).every(
    ex => !allExchangeData[ex] || allExchangeData[ex].length === 0
  );

  pendingExchangeUpdates.add({ exchangeName, newData });
  if (scheduledDataApply) return;
  scheduledDataApply = true;

  requestAnimationFrame(() => {
    pendingExchangeUpdates.forEach(({ exchangeName, newData }) => {
      // assign data baru di sini, bukan di luar
      allExchangeData[exchangeName] = newData;
      applyExchangeData(exchangeName);
    });
    pendingExchangeUpdates.clear();
    scheduledDataApply = false;

    const hasDataNow = Object.keys(allExchangeData).some(
      ex => allExchangeData[ex] && allExchangeData[ex].length > 0
    );

    if (hasDataNow) {
      console.log("Data received, triggering render");
      renderGlobalTable();
    }
    scheduleRender();
  });
}



function applyExchangeData(exchangeName) {
  const searchValue = document.getElementById("search-global")?.value?.toUpperCase() || '';
  const data = allExchangeData[exchangeName] || [];
  data.forEach(item => {
    if (searchValue && !item.symbol.toUpperCase().includes(searchValue)) return;
    if (!rowCache[item.symbol]) {
      rowCache[item.symbol] = createNewRow(item.symbol);
    }
    updateRowData(rowCache[item.symbol], exchangeName, item);
  });
}

/* -------------------- Virtual list core -------------------- */

function setupVirtualScroll() {
  const container = document.getElementById("virtualContainer");
  container.addEventListener('scroll', () => {
    virtualState.lastScrollTop = container.scrollTop;
    scheduleRender();
  }, { passive: true });
}

function renderGlobalTable() {
  console.log("renderGlobalTable called");
  
  // Cek apakah sudah ada data
  const hasData = Object.keys(allExchangeData).some(ex => 
    allExchangeData[ex] && allExchangeData[ex].length > 0
  );
  
  console.log("Has data:", hasData);
  console.log("AllExchangeData keys:", Object.keys(allExchangeData));
  
  if (!hasData) {
    console.log("No data yet, skipping render");
    return;
  }
  
  const searchValue = document.getElementById("search-global")?.value?.toUpperCase() || '';
  const symbolsSet = new Set();

  Object.values(allExchangeData).forEach(arr => {
    arr.forEach(item => {
      if (!searchValue || item.symbol.toUpperCase().includes(searchValue)) {
        symbolsSet.add(item.symbol);
      }
    });
  });

  virtualState.symbols = Array.from(symbolsSet).sort();
  virtualState.totalRows = virtualState.symbols.length;
  
  console.log(`Symbols found: ${virtualState.totalRows}`);

  // Optional: prune rowCache yg tak lagi ada di symbols
  for (const sym of Object.keys(rowCache)) {
    if (!symbolsSet.has(sym)) delete rowCache[sym];
  }

  if (!virtualState.measured) {
    virtualState.rowHeight = 28;
  }

  scheduleRender();
}

function scheduleRender() {
  console.log("scheduleRender called");
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    console.log("About to call refreshVirtualRows");
    scheduled = false;
    refreshVirtualRows();
  });
}

// FIX: Tambahkan fungsi refreshVirtualRows yang hilang
function refreshVirtualRows() {
  console.log("refreshVirtualRows called");
  
  const container = document.getElementById("virtualContainer");
  const tbody = document.getElementById("globalTableBody");
  if (!container || !tbody) {
    console.log("Container or tbody not found");
    return;
  }

  const { buffer, symbols, totalRows } = virtualState;
  console.log(`Virtual render: ${totalRows} total symbols`);

  if (totalRows === 0) {
    tbody.innerHTML = '';
    return;
  }

  // Hitung rowHeight dinamis
  if (!virtualState.measured && tbody.firstElementChild) {
    const h = tbody.firstElementChild.getBoundingClientRect().height;
    if (h > 0) {
      virtualState.rowHeight = h;
      virtualState.measured = true;
    }
  }

  const rowH = virtualState.rowHeight || 28;
  const scrollTop = container.scrollTop;
  const viewportHeight = container.clientHeight;

  const startIdx = Math.max(0, Math.floor(scrollTop / rowH) - buffer);
  const endIdx = Math.min(totalRows, Math.ceil((scrollTop + viewportHeight) / rowH) + buffer);

  virtualState.startIdx = startIdx;
  virtualState.endIdx = endIdx;

  console.log(`Rendering rows ${startIdx} to ${endIdx}`);
  
  // Clear tbody
  tbody.innerHTML = '';
  
  // Top spacer
  if (startIdx > 0) {
    const topSpacer = document.createElement('tr');
    const colCount = getActiveColumnCount();
    topSpacer.innerHTML = `<td colspan="${colCount}" style="height:${startIdx * rowH}px;padding:0;border:none;"></td>`;
    tbody.appendChild(topSpacer);
  }

  // reorder biar favorit di atas
  const favSyms = symbols.filter(sym => favorites.has(sym));
  const nonFavs = symbols.filter(sym => !favorites.has(sym));
  const orderedSymbols = [...favSyms, ...nonFavs];

  // Visible rows
  orderedSymbols.slice(startIdx, endIdx).forEach(sym => {
    if (!rowCache[sym]) {
      rowCache[sym] = createNewRow(sym);
    }

    // Apply latest data untuk symbol ini
    activeExchanges.forEach(exchange => {
      const arr = allExchangeData[exchange] || [];
      const d = arr.find(x => x.symbol === sym);
      if (d) updateRowData(rowCache[sym], exchange, d);
    });

    tbody.appendChild(rowCache[sym]);
    mountedSymbols.add(sym);
  });


  // Bottom spacer
  const remainingRows = totalRows - endIdx;
  if (remainingRows > 0) {
    const bottomSpacer = document.createElement('tr');
    const colCount = getActiveColumnCount();
    bottomSpacer.innerHTML = `<td colspan="${colCount}" style="height:${remainingRows * rowH}px;padding:0;border:none;"></td>`;
    tbody.appendChild(bottomSpacer);
  }

  // Measure row height if not measured
  if (!virtualState.measured) {
    const first = tbody.querySelector('tr:not([colspan])'); // skip spacer
    if (first) {
      const h = first.getBoundingClientRect().height;
      if (h > 0) {
        virtualState.rowHeight = h;
        virtualState.measured = true;
        scheduleRender(); // Re-render dengan tinggi yang benar
      }
    }
  }
}

/* -------------------- Favorites -------------------- */

// simpan favorites dalam bentuk Set
let favorites = new Set(JSON.parse(localStorage.getItem("favoriteSymbolsL2") || "[]"));

function toggleFavorite(symbol) {
  if (favorites.has(symbol)) {
    favorites.delete(symbol);
  } else {
    favorites.add(symbol);
  }
  // simpan lagi ke localStorage
  localStorage.setItem("favoriteSymbolsL2", JSON.stringify(Array.from(favorites)));
}

function setupFavoriteHandlers() {
  const container = document.getElementById("global-section");
  if (!container) return;

  if (container._favHandlerAttached) return;
  container.addEventListener("click", (e) => {
    const target = e.target.closest(".favorite-toggle");
    if (!target) return;

    const sym = target.dataset.symbol;
    toggleFavorite(sym);

    // update tampilan bintang langsung
    if (favorites.has(sym)) {
      target.textContent = "★";
      target.classList.add("favorited");
    } else {
      target.textContent = "☆";
      target.classList.remove("favorited");
    }
  });
  container._favHandlerAttached = true;
}

/* -------------------- Row & cell helpers -------------------- */
function createNewRow(symbol) {
  const row = document.createElement("tr");
  row.setAttribute("data-symbol", symbol);

  const isFav = favorites.has(symbol);
  const favClass = isFav ? "favorited" : "";
  const star = isFav ? "★" : "☆";

  let rowHtml = `
    <td>
      <span class="favorite-toggle ${favClass}" data-symbol="${symbol}" style="cursor:pointer; margin-right:6px;">
        ${star}
      </span>
      ${symbol}
    </td>
  `;

  // idx-ex
  activeExchanges.forEach((ex) => {
    const allowedConfig = filterConfig[ex] || {};
    if (allowedConfig[`idx-${ex}`] === true) {
      rowHtml += `<td data-exchange="idx-${ex}">-</td>`;
    }
  });
  // ex-idx
  activeExchanges.forEach((ex) => {
    const allowedConfig = filterConfig[ex] || {};
    if (allowedConfig[`${ex}-idx`] === true) {
      rowHtml += `<td data-exchange="${ex}-idx">-</td>`;
    }
  });

  row.innerHTML = rowHtml;
  return row;
}


// Tambahkan state untuk melacak click timeout
const clickProtection = new Map();

// Update fungsi updateRowData - ganti yang lama dengan ini
function updateRowData(row, exchangeName, data) {
  const formatGap = (gap, symbol, exchange, key) => {
    if (gap == null) return '-';
    let color = 'white', arrow = '';
    if (gap >= 10) { color = 'yellow'; arrow = '▲'; }
    else if (gap <= -10){ color = 'yellow'; arrow = '▼'; }
    else if (gap >= 5) { arrow = '▲'; }
    else if (gap <= -5) { arrow = '▼'; }
    else if (gap > 0) { color = 'lightgreen'; arrow = '▲'; }
    else if (gap < 0) { color = 'red'; arrow = '▼'; }

    return `<span class="clickable-gap"
              data-symbol="${symbol}"
              data-exchange="${exchange}"
              data-key="${key}"
              data-gap="${gap}"
              style="color:${color};cursor:pointer;background-color:transparent;">${arrow} ${gap.toFixed(2)}%</span>`;
  };

  const symbol = row.getAttribute('data-symbol');

  const applyUpdate = (cell, newValue, keyName) => {
    if (!cell) return;
    
    const oldSpan = cell.querySelector('.clickable-gap');
    const oldValue = oldSpan ? parseFloat(oldSpan.dataset.gap) : null;
    
    const elementKey = `${symbol}-${exchangeName}-${keyName}`;
    
    // Cek apakah ada perubahan nilai yang signifikan
    if (oldSpan && oldValue !== null && newValue !== null && !isNaN(newValue)) {
      const hasSignificantChange = Math.abs(newValue - oldValue) > 0.01; // threshold 0.01%
      
      if (hasSignificantChange) {
        // Update hanya text dan data attributes, jangan replace seluruh innerHTML
        let arrow = '';
        if (newValue >= 10) arrow = '▲';
        else if (newValue <= -10) arrow = '▼';
        else if (newValue >= 5) arrow = '▲';
        else if (newValue <= -5) arrow = '▼';
        else if (newValue > 0) arrow = '▲';
        else if (newValue < 0) arrow = '▼';
        
        oldSpan.textContent = `${arrow} ${newValue.toFixed(2)}%`;
        oldSpan.dataset.gap = newValue;
        
        // Update color
        let color = 'white';
        if (newValue >= 10) color = 'yellow';
        else if (newValue <= -10) color = 'yellow';  
        else if (newValue > 0) color = 'lightgreen';
        else if (newValue < 0) color = 'red';
        
        oldSpan.style.color = color;

        // Flash animation hanya jika tidak ada click protection
        if (!clickProtection.has(elementKey)) {
          const span = cell.querySelector('.clickable-gap');
          if (newValue > oldValue) {
            span.style.backgroundColor = 'rgba(0, 255, 0, 0.15)';
            setTimeout(() => {
              // Reset background span ke transparent
              span.style.backgroundColor = 'transparent';
            }, 80);
          } else if (newValue < oldValue) {
            span.style.backgroundColor = 'rgba(255, 0, 0, 0.15)';
            setTimeout(() => {
              // Reset background span ke transparent
              span.style.backgroundColor = 'transparent';
            }, 80);
          }
        }
      }
    } else {
      // First time atau tidak ada oldSpan, baru replace innerHTML
      cell.innerHTML = formatGap(newValue, symbol, exchangeName, keyName);
    }
  };

  applyUpdate(row.querySelector(`td[data-exchange="idx-${exchangeName}"]`), data[`idx-${exchangeName}`], `idx-${exchangeName}`);
  applyUpdate(row.querySelector(`td[data-exchange="${exchangeName}-idx"]`), data[`${exchangeName}-idx`], `${exchangeName}-idx`);
}


/* -------------------- Click handling -------------------- */

function handleGapClick(symbol, exchange, key, gap) {
  window.l2ElectronAPI.sendOrderbookRequest('l2-orderbook-request', { symbol, exchange });
  const modal = document.getElementById('orderbookModal');
  if (!modal) return;
  modal.style.display = 'block';
  modal.dataset.key = key;
  const title = document.getElementById('modalTitle');
  const content = document.getElementById('modalContent');
  if (title) title.innerText = `Detail ${symbol} - ${exchange} - ${key}`;
  if (content) content.innerHTML = '<div style="padding: 10px; text-align: center;">Loading...</div>';
}

// Update setupGapClickHandlers - ganti yang lama dengan ini
function setupGapClickHandlers() {
  const container = document.getElementById("global-section");
  if (!container) return;

  if (container._gapHandlerAttached) return;
  
  // Click handler - gunakan mousedown agar lebih responsif
  container.addEventListener('mousedown', (e) => {
    const target = e.target.closest('.clickable-gap');
    if (!target) return;
    
    e.preventDefault(); // Prevent text selection
    
    // Langsung eksekusi click handler
    handleGapClick(
      target.dataset.symbol,
      target.dataset.exchange,
      target.dataset.key,
      target.dataset.gap
    );
    
    const elementKey = `${target.dataset.symbol}-${target.dataset.exchange}-${target.dataset.key}`;
    
    // Set protection untuk mencegah flash bersamaan dengan click
    clickProtection.set(elementKey, true);
    setTimeout(() => {
      clickProtection.delete(elementKey);
    }, 200);
    
    // Visual feedback immediate
    target.style.backgroundColor = 'rgba(255, 255, 255, 0.4)';
    target.style.transform = 'scale(0.98)';
  });

  // Hover effects - langsung ke span element
  container.addEventListener('mouseover', (e) => {
    if (!e.target.classList.contains('clickable-gap')) return;
    const target = e.target;
    
    target.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    target.style.transform = 'scale(1.02)';
  });

  container.addEventListener('mouseout', (e) => {
    if (!e.target.classList.contains('clickable-gap')) return;
    const target = e.target;
    
    target.style.backgroundColor = 'transparent';
    target.style.transform = 'scale(1)';
  });
  
  container._gapHandlerAttached = true;
}

/* -------------------- Utils -------------------- */

function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

/* -------------------- Boot -------------------- */

document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('orderbookModal');
  if (modal) modal.style.display = 'none';
  initializeL2Orderbook();
  if (typeof setActiveSidebar === 'function') setActiveSidebar('l2-orderbook');
});


// Orderbook Modal Section
const lastGaps = {};
let currentCurrency = "IDR";
document.getElementById("currencySwitchBtn").addEventListener("click", () => {
  console.log("Currecny Clicked")
  currentCurrency = currentCurrency === "IDR" ? "USD" : "IDR";
  document.getElementById("currencySwitchBtn").innerText = `Switch to ${currentCurrency === "IDR" ? "USD" : "IDR"}`;
  renderCombinedOrderbook(lastSymbol, lastExchange, lastGap, lastKey);
});
document.getElementById('closeOrderbookModal').addEventListener('click', () => {
  document.getElementById('orderbookModal').style.display = 'none';
  const modalTitle = document.getElementById('modalTitle').innerText;
  const symbolMatch = modalTitle.match(/Detail\s+(\S+)\s*-\s*(\S+)/);
  const symbol = symbolMatch ? symbolMatch[1] : null;
  const exchange = symbolMatch ? symbolMatch[2] : null;
  if (symbol && exchange) {window.l2ElectronAPI.sendOrderbookRequest('l2-orderbook-close', { symbol, exchange });}
});
const latestOrders = {};
window.l2ElectronAPI.receiveOrderbookResponse('l2-orderbook-response', ({ symbol, exchange, orders }) => {
  if (!latestOrders[exchange]) latestOrders[exchange] = [];
  if (!latestOrders['indodax']) latestOrders['indodax'] = [];
  if (orders[exchange]) {latestOrders[exchange] = orders[exchange];}
  if (orders.indodax) {latestOrders.indodax = orders.indodax;}
  const modal = document.getElementById('orderbookModal');
  if (modal.style.display === 'block') {
    const modalTitle = document.getElementById('modalTitle').innerText;
    const symbolMatch = modalTitle.match(/Detail\s+(\S+)\s*-\s*(\S+)/)
    const currentSymbol = symbolMatch ? symbolMatch[1] : null;
    const currentExchange = symbolMatch ? symbolMatch[2] : null;
    if (currentSymbol === symbol && currentExchange === exchange) {
      const gapKey = `${exchange}-${symbol}`;
      const gap = lastGaps[gapKey] || 0;
      const key = modal.dataset.key
      renderCombinedOrderbook(symbol, exchange, gap, key);
    }
  }
});
function getOrdersByTypeAndSymbol(orders, type, symbol) {
  if (!orders || !Array.isArray(orders)) return [];
  const s = symbol.toLowerCase();
  return orders.filter(o => o.type === type && (o.symbol ? o.symbol.toLowerCase() === s : true));
}
function renderCombinedOrderbook(symbol, exchange, gap, key) {
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
  if (key !== "indodax") {
    leftOrders = otherAsks;
    rightOrders = indodaxBids;
    leftHeaderText = `${exchange.toUpperCase()} SELL Price`;
    rightHeaderText = 'IDX BUY Price';
    leftType = 'sell';
    rightType = 'buy';
  } else if (key === "indodax") {
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
  if (modalContent) {modalContent.innerHTML = html;}
  else {
    const modal = document.getElementById('orderbookModal');
    const newContent = document.createElement('div');
    newContent.id = 'modalContent';
    newContent.style.marginTop = '20px';
    newContent.innerHTML = html;
    modal.appendChild(newContent);
  }
}


function setActiveSidebar(action) {
  document.querySelectorAll('.dropdown-item').forEach(item => {
    if (item.dataset.action === action) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

const floatingMenuButton = document.getElementById('floating-menu-button');
const dropdownMenu = document.getElementById('dropdown-menu');

let sidebarOpen = false;

floatingMenuButton?.addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('orderbookModal').style.display = 'none';

  if (sidebarOpen) {
    anime({
      targets: dropdownMenu,
      right: '-280px',
      easing: 'easeInOutQuad',
      duration: 300
    });
    anime({
      targets: floatingMenuButton,
      right: '0px',
      easing: 'easeInOutQuad',
      duration: 300,
      complete: () => { 
        sidebarOpen = false;
        floatingMenuButton.classList.remove('open');
      }
    });
  } else {
    // Buka sidebar dan button bergerak bersamanya
    anime({
      targets: dropdownMenu,
      right: '0px',
      easing: 'easeInOutQuad',
      duration: 300,
      begin: () => { dropdownMenu.classList.add('show'); }
    });
    anime({
      targets: floatingMenuButton,
      right: '260px',
      easing: 'easeInOutQuad',
      duration: 300,
      complete: () => { 
        sidebarOpen = true;
        floatingMenuButton.classList.add('open');
      }
    });
  }
});

// Klik luar sidebar → tutup
document.addEventListener('click', (e) => {
  if (sidebarOpen && !dropdownMenu.contains(e.target) && !floatingMenuButton.contains(e.target)) {
    anime({
      targets: dropdownMenu,
      right: '-280px',
      easing: 'easeInOutQuad',
      duration: 300
    });
    anime({
      targets: floatingMenuButton,
      right: '0px',
      easing: 'easeInOutQuad',
      duration: 300,
      complete: () => { 
        sidebarOpen = false; 
        floatingMenuButton.classList.remove('open');
      }
    });
  }
});

// Klik item sidebar
document.addEventListener('click', (e) => {
  const dropdownItem = e.target.closest('.dropdown-item');
  if (dropdownItem) {
    const action = dropdownItem.dataset.action;
    anime({
      targets: dropdownMenu,
      right: '-280px',
      easing: 'easeInOutQuad',
      duration: 300
    });
    anime({
      targets: floatingMenuButton,
      right: '0px',
      easing: 'easeInOutQuad',
      duration: 300,
      complete: () => { 
        sidebarOpen = false; 
        floatingMenuButton.classList.remove('open');
      }
    });
    switch (action) {
      case 'last-price':
        window.dashboardAPI.navigate('dashboard')
        break
      case 'dashboard-management':
        window.dashboardAPI.navigate('manajemen');
        break;
      case 'logout':
        window.dashboardAPI.clearToken();
        window.dashboardAPI.navigate('loginPage');
        break
      default:
        console.log(`Unknown action: ${action}`);
    }
  }
});

// Esc key → tutup
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sidebarOpen) {
    anime({
      targets: dropdownMenu,
      right: '-280px',
      easing: 'easeInOutQuad',
      duration: 300
    });
    anime({
      targets: floatingMenuButton,
      right: '0px',
      easing: 'easeInOutQuad',
      duration: 300,
      complete: () => { 
        sidebarOpen = false; 
        floatingMenuButton.classList.remove('open');
      }
    });
  }
});

async function checkSession() {
    const result = await window.dashboardAPI.sessionCheck();
    console.log(result)
    if (!result.success) {
        showCustomAuthAlert("Unauthorized", result.message, () => {
            window.dashboardAPI.navigate('loginPage');
        });
    }
}

["click", "keydown"].forEach(evt => {
    window.addEventListener(evt, () => checkSession());
});

function showCustomAuthAlert(title, message, onConfirm) {
    const existing = document.querySelector(".custom-auth-alert");
    if (existing) existing.remove();

    const wrapper = document.createElement("div");
    wrapper.className = "custom-auth-alert";
    wrapper.innerHTML = `
      <div class="custom-auth-alert-content">
        <h3>${title}</h3>
        <p>${message}</p>
        <div class="custom-auth-alert-buttons">
          <button class="primary" id="okBtn">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper);

    // tombol event
    document.getElementById("okBtn").onclick = () => {
        wrapper.remove();
        if (onConfirm) onConfirm();
    };
}
