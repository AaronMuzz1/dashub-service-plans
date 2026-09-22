import { buildQuote } from "../domain/quote.js";
import { addDays, todayLocalDate } from "../domain/dates.js";

export function createDemoPlans() {
  const quoteDate = todayLocalDate();
  const base = {
    quoteDate,
    currentOdometer: "42300",
    annualKm: "15000",
    intervalMonths: "12",
    intervalKm: "15000",
    numberOfServices: "3",
    frequency: "weekly",
    firstPaymentDate: addDays(quoteDate, 7),
    vehicle: { year: "2022", make: "Toyota", model: "RAV4", registration: "DEMO01", vin: "" },
  };
  const dealerDraft = {
    ...base,
    customer: { firstName: "Alex", lastName: "Example", mobile: "021 555 0100", email: "alex@example.test", address: "1 Example Street, Wellington" },
    services: [
      { name: "12 month service", description: "Oil, filter and inspection", price: "420.00", taxMode: "inclusive" },
      { name: "24 month service", description: "Major scheduled service", price: "820.00", taxMode: "inclusive" },
      { name: "36 month service", description: "Oil, filter and inspection", price: "470.00", taxMode: "inclusive" },
    ],
  };
  const manufacturerDraft = {
    ...base,
    customer: { firstName: "Morgan", lastName: "Example", mobile: "021 555 0199", email: "morgan@example.test", address: "2 Example Street, Wellington" },
    vehicle: { year: "2024", make: "Mazda", model: "CX-5", registration: "DEMO02", vin: "" },
    services: [
      { name: "Manufacturer service 1", description: "Centrally set entitlement", price: "490.00", taxMode: "inclusive" },
      { name: "Manufacturer service 2", description: "Centrally set entitlement", price: "690.00", taxMode: "inclusive" },
      { name: "Manufacturer service 3", description: "Centrally set entitlement", price: "490.00", taxMode: "inclusive" },
    ],
  };
  const now = new Date().toISOString();
  return [
    { id: "demo-dealer", origin: "dealer", status: "quote", dealerGroupId: "gazley-demo", branchId: "wellington-demo", advisorId: "sandbox-advisor", quoteCreatorId: "sandbox-advisor", createdAt: now, updatedAt: now, draft: dealerDraft, quote: buildQuote(dealerDraft), demo: true },
    { id: "demo-manufacturer", origin: "manufacturer", status: "quote", manufacturerId: "sample-manufacturer", dealerGroupId: null, branchId: null, advisorId: null, quoteCreatorId: "dashub-admin", createdAt: now, updatedAt: now, draft: manufacturerDraft, quote: buildQuote(manufacturerDraft), demo: true, locked: true },
  ];
}
