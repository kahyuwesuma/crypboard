function toggleSection(section) {
    const content = document.getElementById(`${section}-content`);
    const arrow = document.getElementById(`${section}-arrow`);
    
    content.classList.toggle('show');
    arrow.classList.toggle('active');
}
document.getElementById('management-button').addEventListener('click', () => {
  window.dashboardAPI.navigate('dashboard');
});

let statusSortState = 0; 

document.getElementById('sortStatusBtn').addEventListener('click', () => {
  statusSortState = (statusSortState + 1) % 3; // cycle 0 → 1 → 2 → 0
  loadData();
});

async function loadData() {
  // Exchange Section
  const exchange = await window.managementAPI.getAllExchange();
  const tbodyExchange = document.getElementById('exchangeTableBody');
  tbodyExchange.innerHTML = '';


  exchange.forEach((exchange, index) => {
    const trExchange = document.createElement('tr');
    trExchange.innerHTML = `
      <td>
        <input type="checkbox" onclick="toggleActiveExchange('${exchange.name}')" ${exchange.active ? 'checked' : ''}>
      </td>
      <td class="symbol-cell">${exchange.name}</td>
      <td class="${exchange.active ? 'status-active' : 'status-inactive'}">
        ${exchange.active ? 'Aktif' : 'Tidak Aktif'}
      </td>

      <td>
        <button class="action-btn toggle" onclick="editSymbolCell(this, '${exchange.name}')">Update</button>
        <button class="action-btn delete" onclick="deleteSymbol('${exchange.name}')">Hapus</button>
      </td>
    `;
    tbodyExchange.appendChild(trExchange);
  });

  // Symbol Section
  const symbols = await window.managementAPI.getAllSymbols();
  const searchValue = document.getElementById('searchSymbol').value.toLowerCase();
  const tbody = document.getElementById('symbolTableBody');
  tbody.innerHTML = '';
  // Hitung jumlah aktif
  const activeCount = symbols.filter(s => s.active).length;

  // Update tampilan jumlah aktif
  document.getElementById('active-symbol-count').textContent = `Aktif: ${activeCount}`;
  // Filter berdasarkan search
  let filteredSymbols = symbols.filter(s => s.symbol.toLowerCase().includes(searchValue));

  // Sort berdasarkan state tombol
  if (statusSortState === 1) {
    // Ascending: Aktif paling atas
    filteredSymbols.sort((a, b) => {
      if (a.active === b.active) return 0;
      return a.active ? -1 : 1;
    });
  } else if (statusSortState === 2) {
    // Descending: Tidak aktif paling atas
    filteredSymbols.sort((a, b) => {
      if (a.active === b.active) return 0;
      return a.active ? 1 : -1;
    });
  }
  // statusSortState === 0 → load tanpa sort (susunan asli)

  filteredSymbols.forEach((symbol, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <input type="checkbox" onclick="toggleActive('${symbol.symbol}')" ${symbol.active ? 'checked' : ''}>
      </td>
      <td class="symbol-cell">${symbol.symbol}</td>
      <td class="${symbol.active ? 'status-active' : 'status-inactive'}">
			  ${symbol.active ? 'Aktif' : 'Tidak Aktif'}
			</td>

      <td>
        <button class="action-btn toggle" onclick="editSymbolCell(this, '${symbol.symbol}')">Update</button>
        <button class="action-btn delete" onclick="deleteSymbol('${symbol.symbol}')">Hapus</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Fungsi untuk mengubah sel menjadi input
function editSymbolCell(button, oldSymbol) {
  const cell = button.closest('tr').querySelector('.symbol-cell');
  console.log(cell)
  const currentValue = cell.textContent;

  // Buat input
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentValue;
  input.style.width = '60%';
  input.style.padding = '6px 8px';
  input.style.marginRight = '5px';
  input.style.borderRadius = '6px';
  input.style.border = '1px solid rgba(255,255,255,0.2)';
  input.style.background = 'rgba(255,255,255,0.1)';
  input.style.color = '#ffffff';

  // Buat tombol cancel
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '×';
  cancelBtn.className = 'action-btn delete';
  cancelBtn.style.padding = '6px 12px';
  cancelBtn.style.fontSize = '0.8rem';
  cancelBtn.title = 'Batal';
  cancelBtn.addEventListener('click', () => loadData());

  // Event keydown: Enter simpan, Escape batal
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const newSymbol = input.value.trim();
      if (newSymbol && newSymbol !== oldSymbol) {
        const res = await window.managementAPI.updateSymbol({ symbol: oldSymbol, newSymbol });
        if (res.success) {
        	showAlert(res.message, res.success ? 'success' : 'error');
          loadData();
        } else {
          showAlert(res.message, res.success ? 'success' : 'error');
          loadData();
        }
      } else {
        loadData(); // cancel edit
      }
    } else if (e.key === 'Escape') {
      loadData(); // cancel edit
    }
  });

  // Render input + tombol cancel di sel
  cell.innerHTML = '';
  cell.appendChild(input);
  cell.appendChild(cancelBtn);
  input.focus();
}

async function toggleActiveExchange(exchangeName) {
  const exchage = await window.managementAPI.getAllExchange();
  const exchangeData = exchage.find(e => e.name === exchangeName);
  // console.log(exchangeName)

  if (!exchangeData) return;

  // Toggle status
  exchangeData.active = !exchangeData.active;

  // Update ke database/storage
  await window.managementAPI.updateExchange(exchangeData);

  // Alert sesuai status
  if (exchangeData.active) {
    showAlert(`Exchange ${exchangeName} berhasil diaktifkan!`, 'success');
  } else {
    showAlert(`Exchange ${exchangeName} berhasil dinonaktifkan!`, 'error');
  }

  // Reload tabel
  loadData();
}

async function toggleActive(symbolName) {
  const symbols = await window.managementAPI.getAllSymbols();
  const symbolData = symbols.find(s => s.symbol === symbolName);

  if (!symbolData) return;

  const wasActive = symbolData.active; // Simpan status awal
  const activeCount = symbols.filter(s => s.active).length;

  // // Kalau mau mengaktifkan tapi sudah 100 aktif
  // if (!wasActive) {
  //   showAlert("Batas maksimal 100 symbol aktif sudah tercapai!", 'error');

  //   // Revert checkbox di DOM
  //   const checkboxes = document.querySelectorAll(`#symbolTableBody input[type="checkbox"]`);
  //   const checkbox = [...checkboxes].find(cb => cb.onclick.toString().includes(`'${symbolName}'`));
  //   if (checkbox) checkbox.checked = false;

  //   return;
  // }

  // Toggle status
  symbolData.active = !symbolData.active;

  // Update ke database/storage
  await window.managementAPI.updateSymbol(symbolData);

  // Alert sesuai status
  if (symbolData.active) {
    showAlert(`Symbol ${symbolName} berhasil diaktifkan!`, 'success');
  } else {
    showAlert(`Symbol ${symbolName} berhasil dinonaktifkan!`, 'error');
  }

  // Reload tabel
  loadData();
}

async function deleteSymbol(symbol) {
	const res = await window.managementAPI.removeSymbols(symbol);
	if (res.success) {
		showAlert(res.message, 'error');
		loadData();
	} else {
		showAlert(res.message, res.success ? 'success' : 'error');
	}
}

document.getElementById('formAdd').addEventListener('submit', async (e) => {
	e.preventDefault();
	const symbol = document.getElementById('addSymbol').value.trim();
	const res = await window.managementAPI.addSymbols(symbol);
	if (res.success) {
		showAlert(res.message, res.success ? 'success' : 'error');
	} else {
		showAlert(res.message, res.success ? 'success' : 'error');	
	}
	document.getElementById('addSymbol').value = '';
	loadData();
});





function showAlert(message, type = 'error', duration = 2500) {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'custom-alert ' + type; // tambahkan class error/success
    alertDiv.textContent = message;
    document.body.appendChild(alertDiv);

    // trigger fade in + slide
    setTimeout(() => alertDiv.classList.add('show'), 10);

    // fade out + slide out setelah duration
    setTimeout(() => {
        alertDiv.classList.remove('show');
        setTimeout(() => alertDiv.remove(), 300);
    }, duration);
}


loadData();