import test from "node:test";
import assert from "node:assert/strict";
import { forecastServices } from "../lib/domain/forecast.js";
import { buildQuote } from "../lib/domain/quote.js";

const baseInput = {
  startDate: "2026-06-01",
  lastCompletedService: { date: "2026-03-01", odometer: 15000, serviceTablePosition: { label: "Year 1 / 15,000 km" } },
  currentOdometer: 25000,
  annualKm: 28000,
  intervalMonths: 12,
  intervalKm: 15000,
  numberOfServices: 3,
};

test("service thresholds continue from the last completed service odometer", () => {
  const forecast = forecastServices(baseInput);
  assert.deepEqual(forecast.map((point) => point.scheduledKm), [30000, 45000, 60000]);
  assert.deepEqual(forecast.map((point) => point.predictedKm), [30000, 45000, 60000]);
  assert.deepEqual(forecast.map((point) => point.serviceTablePosition.offsetFromLastCompleted), [1, 2, 3]);
  assert.equal(forecast[0].serviceTablePosition.anchor.label, "Year 1 / 15,000 km");
});

test("high annual mileage reaches the kilometre threshold before the time interval", () => {
  const [point] = forecastServices({ ...baseInput, startDate: "2026-04-01", annualKm: 60000, numberOfServices: 1 });
  assert.equal(point.trigger, "km");
  assert.equal(point.scheduledKm, 30000);
  assert.ok(point.kilometreDueDate < point.timeDueDate);
  assert.equal(point.predictedDate, point.kilometreDueDate);
});

test("low annual mileage reaches the time interval before the kilometre threshold", () => {
  const [point] = forecastServices({ ...baseInput, startDate: "2026-04-01", annualKm: 5000, numberOfServices: 1 });
  assert.equal(point.trigger, "months");
  assert.ok(point.timeDueDate < point.kilometreDueDate);
  assert.equal(point.predictedDate, "2027-03-01");
});

test("a vehicle beyond the next kilometre threshold keeps service one and marks it overdue", () => {
  const [point] = forecastServices({ ...baseInput, currentOdometer: 35000, annualKm: 15000, numberOfServices: 1 });
  assert.equal(point.number, 1);
  assert.equal(point.scheduledKm, 30000);
  assert.equal(point.trigger, "km");
  assert.equal(point.dueState, "overdue");
  assert.equal(point.predictedDate, baseInput.startDate);
});

test("a vehicle beyond the next time threshold keeps service one and marks it overdue", () => {
  const [point] = forecastServices({
    ...baseInput,
    startDate: "2027-04-01",
    lastCompletedService: { date: "2026-03-01", odometer: 15000 },
    currentOdometer: 20000,
    annualKm: 5000,
    numberOfServices: 1,
  });
  assert.equal(point.number, 1);
  assert.equal(point.trigger, "months");
  assert.equal(point.predictedDate, "2027-03-01");
  assert.equal(point.dueState, "overdue");
});

test("multiple services remain sequential through the anchored manufacturer cycle", () => {
  const forecast = forecastServices({ ...baseInput, numberOfServices: 5 });
  assert.deepEqual(forecast.map((point) => point.scheduledKm), [30000, 45000, 60000, 75000, 90000]);
  assert.deepEqual(forecast.map((point) => point.number), [1, 2, 3, 4, 5]);
  for (let index = 1; index < forecast.length; index += 1) {
    assert.ok(forecast[index].predictedDate > forecast[index - 1].predictedDate);
  }
});

test("kilometre and month intervals advance independently from their service anchors", () => {
  const forecast = forecastServices({ ...baseInput, intervalKm: 10000, intervalMonths: 6, numberOfServices: 3 });
  assert.deepEqual(forecast.map((point) => point.scheduledKm), [25000, 35000, 45000]);
  assert.deepEqual(forecast.map((point) => point.timeDueDate), ["2026-09-01", "2027-03-01", "2027-09-01"]);
  assert.equal(forecast[0].dueState, "due_now");
});

test("last service date is required, valid, and not after the forecast date", () => {
  assert.throws(() => forecastServices({ ...baseInput, lastCompletedService: { date: "", odometer: 15000 } }), /Last service date is required/);
  assert.throws(() => forecastServices({ ...baseInput, lastCompletedService: { date: "2026-02-30", odometer: 15000 } }), /valid date/);
  assert.throws(() => forecastServices({ ...baseInput, lastCompletedService: { date: "2026-06-02", odometer: 15000 } }), /future/);
});

test("last service odometer cannot exceed current odometer", () => {
  assert.throws(() => forecastServices({ ...baseInput, lastCompletedService: { date: "2026-03-01", odometer: 25001 }, currentOdometer: 25000 }), /cannot exceed current odometer/);
});

test("corrected forecast checkpoints flow unchanged into the existing funding engine", () => {
  const quote = buildQuote({
    quoteDate: "2026-06-01",
    customer: { firstName: "Forecast", lastName: "Test", mobile: "021 123 4567", email: "forecast@example.test", address: "1 Test Street" },
    vehicle: { year: "2024", make: "Toyota", model: "Corolla", registration: "FRC001", vin: "" },
    lastCompletedService: { date: "2026-06-01", odometer: "15000", serviceTablePosition: null },
    currentOdometer: "25000", annualKm: "15000", intervalMonths: "12", intervalKm: "15000", numberOfServices: "3",
    services: [
      { name: "30,000 km", price: "450.00", taxMode: "inclusive" },
      { name: "45,000 km", price: "790.00", taxMode: "inclusive" },
      { name: "60,000 km", price: "520.00", taxMode: "inclusive" },
    ],
    frequency: "weekly", firstPaymentDate: "2026-06-08",
  });

  assert.deepEqual(quote.services.map((service) => service.scheduledKm), [30000, 45000, 60000]);
  let requiredCents = 0;
  quote.services.forEach((service, index) => {
    requiredCents += service.grossCents;
    assert.equal(quote.funding.coverage[index].requiredCents, requiredCents);
    assert.ok(quote.funding.coverage[index].fundedCents >= requiredCents);
  });
  assert.ok(quote.funding.finalPaymentDate < quote.services.at(-1).predictedDate);
});
