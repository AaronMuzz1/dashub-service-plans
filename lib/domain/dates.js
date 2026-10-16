const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Enter a valid date.");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Enter a valid date.");
  }
  return date;
}

export function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(value, days) {
  return toDateOnly(new Date(parseDateOnly(value).getTime() + days * DAY_MS));
}

// Anchor each occurrence to the original day so Jan 31 -> Feb 28 -> Mar 31.
export function addMonths(value, months) {
  const date = parseDateOnly(value);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return toDateOnly(target);
}

export function daysBetween(start, end) {
  return Math.round((parseDateOnly(end).getTime() - parseDateOnly(start).getTime()) / DAY_MS);
}

export function todayLocalDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
