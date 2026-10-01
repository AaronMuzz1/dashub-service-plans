export const GST_RATE = 0.15;

export function parseMoneyToCents(value) {
  const text = String(value ?? "").trim();
  if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(text)) throw new Error("Enter a valid price with up to two decimals.");
  const [dollars, cents = ""] = text.split(".");
  const amount = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Price is out of range.");
  return amount;
}

export function serviceGrossCents(value, taxMode) {
  const cents = parseMoneyToCents(value);
  if (taxMode === "inclusive") return cents;
  if (taxMode === "exclusive") {
    const gross = (BigInt(cents) * 115n + 50n) / 100n;
    if (gross > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Price is out of range.");
    return Number(gross);
  }
  throw new Error("Choose whether the price includes GST.");
}

export function formatMoney(cents) {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(cents / 100);
}
