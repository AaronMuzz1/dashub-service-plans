import test from "node:test";
import assert from "node:assert/strict";
import { calculateFunding } from "../lib/domain/funding.js";
import { forecastServices } from "../lib/domain/forecast.js";
import { serviceGrossCents } from "../lib/domain/money.js";
import { buildQuote } from "../lib/domain/quote.js";

function service(predictedDate, grossCents) { return { predictedDate, grossCents }; }
function assertCovered(result, services) {
  let required = 0;
  for (const [index, item] of services.entries()) {
    required += item.grossCents;
    const received = result.payments.filter((payment) => payment.date < item.predictedDate)
      .reduce((sum, payment) => sum + payment.amountCents, 0);
    assert.ok(received >= required, `service ${index + 1} must be funded`);
  }
  assert.equal(result.payments.reduce((sum, payment) => sum + payment.amountCents, 0), result.totalCents);
  assert.ok(result.finalPaymentDate < services.at(-1).predictedDate);
}

test("unequal early service drives the installment above whole-term averaging", () => {
  const services = [service("2026-02-01", 90000), service("2026-12-01", 10000)];
  const result = calculateFunding({ services, firstPaymentDate: "2026-01-01", frequency: "weekly" });
  const wholeTermAverage = Math.ceil(result.totalCents / 48);
  assert.ok(result.installmentCents > wholeTermAverage);
  assert.equal(result.coverage[0].eligiblePayments, 5);
  assert.equal(result.installmentCents, 18000);
  assertCovered(result, services);
});

test("higher annual mileage moves service dates and raises required funding", () => {
  const forecastInput = { startDate: "2026-01-01", currentOdometer: 40000, intervalMonths: 12, intervalKm: 15000, numberOfServices: 2 };
  const normal = forecastServices({ ...forecastInput, annualKm: 12000 });
  const high = forecastServices({ ...forecastInput, annualKm: 60000 });
  assert.equal(normal[0].trigger, "months");
  assert.equal(high[0].trigger, "km");
  assert.ok(high[0].predictedDate < normal[0].predictedDate);
  assert.equal(high[0].predictedKm, 55000);
  const pricedNormal = normal.map((point, index) => service(point.predictedDate, index ? 30000 : 60000));
  const pricedHigh = high.map((point, index) => service(point.predictedDate, index ? 30000 : 60000));
  const normalFunding = calculateFunding({ services: pricedNormal, firstPaymentDate: "2026-01-08" });
  const highFunding = calculateFunding({ services: pricedHigh, firstPaymentDate: "2026-01-08" });
  assert.ok(highFunding.installmentCents > normalFunding.installmentCents);
  assertCovered(highFunding, pricedHigh);
});

test("current odometer is required for a forecast", () => {
  assert.throws(() => forecastServices({ startDate: "2026-01-01", currentOdometer: "", annualKm: 15000, intervalMonths: 12, intervalKm: 15000, numberOfServices: 2 }), /odometer is required/);
});

for (const frequency of ["weekly", "fortnightly", "monthly"]) {
  test(`${frequency} schedule covers every service and stops before final due date`, () => {
    const services = [service("2026-03-15", 12001), service("2026-07-15", 80123), service("2027-02-01", 33007)];
    const result = calculateFunding({ services, firstPaymentDate: "2026-01-31", frequency });
    assertCovered(result, services);
    assert.ok(result.paymentCount > 1);
    if (frequency === "monthly") assert.deepEqual(result.payments.slice(0, 3).map((payment) => payment.date), ["2026-01-31", "2026-02-28", "2026-03-31"]);
    if (frequency === "weekly") assert.equal(result.payments[1].date, "2026-02-07");
    if (frequency === "fortnightly") assert.equal(result.payments[1].date, "2026-02-14");
  });
}

test("later first payment increases the installment and too-late dates fail", () => {
  const services = [service("2026-02-01", 10000), service("2026-03-01", 10000)];
  const early = calculateFunding({ services, firstPaymentDate: "2026-01-01" });
  const later = calculateFunding({ services, firstPaymentDate: "2026-01-22" });
  assert.ok(later.installmentCents > early.installmentCents);
  assertCovered(later, services);
  assert.throws(() => calculateFunding({ services, firstPaymentDate: "2026-02-02" }), /too late to fund service 1/);
  assert.throws(() => calculateFunding({ services: [service("2026-02-01", 10000)], firstPaymentDate: "2026-02-01" }), /before the final service/);
});

test("same-day collections are not counted as cleared funds for a service", () => {
  const services = [service("2026-01-08", 10000), service("2026-02-08", 10000)];
  const result = calculateFunding({ services, firstPaymentDate: "2026-01-01" });
  assert.equal(result.installmentCents, 10000);
  assert.equal(result.coverage[0].eligiblePayments, 1);
  assertCovered(result, services);
});

test("rounding is exact in cents and the final payment is capped", () => {
  const services = [service("2026-01-25", 10001)];
  const result = calculateFunding({ services, firstPaymentDate: "2026-01-01" });
  assert.equal(result.installmentCents, 2501);
  assert.deepEqual(result.payments.map((payment) => payment.amountCents), [2501, 2501, 2501, 2498]);
  assertCovered(result, services);
  assert.equal(serviceGrossCents("0.10", "exclusive"), 12);
  assert.equal(serviceGrossCents("100.00", "exclusive"), 11500);
});

test("quote snapshots GST-inclusive service values and keeps VIN optional", () => {
  const quote = buildQuote({
    quoteDate: "2026-01-01",
    customer: { firstName: "A", lastName: "B", mobile: "021 123 4567", email: "a@example.test", address: "1 Test Street" },
    vehicle: { year: "2024", make: "Toyota", model: "Corolla", registration: "ABC123", vin: "" },
    currentOdometer: "1000", annualKm: "12000", intervalMonths: "12", intervalKm: "15000", numberOfServices: "2",
    services: [{ name: "First", price: "100.00", taxMode: "exclusive" }, { name: "Second", price: "200.00", taxMode: "inclusive" }],
    frequency: "weekly", firstPaymentDate: "2026-01-08",
  });
  assert.equal(quote.funding.totalCents, 31500);
  assert.equal(quote.vehicle.vin, "");
  assertCovered(quote.funding, quote.services);
});
