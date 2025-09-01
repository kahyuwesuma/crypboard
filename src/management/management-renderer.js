   // Tab functionality
        let statusSortState = 0;

        function initTabs() {
            const tabButtons = document.querySelectorAll('.tab-button');
            const tabContents = document.querySelectorAll('.tab-content');
            const slider = document.querySelector('.tab-slider');

            function updateSlider(activeButton) {
                const rect = activeButton.getBoundingClientRect();
                const navRect = activeButton.parentElement.getBoundingClientRect();
                const left = rect.left - navRect.left;
                const width = rect.width;
                
                slider.style.left = left + 'px';
                slider.style.width = width + 'px';
            }

            tabButtons.forEach((button, index) => {
                button.addEventListener('click', () => {
                    // Remove active from all
                    tabButtons.forEach(btn => btn.classList.remove('active'));
                    tabContents.forEach(content => content.classList.remove('active'));
                    
                    // Add active to clicked
                    button.classList.add('active');
                    const tabId = button.getAttribute('data-tab');
                    document.getElementById(tabId).classList.add('active');
                    
                    // Update slider position
                    updateSlider(button);
                    
                    // Animate content
                    anime({
                        targets: `#${tabId}`,
                        opacity: [0, 1],
                        translateY: [20, 0],
                        duration: 300,
                        easing: 'easeOutQuart'
                    });
                });
            });

            // Initial slider position
            updateSlider(document.querySelector('.tab-button.active'));

            // Update slider on window resize
            window.addEventListener('resize', () => {
                updateSlider(document.querySelector('.tab-button.active'));
            });
        }

document.getElementById('sortStatusBtn').addEventListener('click', () => {
  statusSortState = (statusSortState + 1) % 3; // cycle 0 → 1 → 2 → 0
  loadData();
});

async function loadData() {
  // ======================
  // Exchange Section
  // ======================
  const exchange = await window.managementAPI.getAllExchange();
  const tbodyExchange = document.getElementById('exchangeTableBody');
  tbodyExchange.innerHTML = '';

  exchange.forEach((exchange, index) => {
    const trExchange = document.createElement('tr');
    trExchange.innerHTML = `
      <td>
        <input type="checkbox" onclick="toggleActiveExchange('${exchange.name}')" ${exchange.active ? 'checked' : ''}>
      </td>
      <td class="symbol-cell">${exchange.name.toUpperCase()}</td>
      <td class="${exchange.active ? 'status-active' : 'status-inactive'}">
        ${exchange.active ? 'Aktif' : 'Tidak Aktif'}
      </td>
    `;
    tbodyExchange.appendChild(trExchange);
  });

  // ======================
  // L2 Filter Section
  // ======================
  const l2Config = await window.managementAPI.getAllL2();
  const tbodyL2 = document.getElementById('l2TableBody');
  tbodyL2.innerHTML = '';

  Object.entries(l2Config).forEach(([exchangeName, config]) => {
    const exUpper = exchangeName.toUpperCase();
    const tr = document.createElement('tr');
    
    tr.innerHTML = `
      <td class="symbol-cell">${exUpper}</td>
      <td>
        <input type="checkbox" onclick="toggleL2Filter('${exchangeName}', 'idx-${exchangeName}')" 
               ${config[`idx-${exchangeName}`] ? 'checked' : ''}>
      </td>
      <td>
        <input type="checkbox" onclick="toggleL2Filter('${exchangeName}', '${exchangeName}-idx')" 
               ${config[`${exchangeName}-idx`] ? 'checked' : ''}>
      </td>
    `;
    tbodyL2.appendChild(tr);
  });

  // ======================
  // Symbol Section
  // ======================
  const symbols = await window.managementAPI.getAllSymbols();
  const searchValue = document.getElementById('searchSymbol').value.toLowerCase();
  const tbody = document.getElementById('symbolTableBody');
  tbody.innerHTML = '';

  const activeCount = symbols.filter(s => s.active).length;
  document.getElementById('active-symbol-count').textContent = `Aktif: ${activeCount}`;

  let filteredSymbols = symbols.filter(s => s.symbol.toLowerCase().includes(searchValue));

  if (statusSortState === 1) {
    filteredSymbols.sort((a, b) => {
      if (a.active === b.active) return 0;
      return a.active ? -1 : 1;
    });
  } else if (statusSortState === 2) {
    filteredSymbols.sort((a, b) => {
      if (a.active === b.active) return 0;
      return a.active ? 1 : -1;
    });
  }

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

  // ======================
  // Credentials Section
  // ======================
  const credContainer = document.getElementById('manage-credentials');
  credContainer.innerHTML = `
    <div class="card-container">

      <!-- Card Password -->
      <div class="card">
        <h3>Update User Password</h3>
        <div class="form-group">
          <label for="oldPassword">Old Password</label>
          <div class="input-wrapper">
            <input type="password" id="oldPassword" placeholder="Enter old password">
            <i class="fa-solid fa-eye toggle-visibility" onclick="toggleVisibility('oldPassword', this)"></i>
          </div>
        </div>
        <div class="form-group">
          <label for="newPassword">New Password</label>
          <div class="input-wrapper">
            <input type="password" id="newPassword" placeholder="Enter new password">
            <i class="fa-solid fa-eye toggle-visibility" onclick="toggleVisibility('newPassword', this)"></i>
          </div>
        </div>
        <div class="form-group">
          <label for="confirmPassword">Confirm Password</label>
          <div class="input-wrapper">
            <input type="password" id="confirmPassword" placeholder="Confirm new password">
            <i class="fa-solid fa-eye toggle-visibility" onclick="toggleVisibility('confirmPassword', this)"></i>
          </div>
        </div>
        <button class="action-btn save" onclick="updateUserPassword()">Simpan</button>
      </div>
      <!-- Card API Key -->
      <div class="card">
        <h3>Update MEXC API Credentials</h3>
        <div class="form-group">
          <label for="mexcApiKey">API Key</label>
          <div class="input-wrapper">
           <input type="password" id="mexcApiKey" placeholder="Enter new API Key">
            <i class="fa-solid fa-eye toggle-visibility" onclick="toggleVisibility('mexcApiKey', this)"></i>
          </div>
        </div>
          <button class="action-btn save" onclick="updateMexcCredentials()">Simpan</button>
        </div>
      </div>
  `;
}
// Credentials Section
function toggleVisibility(inputId, el) {
  const input = document.getElementById(inputId);
  if (input.type === "password") {
    input.type = "text";
    el.classList.remove("fa-eye");
    el.classList.add("fa-eye-slash");
  } else {
    input.type = "password";
    el.classList.remove("fa-eye-slash");
    el.classList.add("fa-eye");
  }
}

async function updateMexcCredentials(){
    const oldApiKey = await window.managementAPI.getMexcApiKey()
    const newApiKey = document.getElementById('mexcApiKey').value.trim();

    if (oldApiKey.apiKey === newApiKey){
      showAlert("API Key tidak boleh sama", 'error');
      return
    }

    if (!newApiKey) {
        showAlert("API Key tidak boleh kosong!", "error");
        return;
    }

    const res = await window.managementAPI.updateMexcApiKey(newApiKey);

    if (res.success) {
      showAlert(res.message, res.success ? 'success' : 'error');
      loadData();
    } else {
      showAlert(res.message, res.success ? 'success' : 'error');
      loadData();
    }    
}

async function updateUserPassword(){
    const oldPassword = document.getElementById('oldPassword').value.trim();
    const newPassword = document.getElementById('newPassword').value.trim();
    const confirmPassword = document.getElementById('confirmPassword').value.trim();

    if (!oldPassword || !newPassword || !confirmPassword){
        showAlert("Password tidak boleh kosong!", "error");
        return;
    }

    if (oldPassword === newPassword){
      showAlert("Password baru tidak boleh sama dengan password lama", 'error');
      return
    }

    if (newPassword !== confirmPassword){
      showAlert("Password konfirmasi tidak sama", 'error');
      return
    }


    const res = await window.managementAPI.updateUserPassword(oldPassword, newPassword);

    if (res.success) {
      showAlert(res.message, res.success ? 'success' : 'error');
      loadData();
    } else {
      showAlert(res.message, res.success ? 'success' : 'error');
      loadData();
    }    
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
        loadData(); 
      }
    } else if (e.key === 'Escape') {
      loadData(); 
    }
  });

  cell.innerHTML = '';
  cell.appendChild(input);
  cell.appendChild(cancelBtn);
  input.focus();
}

async function toggleActiveExchange(exchangeName) {
  const exchage = await window.managementAPI.getAllExchange();
  const exchangeData = exchage.find(e => e.name === exchangeName);

  if (!exchangeData) return;

  exchangeData.active = !exchangeData.active;

  await window.managementAPI.updateExchange(exchangeData);

  // Alert sesuai status
  if (exchangeData.active) {
    showAlert(`Exchange ${exchangeName} berhasil diaktifkan!`, 'success');
  } else {
    showAlert(`Exchange ${exchangeName} berhasil dinonaktifkan!`, 'error');
  }

  loadData();
}

async function toggleL2Filter(exchangeName, exchangeCombined) {
  const exchange = await window.managementAPI.getAllL2();
  const exchangeData = exchange[exchangeName];
  if (!exchangeData) return;

  exchangeData[exchangeCombined] = !exchangeData[exchangeCombined];
  
  await window.managementAPI.updateL2(exchangeName, exchangeCombined);

  // Alert sesuai status
  if (exchangeData[exchangeCombined]) {
    showAlert(`${exchangeCombined} berhasil diaktifkan!`, 'success');
  } else {
    showAlert(`${exchangeCombined} berhasil dinonaktifkan!`, 'error');
  }

  loadData();
}

async function toggleActive(symbolName) {
  const symbols = await window.managementAPI.getAllSymbols();
  const symbolData = symbols.find(s => s.symbol === symbolName);

  if (!symbolData) return;

  // const wasActive = symbolData.active; // Simpan status awal
  // const activeCount = symbols.filter(s => s.active).length;

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

  await window.managementAPI.updateSymbol(symbolData);

  if (symbolData.active) {
    showAlert(`Symbol ${symbolName} berhasil diaktifkan!`, 'success');
  } else {
    showAlert(`Symbol ${symbolName} berhasil dinonaktifkan!`, 'error');
  }

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
    alertDiv.className = 'custom-alert ' + type;
    alertDiv.textContent = message;
    document.body.appendChild(alertDiv);

    setTimeout(() => alertDiv.classList.add('show'), 10);

    setTimeout(() => {
        alertDiv.classList.remove('show');
        setTimeout(() => alertDiv.remove(), 300);
    }, duration);
}


document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  loadData();
  setActiveSidebar('dashboard-management')
});

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
      case 'l2-orderbook':
        window.dashboardAPI.navigate('l2orderbook');
        break
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
