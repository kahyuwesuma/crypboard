document.getElementById('management-button').addEventListener('click', () => {
  window.dashboardAPI.navigate('dashboard');
});

async function loadSymbols() {
	const symbols = await window.managementAPI.getAll();
	const tbody = document.getElementById('symbolTableBody');
	tbody.innerHTML = '';

	symbols.forEach((symbol, index) => {
		const tr = document.createElement('tr');

		tr.innerHTML = `
			<td>${index + 1}</td>
			<td>${symbol}</td>
			<td>
				<button onclick="deleteSymbol('${symbol}')">Hapus</button>
			</td>
		`;

		tbody.appendChild(tr);
	});
}

async function deleteSymbol(symbol) {
	const res = await window.managementAPI.remove(symbol);
	if (res.success) {
		loadSymbols();
	} else {
		alert(res.message);
	}
}

document.getElementById('formAdd').addEventListener('submit', async (e) => {
	e.preventDefault();
	const symbol = document.getElementById('addSymbol').value.trim();
	const res = await window.managementAPI.add(symbol);
	if (!res.success) {
		alert(res.message);
	}
	document.getElementById('addSymbol').value = '';
	loadSymbols();
});

document.getElementById('formUpdate').addEventListener('submit', async (e) => {
	e.preventDefault();
	const oldSymbol = document.getElementById('oldSymbol').value.trim();
	const newSymbol = document.getElementById('newSymbol').value.trim();
	const res = await window.managementAPI.update(oldSymbol, newSymbol);
	if (!res.success) {
		alert(res.message);
	}
	document.getElementById('oldSymbol').value = '';
	document.getElementById('newSymbol').value = '';
	loadSymbols();
});

// Load pertama kali
loadSymbols();