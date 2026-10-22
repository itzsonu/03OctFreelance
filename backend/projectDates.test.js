const test = require("node:test");
const assert = require("node:assert/strict");
const { todayISO, validDate, validateSchedule } = require("./projectDates");
const now = new Date("2026-10-08T12:00:00Z");
test("dates use India calendar days and reject past or impossible dates", () => {
  assert.equal(todayISO(new Date("2026-10-08T19:00:00Z")), "2026-10-09");
  assert.equal(validDate("2030-02-31"), false);
  assert.equal(validDate("2032-02-29"), true);
  for (const date of ["2026-10-07", "2030-02-31", "2030-12-01T00:00:00Z", null]) assert.throws(() => validateSchedule(date, [], now), /deadline/);
  assert.doesNotThrow(() => validateSchedule("2026-10-08", [], now));
});
test("optional milestone dates respect deadline and prerequisite dates", () => {
  const steps = [{ dueDate: "2026-10-10", dependsOn: [] }, { dueDate: "2026-10-11", dependsOn: [0] }];
  assert.doesNotThrow(() => validateSchedule("2026-10-12", steps, now));
  assert.doesNotThrow(() => validateSchedule("2026-10-12", [{ dueDate: "" }], now));
  for (const date of ["2026-10-07", "2026-10-13", "2026-11-31", null]) assert.throws(() => validateSchedule("2026-10-12", [{ dueDate: date }], now), /target date/);
  assert.throws(() => validateSchedule("2026-10-12", [steps[0], { ...steps[1], dueDate: "2026-10-09" }], now), /prerequisite/);
});
