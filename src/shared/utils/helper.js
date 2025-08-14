const fs = require('fs')
const path = require('path')

function formatPrice(value, currency) {
    if (value == null) return "-";

    if (currency === "IDR") {
        return new Intl.NumberFormat("id-ID", {
            style: "currency",
            currency: "IDR",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(value);
    } else {
        // USD formatting
        if (value >= 1) {
            return new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
            }).format(Math.round(value));
        } else {
            return new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(value);
        }
    }
}


function displaySymbols(){
  const filePath = path.join(__dirname, '../../storage/symbols.json') // dari src/shared/utils -> src/storage
  const rawData = fs.readFileSync(filePath, 'utf8')
  const coins = JSON.parse(rawData)

  // Filter hanya yang active = true, lalu ambil symbol
  const activeSymbols = coins
    .filter(coin => coin.active)
    .map(coin => coin.symbol)
  return activeSymbols
}

function allSymbols(){
  const filePath = path.join(__dirname, '../../storage/symbols.json')
  const rawData = fs.readFileSync(filePath, 'utf8')
  const coins = JSON.parse(rawData)

  return coins
}

function displayExchange(){
  const filePath = path.join(__dirname, '../../storage/exchange.json')
  const rawData = fs.readFileSync(filePath, 'utf8')
  const exchange = JSON.parse(rawData)

  const activeExchange = exchange
    .filter(exchange => exchange.active)
    .map(exchange => exchange.name)

  return activeExchange
}

function allExchange(){
  const filePath = path.join(__dirname, '../../storage/exchange.json')
  const rawData = fs.readFileSync(filePath, 'utf8')
  const exchange = JSON.parse(rawData)

  return exchange
}

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
module.exports={ formatPrice, displaySymbols, allSymbols, displayExchange, allExchange, showAlert }