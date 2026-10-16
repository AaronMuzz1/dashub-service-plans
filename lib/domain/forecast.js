import { addDays, addMonths, daysBetween, parseDateOnly } from "./dates.js";

const YEAR_DAYS = 365.2425;

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} must be a positive whole number.`);
  return number;
}

function nonNegativeInteger(value, label) {
  if (value === null || value === undefined || String(value).trim() === "") throw new Error(`${label} is required.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} must be a non-negative whole number.`);
  return number;
}

function requiredDate(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  try { parseDateOnly(value); }
  catch { throw new Error(`${label} must be a valid date.`); }
  return value;
}

/**
 * Forecast the manufacturer's service cycle from the last completed service.
 * Current usage only determines when each fixed kilometre threshold is reached.
 */
export function forecastServices({ startDate, lastCompletedService, currentOdometer, annualKm, intervalMonths, intervalKm, numberOfServices }) {
  parseDateOnly(startDate);
  const lastServiceDate = requiredDate(lastCompletedService?.date, "Last service date");
  if (lastServiceDate > startDate) throw new Error("Last service date cannot be in the future.");

  const lastServiceOdometer = nonNegativeInteger(lastCompletedService?.odometer, "Last service odometer");
  const odometer = nonNegativeInteger(currentOdometer, "Current odometer");
  if (lastServiceOdometer > odometer) throw new Error("Last service odometer cannot exceed current odometer.");

  const kilometres = positiveInteger(annualKm, "Predicted annual kilometres");
  const months = positiveInteger(intervalMonths, "Service interval in months");
  const distance = positiveInteger(intervalKm, "Service interval in kilometres");
  const count = positiveInteger(numberOfServices, "Number of services");
  if (count > 24) throw new Error("Number of services cannot exceed 24 in this prototype.");

  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const scheduledKm = lastServiceOdometer + distance * number;
    const distanceRemainingKm = scheduledKm - odometer;
    const distanceDays = Math.max(0, Math.ceil((distanceRemainingKm / kilometres) * YEAR_DAYS));
    const kilometreDueDate = addDays(startDate, distanceDays);
    const timeDueDate = addMonths(lastServiceDate, months * number);
    const byDistance = kilometreDueDate <= timeDueDate;
    const predictedDate = byDistance ? kilometreDueDate : timeDueDate;
    const thresholdOverdue = byDistance ? distanceRemainingKm < 0 : timeDueDate < startDate;
    const dueState = thresholdOverdue || predictedDate < startDate
      ? "overdue"
      : predictedDate === startDate ? "due_now" : "upcoming";
    const elapsedDays = Math.max(0, daysBetween(startDate, predictedDate));
    const estimatedOdometer = byDistance
      ? scheduledKm
      : odometer + Math.round(kilometres * elapsedDays / YEAR_DAYS);

    return {
      number,
      predictedDate,
      predictedKm: scheduledKm,
      scheduledKm,
      estimatedOdometer,
      timeDueDate,
      kilometreDueDate,
      distanceRemainingKm,
      trigger: byDistance ? "km" : "months",
      dueState,
      serviceTablePosition: {
        anchor: lastCompletedService?.serviceTablePosition ?? null,
        offsetFromLastCompleted: number,
      },
    };
  });
}
