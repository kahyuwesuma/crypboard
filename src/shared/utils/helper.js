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

module.exports={ formatPrice };