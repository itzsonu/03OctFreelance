const test = require("node:test");
const assert = require("node:assert/strict");
const { toCents } = require("./money");
test("paise conversion accepts decimal money without floating point rejection", () => {
  assert.equal(toCents(19.99), 1999);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents("1500.15"), 150015);
  for (const value of ["", null, true, Infinity, "abc", 12.345]) assert.equal(toCents(value), null);
});
