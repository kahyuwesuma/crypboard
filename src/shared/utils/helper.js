const fs = require('fs')
const path = require('path')

function chunkArray(arr, size) {
  const res = [];
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size));
  }
  return res;
}

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

function allL2(){
  const filePath = path.join(__dirname, '../../storage/l2.json')
  const rawData = fs.readFileSync(filePath, 'utf8')
  const l2 = JSON.parse(rawData)

  return l2
}

function userData(){
  const filePath = path.join(__dirname, '../../storage/user.json')
  const rawData = fs.readFileSync(filePath, 'utf8')
  const user = JSON.parse(rawData)

  return user
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

function saveToJson(data, path) {
    try {
        fs.writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
        console.log(`✅ Data berhasil disimpan ke ${path}`);
    } catch (err) {
        console.error("❌ Gagal menyimpan data JSON:", err);
    }
}

function getMexcAPI(){
  const filePath = path.join(__dirname, '../../storage/mexcApiKey.json')
  const rawData = fs.readFileSync(filePath, 'utf8')
  const api = JSON.parse(rawData)

  return api
}


module.exports={ formatPrice, displaySymbols, allSymbols, displayExchange, allExchange, showAlert, chunkArray, saveToJson, allL2, userData, getMexcAPI }