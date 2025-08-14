const fs = require('fs');
const path = require('path');

function formatPrice(value, currency) {
  if (value == null) return "-";
  const options = {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  };
  if (currency === "IDR") {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", ...options }).format(value);
  } else {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", ...options }).format(value);
  }
}

function displaySymbols(){
  const filePath = path.join(__dirname, '../../storage/symbols.json'); // dari src/shared/utils -> src/storage
  const rawData = fs.readFileSync(filePath, 'utf8');
  const coins = JSON.parse(rawData);

  // Filter hanya yang active = true, lalu ambil symbol
  const activeSymbols = coins
    .filter(coin => coin.active)
    .map(coin => coin.symbol);
  return activeSymbols;
}

function allSymbols(){
  const filePath = path.join(__dirname, '../../storage/symbols.json'); // dari src/shared/utils -> src/storage
  const rawData = fs.readFileSync(filePath, 'utf8');
  const coins = JSON.parse(rawData);

  return coins;
}

module.exports={ formatPrice, displaySymbols, allSymbols };