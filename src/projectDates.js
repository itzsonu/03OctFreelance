function todayISO(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = type => parts.find(item => item.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateSchedule(deadline, milestones = [], now = new Date()) {
  const today = todayISO(now);
  if (!validDate(deadline) || deadline < today) throw new Error("Choose a valid project deadline of today or later (India time).");
  milestones.forEach((step, index) => {
    const date = step.dueDate;
    if (date === undefined || date === "") return;
    if (!validDate(date) || date < today || date > deadline) throw new Error(`Milestone ${index + 1} target date must be between today and the project deadline.`);
    const priorIndexes = step.dependsOn === undefined ? (index ? [index - 1] : []) : step.dependsOn;
    if (Array.isArray(priorIndexes) && priorIndexes.some(prior => milestones[prior]?.dueDate && validDate(milestones[prior].dueDate) && milestones[prior].dueDate > date)) throw new Error(`Milestone ${index + 1} target date cannot be before its prerequisite target date.`);
  });
}

export { todayISO, validDate, validateSchedule };
