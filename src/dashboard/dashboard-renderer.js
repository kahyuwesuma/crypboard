// document.getElementById('management-button').addEventListener('click', async () => {
//   // const result = await window.middleware.doSecureAction();
//   // console.log(result);
//   // if (!result.success) {
//   //     alert('Unauthorized! Silakan login lagi.');
//       window.dashboardAPI.navigate('manajemen');
//   // } else {
//   //     alert(result.message);
//   //     window.dashboardAPI.navigate('manajemen');
//   // }
// })

   // Core functionality
    const { formatPrice } = window.utils;

    let currentUsdtIdrRate = 15800;
    let activeExchanges = [];
    const allExchangeData = {};
    const favoriteSymbolsPerExchange = JSON.parse(localStorage.getItem('favoriteSymbolsPerExchange') || '{}');
    const lastGaps = {};
    const pendingRenders = new Set();
    let isRendering = false;

    // Header data handler
    window.indodaxAPI.onHeaderData((data) => {
      const { btcIdr, btcUsdt, usdtIdr } = data;
      currentUsdtIdrRate = usdtIdr;
      document.getElementById("btcIdr").innerText = formatPrice(btcIdr, "IDR") || "-";
      document.getElementById("btcUsdt").innerText = formatPrice(btcUsdt, "USD") || "-";
      document.getElementById("usdtIdr").innerText = formatPrice(usdtIdr, "IDR") || "-";
    });

    // Utility functions
    function debounce(fn, delay) {
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), delay);
      };
    }

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

    // Generate exchange section HTML
    function createExchangeSection(exchangeName) {
      return `
        <div class="exchange-section" id="${exchangeName}-section">
          <div class="exchange-header">
            <div class="header-left">
              <h2 class="exchange-title">${exchangeName}</h2>
              <svg class="connection-bars" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12.55a11 11 0 0 1 14.08 0" class="level1"></path>
                <path d="M1.42 9a16 16 0 0 1 21.16 0" class="level2"></path>
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" class="level3"></path>
                <line x1="12" y1="20" x2="12" y2="20" class="level4"></line>
              </svg>
            </div>
            <div class="search-container">
              <input type="text" id="search-${exchangeName}" class="search-input" placeholder="Search..." />
            </div>
          </div>
          <div class="table-container">
            <table class="crypto-table">
              <thead>
                <tr>
                  <th>Pair Coin</th>
                  <th>Harga IDX</th>
                  <th>Harga ${exchangeName}</th>
                  <th>Gap</th>
                </tr>
              </thead>
              <tbody id="${exchangeName}TableBody">
                <tr><td colspan="4" class="no-data">Loading...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // Dynamic grid layout based on screen size and exchange count
    function updateGridLayout() {
      const container = document.getElementById('dashboard-container');
      const exchangeCount = activeExchanges.length;
      const screenWidth = window.innerWidth;
      
      if (screenWidth >= 1200) {
        // Desktop: Try to maintain 8 visible without scroll
        const maxVisible = Math.min(8, exchangeCount);
        if (maxVisible <= 4) {
          container.style.gridTemplateColumns = `repeat(${Math.min(4, maxVisible)}, 1fr)`;
          container.style.gridTemplateRows = 'repeat(1, 1fr)';
        } else if (maxVisible <= 8) {
          container.style.gridTemplateColumns = 'repeat(4, 1fr)';
          container.style.gridTemplateRows = 'repeat(2, 1fr)';
        } else {
          container.style.gridTemplateColumns = 'repeat(4, 1fr)';
          container.style.gridTemplateRows = 'auto';
          container.style.overflowY = 'auto';
        }
      } else if (screenWidth >= 900) {
        // Tablet landscape
        container.style.gridTemplateColumns = 'repeat(3, 1fr)';
        container.style.gridTemplateRows = 'auto';
        container.style.overflowY = 'auto';
      } else if (screenWidth >= 600) {
        // Tablet portrait
        container.style.gridTemplateColumns = 'repeat(2, 1fr)';
        container.style.gridTemplateRows = 'auto';
        container.style.overflowY = 'auto';
      } else {
        // Mobile
        container.style.gridTemplateColumns = '1fr';
        container.style.gridTemplateRows = 'auto';
        container.style.overflowY = 'auto';
      }
    }

    // Load and render active exchanges
    async function initializeDashboard() {
      try {
        activeExchanges = await window.dashboardAPI.getActiveExchange();
        console.log('Active exchanges:', activeExchanges);
        
        const container = document.getElementById('dashboard-container');
        container.innerHTML = '';
        
        // Create sections for active exchanges
        activeExchanges.forEach(exchange => {
          container.innerHTML += createExchangeSection(exchange);
        });
        
        // Update grid layout
        updateGridLayout();
        
        // Set up event listeners and data handlers
        setupExchangeHandlers();
        
      } catch (error) {
        console.error('Failed to load active exchanges:', error);
        // Fallback to default exchanges
        activeExchanges = ['binance', 'okx', 'kucoin', 'bybit'];
        const container = document.getElementById('dashboard-container');
        container.innerHTML = '';
        activeExchanges.forEach(exchange => {
          container.innerHTML += createExchangeSection(exchange);
        });
        updateGridLayout();
        setupExchangeHandlers();
      }
    }

    // Setup event handlers for exchanges
    function setupExchangeHandlers() {
      activeExchanges.forEach((exchange) => {
        const searchInput = document.getElementById(`search-${exchange}`);

        // Market data handler
        window.marketAPI.onExchangeUpdate(exchange, (data) => {
          allExchangeData[exchange] = data;
          pendingRenders.add(exchange);
          debouncedBatchRender();
        });

        // Search input handler
        searchInput?.addEventListener('input', debounce(() => {
          renderTable(exchange);
        }, 300));
      });

      // Add event delegation for dynamic buttons
      document.addEventListener('click', (e) => {
        if (e.target.classList.contains('favorite-toggle')) {
          const symbol = e.target.dataset.symbol;
          const exchange = e.target.dataset.exchange;
          toggleFavorite(exchange, symbol);
          renderTable(exchange);
        }
        
        if (e.target.classList.contains('gap-button')) {
          const symbol = e.target.dataset.symbol;
          const exchange = e.target.dataset.exchange;
          // Handle gap button click (orderbook modal, etc.)
          console.log(`Gap button clicked: ${exchange} ${symbol}`);
        }
      });
    }

    // Batch rendering
    const debouncedBatchRender = debounce(() => {
      if (pendingRenders.size > 0 && !isRendering) {
        isRendering = true;
        const exchangesToRender = Array.from(pendingRenders);
        pendingRenders.clear();
        
        requestAnimationFrame(() => {
          exchangesToRender.forEach(exchange => {
            if (activeExchanges.includes(exchange)) {
              renderTableImmediate(exchange);
            }
          });
          isRendering = false;
        });
      }
    }, 100);

    // Render table function
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

      const finalData = [...favorites, ...nonFavorites];

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
        lastGaps[gapKey] = gap;

        let highlightClass = '';
        if (prevGap !== undefined) {
          if (gap > prevGap) {
            highlightClass = 'flash-green';
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

    // Public render function with debounce (for search)
    const renderTable = debounce((exchange) => {
      renderTableImmediate(exchange);
    }, 150);

    // Window resize handler
    window.addEventListener('resize', debounce(() => {
      updateGridLayout();
    }, 250));

    // Initialize dashboard when page loads
    document.addEventListener('DOMContentLoaded', () => {
      const modal = document.getElementById('orderbookModal');
      modal.style.display = 'none';
      initializeDashboard();
    });

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
// Function untuk reset modal state
function resetModalState() {
    const modal = document.getElementById('orderbookModal');
    const modalContent = document.getElementById('modalContent');
    const modalTitle = document.getElementById('modalTitle');
    
    if (modal) {
        modal.style.display = 'none';
    }
    
    if (modalContent) {
        modalContent.innerHTML = '';
    }
    
    if (modalTitle) {
        modalTitle.textContent = 'Order Book';
    }
    
    // Reset currency button state jika ada
    const currencyBtn = document.getElementById('currencySwitchBtn');
    if (currencyBtn) {
        currencyBtn.textContent = 'Switch to USD';
    }
}
    // Menu dropdown functionality
    const menuButton = document.getElementById('menu-button');
    const dropdownMenu = document.getElementById('dropdown-menu');

    menuButton?.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Close any existing modals first
      document.getElementById('orderbookModal').style.display = 'none';
      
      // Toggle dropdown
      const isShown = dropdownMenu.classList.contains('show');
      if (isShown) {
        dropdownMenu.classList.remove('show');
      } else {
        // Position dropdown based on button position
        const buttonRect = menuButton.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        
        if (viewportWidth <= 600) {
          // Mobile positioning
          dropdownMenu.style.position = 'fixed';
          dropdownMenu.style.top = (buttonRect.bottom + 8) + 'px';
          dropdownMenu.style.right = '10px';
          dropdownMenu.style.left = 'auto';
        } else {
          // Desktop positioning
          dropdownMenu.style.position = 'fixed';
          dropdownMenu.style.top = (buttonRect.bottom + 8) + 'px';
          dropdownMenu.style.right = (viewportWidth - buttonRect.right) + 'px';
          dropdownMenu.style.left = 'auto';
        }
        
        dropdownMenu.classList.add('show');
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!menuButton?.contains(e.target) && !dropdownMenu?.contains(e.target)) {
        dropdownMenu?.classList.remove('show');
      }
    });

    // Handle dropdown item clicks
    document.addEventListener('click', (e) => {
      const dropdownItem = e.target.closest('.dropdown-item');
      if (dropdownItem) {
        const action = dropdownItem.dataset.action;
        dropdownMenu?.classList.remove('show');
        
        switch (action) {
          case 'dashboard-management':
            window.dashboardAPI.navigate('manajemen');  
            break;
          case 'refresh-data':
            console.log('Refresh data clicked');
            // Refresh all exchange data
            activeExchanges.forEach(exchange => {
              // Trigger data refresh for each exchange
              console.log(`Refreshing data for ${exchange}`);
            });
            break;
          case 'reset-layout':
            console.log('Reset layout clicked');
            // Reset layout to default
            updateGridLayout();
            break;
          case 'settings':
            console.log('Settings clicked');
            // Open settings modal or page
            break;
          default:
            console.log(`Unknown action: ${action}`);
        }
      }
    });

    // Close dropdown with Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dropdownMenu?.classList.remove('show');
      }
    });