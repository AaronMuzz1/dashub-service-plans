import { addDays, addMonths, daysBetween, parseDateOnly } from "./dates.js";

const YEAR_DAYS = 365.2425;

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} must be a positive whole number.`);
  return number;
}

export function forecastServices({ startDate, currentOdometer, annualKm, intervalMonths, intervalKm, numberOfServices }) {
  parseDateOnly(startDate);
  if (currentOdometer === null || currentOdometer === undefined || String(currentOdometer).trim() === "") {
    throw new Error("Current odometer is required.");
  }
  const odometer = Number(currentOdometer);
  if (!Number.isSafeInteger(odometer) || odometer < 0) throw new Error("Current odometer must be a non-negative whole number.");
  const kilometres = positiveInteger(annualKm, "Predicted annual kilometres");
  const months = positiveInteger(intervalMonths, "Service interval in months");
  const distance = positiveInteger(intervalKm, "Service interval in kilometres");
  const count = positiveInteger(numberOfServices, "Number of services");
  if (count > 24) throw new Error("Number of services cannot exceed 24 in this prototype.");

  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const calendarDate = addMonths(startDate, months * number);
    const distanceDays = Math.ceil((distance * number / kilometres) * YEAR_DAYS);
    const distanceDate = addDays(startDate, distanceDays);
    const byDistance = distanceDate <= calendarDate;
    const predictedDate = byDistance ? distanceDate : calendarDate;
    const predictedKm = byDistance
      ? odometer + distance * number
      : odometer + Math.round(kilometres * daysBetween(startDate, predictedDate) / YEAR_DAYS);
    return { number, predictedDate, predictedKm, trigger: byDistance ? "km" : "months" };
  });
}
