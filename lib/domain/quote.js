import { forecastServices } from "./forecast.js";
import { calculateFunding } from "./funding.js";
import { serviceGrossCents } from "./money.js";
import { parseDateOnly } from "./dates.js";

function required(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

export function buildQuote(draft) {
  if (!draft || typeof draft !== "object") throw new Error("Plan details are required.");
  const customer = {
    firstName: required(draft.customer?.firstName, "First name"),
    lastName: required(draft.customer?.lastName, "Last name"),
    mobile: required(draft.customer?.mobile, "Mobile"),
    email: required(draft.customer?.email, "Email"),
    address: required(draft.customer?.address, "Physical address"),
  };
  if (!/^\S+@\S+\.\S+$/.test(customer.email)) throw new Error("Enter a valid email address.");
  if (customer.mobile.replace(/\D/g, "").length < 7) throw new Error("Enter a valid mobile number.");
  const vehicle = {
    year: Number(draft.vehicle?.year),
    make: required(draft.vehicle?.make, "Vehicle make"),
    model: required(draft.vehicle?.model, "Vehicle model"),
    registration: String(draft.vehicle?.registration ?? "").trim(),
    vin: String(draft.vehicle?.vin ?? "").trim(),
  };
  if (!Number.isInteger(vehicle.year) || vehicle.year < 1900 || vehicle.year > new Date().getFullYear() + 2) {
    throw new Error("Enter a valid vehicle year.");
  }
  parseDateOnly(draft.quoteDate);
  parseDateOnly(draft.firstPaymentDate);
  if (draft.firstPaymentDate < draft.quoteDate) throw new Error("First payment cannot be before the quote date.");

  const forecast = forecastServices({
    startDate: draft.quoteDate,
    currentOdometer: draft.currentOdometer,
    annualKm: draft.annualKm,
    intervalMonths: draft.intervalMonths,
    intervalKm: draft.intervalKm,
    numberOfServices: draft.numberOfServices,
  });
  if (!Array.isArray(draft.services) || draft.services.length !== forecast.length) {
    throw new Error("Add a price and description for every service.");
  }
  const services = forecast.map((point, index) => {
    const source = draft.services[index];
    const name = required(source?.name, `Service ${index + 1} name`);
    const grossCents = serviceGrossCents(source?.price, source?.taxMode);
    if (grossCents === 0) throw new Error(`Service ${index + 1} needs a price greater than zero.`);
    return {
      ...point,
      name,
      description: String(source?.description ?? "").trim(),
      enteredPrice: String(source.price),
      taxMode: source.taxMode,
      grossCents,
      source: "manual",
    };
  });
  const funding = calculateFunding({ services, firstPaymentDate: draft.firstPaymentDate, frequency: draft.frequency });
  return {
    customer,
    vehicle,
    quoteDate: draft.quoteDate,
    currentOdometer: Number(draft.currentOdometer),
    annualKm: Number(draft.annualKm),
    intervalMonths: Number(draft.intervalMonths),
    intervalKm: Number(draft.intervalKm),
    numberOfServices: forecast.length,
    frequency: draft.frequency,
    firstPaymentDate: draft.firstPaymentDate,
    services,
    funding,
  };
}
