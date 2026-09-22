import { buildQuote } from "../domain/quote.js";
import { addDays, todayLocalDate } from "../domain/dates.js";
import { activateQuote, claimNextService, getPlanFinancials, markWeeklyPayoutPaid, receiveDealerInvoice, recordTopUp, scheduleWeeklyPayouts, simulateScheduledPayment } from "../domain/operations.js";

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

const companies = [
  { id: "gazley-demo", name: "Gazley Motors", subscriptionActive: true, manufacturerAdministration: true, manufacturerIds: ["sample-manufacturer"], branches: [{ id: "wellington-demo", name: "Wellington" }, { id: "lower-hutt-demo", name: "Lower Hutt" }], commercialTerms: { setupFeeCents: 4900, ongoingFeeCents: 1500, providerFeeCents: 125, providerFeeTreatment: "dashub" } },
  { id: "harbour-demo", name: "Harbour Automotive", subscriptionActive: true, manufacturerAdministration: false, manufacturerIds: ["sample-manufacturer"], branches: [{ id: "harbour-city", name: "City" }, { id: "harbour-north", name: "North Shore" }], commercialTerms: { setupFeeCents: 5900, ongoingFeeCents: 1200, providerFeeCents: 125, providerFeeTreatment: "dealer" } },
  { id: "alpine-demo", name: "Alpine Auto Group", subscriptionActive: true, manufacturerAdministration: false, manufacturerIds: [], branches: [{ id: "alpine-central", name: "Central" }], commercialTerms: { setupFeeCents: 3900, ongoingFeeCents: 1000, providerFeeCents: 100, providerFeeTreatment: "dashub" } },
];

const users = [
  { id: "dashub-admin", name: "Dashub Admin", email: "admin@example.test", role: "dashub_admin", dealerGroupId: "gazley-demo", branchId: "wellington-demo", manufacturerIds: ["sample-manufacturer"], permissions: { createDealerPlans: true, editDealerPlans: true, priceDealerPlans: true, viewManufacturerPlans: true, activatePlans: true, claimServices: true, managePayments: true, manageInvoices: true, manageDealerTemplates: true } },
  { id: "sandbox-advisor", name: "Gazley Advisor", email: "advisor@example.test", role: "advisor", dealerGroupId: "gazley-demo", branchId: "wellington-demo", manufacturerIds: ["sample-manufacturer"], permissions: { createDealerPlans: true, editDealerPlans: true, priceDealerPlans: true, viewManufacturerPlans: true, activatePlans: false, claimServices: true, managePayments: false, manageInvoices: false, manageDealerTemplates: false } },
  { id: "harbour-manager", name: "Harbour Manager", email: "manager@example.test", role: "manager", dealerGroupId: "harbour-demo", branchId: "harbour-city", manufacturerIds: ["sample-manufacturer"], permissions: { createDealerPlans: true, editDealerPlans: true, priceDealerPlans: true, viewManufacturerPlans: true, activatePlans: true, claimServices: true, managePayments: true, manageInvoices: true, manageDealerTemplates: true } },
  { id: "alpine-advisor", name: "Alpine Advisor", email: "alpine@example.test", role: "advisor", dealerGroupId: "alpine-demo", branchId: "alpine-central", manufacturerIds: [], permissions: { createDealerPlans: true, editDealerPlans: false, priceDealerPlans: false, viewManufacturerPlans: false, activatePlans: false, claimServices: true, managePayments: false, manageInvoices: false, manageDealerTemplates: false } },
];

function sampleQuote({ id, name, mobile, address, make, model, year, registration, group, branch, daysAgo, intervalMonths = 6, intervalKm = 15000, annualKm = 12000, prices = [460, 720], scenario }) {
  const quoteDate = addDays(todayLocalDate(), -daysAgo);
  const draft = {
    quoteDate,
    customer: { firstName: name.split(" ")[0], lastName: name.split(" ").slice(1).join(" "), mobile, email: `${id}@example.test`, address },
    vehicle: { year: String(year), make, model, registration, vin: "" },
    currentOdometer: "38000", annualKm: String(annualKm), intervalMonths: String(intervalMonths), intervalKm: String(intervalKm),
    numberOfServices: String(prices.length), frequency: "weekly", firstPaymentDate: addDays(quoteDate, 7),
    services: prices.map((price, index) => ({ name: `Scheduled service ${index + 1}`, description: index ? "Major service and inspection" : "Oil, filter and inspection", price: price.toFixed(2), taxMode: "inclusive" })),
  };
  const at = `${quoteDate}T09:00:00.000Z`;
  return { id, origin: "dealer", status: "quote", dealerGroupId: group, branchId: branch, advisorId: "sandbox-advisor", quoteCreatorId: "sandbox-advisor", createdAt: at, updatedAt: at, draft, quote: buildQuote(draft), scenario, demo: true, audit: [] };
}

export function createDemoWorkspace() {
  const today = todayLocalDate();
  const [dealerQuote, manufacturerQuote] = createDemoPlans();
  dealerQuote.scenario = "New quote";
  manufacturerQuote.scenario = "Locked manufacturer quote";
  const templates = [
    { id: "template-gazley", origin: "dealer", dealerGroupId: "gazley-demo", brand: "Toyota", model: "RAV4", intervalMonths: "12", intervalKm: "15000", branchIds: ["wellington-demo", "lower-hutt-demo"], services: [{ name: "Annual service", description: "Oil and inspection", price: "450.00", taxMode: "inclusive" }, { name: "Major service", description: "Scheduled major service", price: "790.00", taxMode: "inclusive" }] },
    { id: "template-harbour", origin: "dealer", dealerGroupId: "harbour-demo", brand: "Honda", model: "Civic", intervalMonths: "12", intervalKm: "15000", branchIds: ["harbour-city"], services: [{ name: "Annual service", description: "Inspection", price: "510.00", taxMode: "inclusive" }, { name: "Major service", description: "Scheduled major service", price: "840.00", taxMode: "inclusive" }] },
    { id: "template-manufacturer", origin: "manufacturer", manufacturerId: "sample-manufacturer", brand: "Mazda", model: "CX-5", intervalMonths: "12", intervalKm: "15000", branchIds: [], services: [{ name: "Manufacturer service 1", price: "490.00", taxMode: "inclusive" }, { name: "Manufacturer service 2", price: "690.00", taxMode: "inclusive" }] },
  ];
  const plans = [dealerQuote, manufacturerQuote];
  const payouts = [];
  const ctx = (at = `${today}T10:00:00.000Z`) => ({ at, actorId: "sandbox-seed" });
  const add = (args) => {
    const quote = sampleQuote(args);
    const company = companies.find((item) => item.id === args.group);
    const active = activateQuote(quote, { subscriptionActive: true, commercialTerms: company.commercialTerms }, ctx(`${addDays(quote.draft.quoteDate, 1)}T10:00:00.000Z`));
    plans.push(active);
    return active;
  };
  const replace = (plan) => { const index = plans.findIndex((item) => item.id === plan.id); plans[index] = plan; return plan; };
  const collect = (plan, count) => {
    let result = plan;
    for (const payment of plan.paymentSchedule.slice(0, count)) result = simulateScheduledPayment(result, payment.id, "success", ctx(`${payment.date}T10:00:00.000Z`));
    return replace(result);
  };
  const claim = (plan, serviceDate = today) => {
    const shortfall = getPlanFinancials(plan).nextServiceShortfallCents;
    return replace(claimNextService(plan, { serviceNumber: 1, currentOdometer: 46500, roNumber: `RO-${plan.id.toUpperCase()}`, serviceDate, completed: true, dealerCollectedShortfallCents: shortfall }, ctx()));
  };

  let onSchedule = add({ id: "active-schedule", name: "Priya Nair", mobile: "021 555 0201", address: "14 Kowhai Road, Wellington", make: "Toyota", model: "Corolla", year: 2023, registration: "SVC201", group: "gazley-demo", branch: "lower-hutt-demo", daysAgo: 110, scenario: "Active on schedule" });
  collect(onSchedule, 12);

  let recovered = add({ id: "failed-recovered", name: "Sam Taylor", mobile: "021 555 0202", address: "8 Harbour Road, Auckland", make: "Honda", model: "Jazz", year: 2021, registration: "SVC202", group: "harbour-demo", branch: "harbour-city", daysAgo: 120, scenario: "Failed payment recovered" });
  recovered = collect(recovered, 1);
  recovered = replace(simulateScheduledPayment(recovered, "PAY-2", "failure", ctx()));
  replace(simulateScheduledPayment(recovered, "PAY-2", "retry_success", ctx()));

  let shortfall = add({ id: "funding-shortfall", name: "Aroha King", mobile: "021 555 0203", address: "6 Hill Street, Wellington", make: "Suzuki", model: "Swift", year: 2020, registration: "SVC203", group: "gazley-demo", branch: "wellington-demo", daysAgo: 170, scenario: "Genuine funding shortfall" });
  replace(simulateScheduledPayment(shortfall, "PAY-1", "failure", ctx()));

  let early = add({ id: "early-service", name: "Luca Chen", mobile: "021 555 0204", address: "30 Lake Terrace, Queenstown", make: "Subaru", model: "Outback", year: 2024, registration: "SVC204", group: "alpine-demo", branch: "alpine-central", daysAgo: 35, intervalMonths: 12, scenario: "Early service claim" });
  early = collect(early, 3);
  claim(early);

  let awaiting = add({ id: "awaiting-invoice", name: "Mia Patel", mobile: "021 555 0205", address: "21 Coast Lane, Auckland", make: "Hyundai", model: "Tucson", year: 2022, registration: "SVC205", group: "harbour-demo", branch: "harbour-north", daysAgo: 240, scenario: "Claim awaiting dealer invoice" });
  awaiting = collect(awaiting, 12);
  claim(awaiting);

  let exception = add({ id: "invoice-exception", name: "Noah Williams", mobile: "021 555 0206", address: "2 River Road, Wellington", make: "Ford", model: "Focus", year: 2019, registration: "SVC206", group: "gazley-demo", branch: "wellington-demo", daysAgo: 230, scenario: "Invoice exception" });
  exception = claim(exception);
  replace(receiveDealerInvoice(exception, exception.claims[0].id, { invoiceNumber: "INV-EXCEPTION-206", amountCents: exception.claims[0].expectedCents + 1000 }, ctx()));

  let payable = add({ id: "awaiting-payout", name: "Ella Roberts", mobile: "021 555 0207", address: "19 Cable Street, Wellington", make: "Kia", model: "Sportage", year: 2022, registration: "SVC207", group: "gazley-demo", branch: "lower-hutt-demo", daysAgo: 235, scenario: "Awaiting weekly payout" });
  payable = replace(recordTopUp(payable, getPlanFinancials(payable).remainingObligationCents, ctx()));
  payable = claim(payable);
  replace(receiveDealerInvoice(payable, payable.claims[0].id, { invoiceNumber: "INV-PAYOUT-207", amountCents: payable.claims[0].expectedCents + 5 }, ctx()));
  let scheduled = scheduleWeeklyPayouts(plans, payouts, ctx());
  plans.splice(0, plans.length, ...scheduled.plans);
  payouts.push(...scheduled.created);

  let completed = add({ id: "completed-plan", name: "Oliver Brown", mobile: "021 555 0208", address: "5 Valley Drive, Queenstown", make: "Mazda", model: "Demio", year: 2018, registration: "SVC208", group: "alpine-demo", branch: "alpine-central", daysAgo: 500, prices: [380], scenario: "Completed plan" });
  completed = replace(recordTopUp(completed, getPlanFinancials(completed).remainingObligationCents, ctx()));
  const completedDate = completed.quote.services[0].predictedDate;
  completed = claim(completed, completedDate);
  completed = replace(receiveDealerInvoice(completed, completed.claims[0].id, { invoiceNumber: "INV-COMPLETE-208", amountCents: completed.claims[0].expectedCents }, ctx()));
  scheduled = scheduleWeeklyPayouts(plans, payouts, ctx());
  plans.splice(0, plans.length, ...scheduled.plans);
  payouts.push(...scheduled.created);
  const completedPayout = scheduled.created.find((item) => item.lines.some((line) => line.planId === "completed-plan"));
  if (completedPayout) {
    const paid = markWeeklyPayoutPaid(plans, payouts, completedPayout.id, ctx());
    plans.splice(0, plans.length, ...paid.plans);
    payouts.splice(0, payouts.length, ...paid.payouts);
  }

  add({ id: "expiry-risk", name: "Isla Thompson", mobile: "021 555 0209", address: "9 Summit Avenue, Auckland", make: "Nissan", model: "Qashqai", year: 2020, registration: "SVC209", group: "harbour-demo", branch: "harbour-city", daysAgo: 530, scenario: "Approaching proposed expiry" });

  return { plans, payouts, templates, companies, users };
}
