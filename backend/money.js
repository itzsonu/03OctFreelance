function toCents(value) {
  if (!["number", "string"].includes(typeof value) || (typeof value === "string" && !value.trim())) return null;
  const scaled = Number(value) * 100;
  const cents = Math.round(scaled);
  return Number.isSafeInteger(cents) && Math.abs(scaled - cents) < 0.000001 ? cents : null;
}
module.exports = { toCents };
