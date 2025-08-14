document.getElementById('management-button').addEventListener('click', () => {
  window.dashboardAPI.navigate('dashboard');
});

let statusSortState = 0; 
// 0 = default (susunan asli)
// 1 = sort ascending
// 2 = sort descending

document.getElementById('sortStatusBtn').addEventListener('click', () => {
  statusSortState = (statusSortState + 1) % 3; // cycle 0 → 1 → 2 → 0
  loadSymbols();
});

async function loadSymbols() {
  const symbols = await window.managementAPI.getAll();
  const searchValue = document.getElementById('searchSymbol').value.toLowerCase();
  const tbody = document.getElementById('symbolTableBody');
  tbody.innerHTML = '';

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
      <td>${index + 1}</td>
      <td class="symbol-cell">${symbol.symbol}</td>
      <td class="${symbol.active ? 'status-active' : 'status-inactive'}">
			  ${symbol.active ? 'Aktif' : 'Tidak Aktif'}
			</td>

      <td>
        <button class="action-btn edit" onclick="toggleActive('${symbol.symbol}')">
          ${symbol.active ? 'Nonaktifkan' : 'Aktifkan'}
        </button>
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
  cancelBtn.addEventListener('click', () => loadSymbols());

  // Event keydown: Enter simpan, Escape batal
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const newSymbol = input.value.trim();
      if (newSymbol && newSymbol !== oldSymbol) {
        const res = await window.managementAPI.update({ symbol: oldSymbol, newSymbol });
        if (res.success) {
        	showAlert(res.message, res.success ? 'success' : 'error');
          loadSymbols();
        } else {
          showAlert(res.message, res.success ? 'success' : 'error');
          loadSymbols();
        }
      } else {
        loadSymbols(); // cancel edit
      }
    } else if (e.key === 'Escape') {
      loadSymbols(); // cancel edit
    }
  });

  // Render input + tombol cancel di sel
  cell.innerHTML = '';
  cell.appendChild(input);
  cell.appendChild(cancelBtn);
  input.focus();
}
async function toggleActive(symbolName) {
  const symbols = await window.managementAPI.getAll();
  const symbolData = symbols.find(s => s.symbol === symbolName);

  if (!symbolData) return;

  // Hitung jumlah yang aktif
  const activeCount = symbols.filter(s => s.active).length;

  // Kalau mau mengaktifkan tapi sudah 100 aktif, stop
  if (!symbolData.active && activeCount >= 100) {
  	showAlert("Batas maksimal 100 symbol aktif sudah tercapai!", 'error');
    return;
  }

  // Ubah status active
  symbolData.active = !symbolData.active;

  // Update ke database/storage
  await window.managementAPI.update(symbolData);
  // Tampilkan alert sesuai status
  if (symbolData.active) {
    showAlert(`Symbol ${symbolName} berhasil diaktifkan!`, 'success');
  } else {
    showAlert(`Symbol ${symbolName} berhasil dinonaktifkan!`, 'error');
  }

  // Reload tabel
  loadSymbols();
}
async function deleteSymbol(symbol) {
	const res = await window.managementAPI.remove(symbol);
	if (res.success) {
		showAlert(res.message, 'error');
		loadSymbols();
	} else {
		showAlert(res.message, res.success ? 'success' : 'error');
	}
}

document.getElementById('formAdd').addEventListener('submit', async (e) => {
	e.preventDefault();
	const symbol = document.getElementById('addSymbol').value.trim();
	const res = await window.managementAPI.add(symbol);
	if (res.success) {
		showAlert(res.message, res.success ? 'success' : 'error');
	} else {
		showAlert(res.message, res.success ? 'success' : 'error');	
	}
	document.getElementById('addSymbol').value = '';
	loadSymbols();
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


loadSymbols();