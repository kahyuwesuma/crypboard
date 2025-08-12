// renderTable.js
const lastGapValues = {};

export function renderTableImmediate(exchange, allExchangeData, favoriteSymbolsPerExchange) {
  const tbody = document.getElementById(`${exchange}TableBody`);
  const searchValue = document.getElementById(`search-${exchange}`)?.value?.toUpperCase() || '';
  const data = allExchangeData[exchange] || [];

  if (!tbody) return;

  const fragment = document.createDocumentFragment();
  const favSet = new Set(favoriteSymbolsPerExchange[exchange] || []);

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

    let colorClass = '';
    let arrow = '';

    if (gap > 0 && gap < 5) {
      colorClass = 'lightgreen';
      arrow = '▲';
    } else if (gap < 0 && gap > -5) {
      colorClass = 'red';
      arrow = '▼';
    } else if (Math.abs(gap) >= 10) {
      colorClass = 'yellow';
    } else if (Math.abs(gap) >= 5) {
      colorClass = 'white';
    }

    const tr = document.createElement('tr');

    // --- Highlight perubahan gap ---
    const key = `${exchange}_${symbol}`;
    const prevGap = lastGapValues[key];
    let flashClass = '';

    if (prevGap !== undefined && prevGap !== gap) {
      flashClass = gap > prevGap ? 'flash-green' : 'flash-red';
    }
    lastGapValues[key] = gap;
    // -------------------------------

    tr.innerHTML = `
      <td>
        <span class="favorite-toggle" data-symbol="${symbol}" data-exchange="${exchange}" style="cursor:pointer; margin-left:6px;">
          ${star}
        </span>
        ${symbol}
      </td>
      <td>${priceA}</td>
      <td>${priceB}</td>
      <td>
        <button class="gap-button ${flashClass}" style="color: ${colorClass};" data-symbol="${symbol}" data-exchange="${exchange}">
          ${arrow} ${gap}%
        </button>
      </td>
    `;

    // Hapus class flash setelah animasi selesai
    if (flashClass) {
      setTimeout(() => {
        tr.querySelector('.gap-button')?.classList.remove(flashClass);
      }, 500); // durasi sesuai animasi CSS
    }

    fragment.appendChild(tr);
  });

  tbody.innerHTML = '';
  tbody.appendChild(fragment);
}
