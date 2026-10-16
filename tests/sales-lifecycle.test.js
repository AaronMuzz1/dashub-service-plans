import test from "node:test";
import assert from "node:assert/strict";
import { createDemoWorkspace } from "../lib/adapters/demo-data.js";
import { createLocalPlanRepository } from "../lib/adapters/local-plan-repository.js";
import { manualServiceSource } from "../lib/adapters/manual-service-source.js";
import { createServicePlans } from "../lib/application/service-plans.js";
import { sandboxIntegrations } from "../lib/adapters/sandbox-integrations.js";

function fixture() {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const repository = createLocalPlanRepository(storage);
  repository.seed(createDemoWorkspace());
  return createServicePlans({ repository, serviceSource: manualServiceSource });
}

function completeDraft(app, actor, suffix = "A") {
  const draft = structuredClone(app.get(actor, "demo-dealer").draft);
  draft.customer = { ...draft.customer, firstName: `Case${suffix}`, email: `case-${suffix.toLowerCase()}@example.test` };
  draft.vehicle = { ...draft.vehicle, registration: `CASE${suffix}` };
  return draft;
}

function prepareActivation(app, actor, id, at = "2026-10-17T10:00:00.000Z") {
  app.recordSignature(actor, id, { method: "digital", evidence: "data:image/png;base64,c2lnbmF0dXJl", contractVersion: "DP-CONTRACT-V1", customerName: "Test Customer" }, { at });
  app.setupPaymentMethod(actor, id, { at });
}

test("customer matching stays within dealer-group scope and sandbox AutoCheck supports manual fallback", () => {
  const app = fixture();
  const advisor = app.actor("sandbox-advisor");
  const harbour = app.actor("harbour-manager");
  const matches = app.customerMatches(advisor, "Alex");
  assert.equal(matches[0].customer.email, "alex@example.test");
  assert.ok(matches[0].lastVehicle.includes("RAV4"));
  assert.equal(app.customerMatches(harbour, "Alex").length, 0);
  const vehicle = app.lookupVehicle(advisor, "abc-123");
  assert.deepEqual({ make: vehicle.make, model: vehicle.model, year: vehicle.year }, { make: "Toyota", model: "RAV4", year: "2023" });
  assert.equal(app.lookupVehicle(advisor, "UNKNOWN"), null);
  assert.equal(vehicle.source, "autocheck_sandbox");
});

test("partial drafts save and resume at every wizard step without becoming issued quotes", () => {
  const app = fixture();
  const advisor = app.actor("sandbox-advisor");
  let draft = completeDraft(app, advisor, "D");
  draft.customer.email = "";
  let id = null;
  for (let step = 0; step < 6; step++) {
    draft.customer.firstName = `Saved step ${step + 1}`;
    const saved = app.saveDraft(advisor, draft, step, id);
    id = saved.id;
    assert.equal(saved.status, "draft");
    assert.equal(saved.currentStep, step);
    assert.equal(saved.draft.customer.firstName, `Saved step ${step + 1}`);
    assert.equal(saved.quoteRecord, undefined);
  }
  assert.equal(app.get(advisor, id).audit.filter((item) => item.action.startsWith("draft_")).length, 6);
  assert.equal(app.get(app.actor("harbour-manager"), id), null);
});

test("issued quote lifecycle honours configured validity, loss, expiry and immutable supersession", () => {
  const app = fixture();
  const admin = app.actor("dashub-admin");
  const advisor = app.actor("sandbox-advisor");
  app.updateCompany(admin, "gazley-demo", { quoteValidityDays: 45 });
  const first = app.issueQuote(advisor, "demo-dealer", { at: "2026-10-17T09:00:00.000Z" });
  assert.match(first.quoteRecord.number, /^DP-20261017-/);
  assert.equal(first.quoteRecord.expiryDate, "2026-12-01");
  assert.equal(first.quoteRecord.quotingAdvisorId, advisor.id);
  assert.equal(first.quoteRecord.currentOwnerId, advisor.id);

  const revisedDraft = structuredClone(first.draft);
  revisedDraft.customer.lastName = "Revised";
  const revision = app.saveDraft(advisor, revisedDraft, 5, null, { supersedesQuoteId: first.id });
  const second = app.issueQuote(advisor, revision.id, { at: "2026-10-18T09:00:00.000Z" });
  assert.notEqual(second.quoteRecord.number, first.quoteRecord.number);
  assert.equal(app.get(advisor, first.id).quoteRecord.status, "superseded");
  assert.equal(app.get(advisor, first.id).quote.customer.lastName, "Example");

  app.list(advisor, "2026-12-03");
  const expired = app.get(advisor, second.id, "2026-12-03");
  assert.equal(expired.status, "lost");
  assert.equal(expired.quoteRecord.status, "expired");
  assert.equal(expired.quoteRecord.lostReason, "Quote Expired");

  const thirdDraft = app.saveDraft(advisor, completeDraft(app, advisor, "L"), 5);
  const third = app.issueQuote(advisor, thirdDraft.id, { at: "2026-10-19T09:00:00.000Z" });
  const lost = app.markQuoteLost(advisor, third.id, "Price", { at: "2026-10-20T09:00:00.000Z" });
  assert.equal(lost.quoteRecord.lostReason, "Price");
  assert.throws(() => app.markQuoteLost(advisor, third.id, "Not a reason"), /outstanding|valid lost/);
});

test("manufacturer-program validity is centrally configurable while pricing stays locked", () => {
  const app = fixture();
  const admin = app.actor("dashub-admin");
  const advisor = app.actor("sandbox-advisor");
  app.updateManufacturerProgram(admin, "template-manufacturer", { quoteValidityDays: 60 });
  const draft = structuredClone(app.get(advisor, "demo-manufacturer").draft);
  const option = app.planOptions(advisor, draft).find((item) => item.id === "template-manufacturer");
  draft.planSource = { origin: "manufacturer", optionType: "manufacturer", templateId: option.id, manufacturerId: option.manufacturerId, lockedPricing: true };
  draft.numberOfServices = String(option.services.length);
  draft.intervalMonths = String(option.intervalMonths);
  draft.intervalKm = String(option.intervalKm);
  draft.services = option.services.map((item) => ({ ...item, description: item.description ?? "", taxMode: item.taxMode ?? "inclusive" }));
  const saved = app.saveDraft(advisor, draft, 5);
  const issued = app.issueQuote(advisor, saved.id, { at: "2026-10-17T09:00:00.000Z" });
  assert.equal(issued.quoteRecord.expiryDate, "2026-12-16");
  const tampered = structuredClone(issued.draft);
  tampered.services[0].price = "1.00";
  assert.throws(() => app.saveDraft(advisor, tampered, 5), /locked/);
});

test("quote PDF is a real dealer-branded PDF without service allocation prices", () => {
  const app = fixture();
  const advisor = app.actor("sandbox-advisor");
  const issued = app.issueQuote(advisor, "demo-dealer", { at: "2026-10-17T09:00:00.000Z" });
  const file = app.quotePdf(advisor, issued.id);
  const text = new TextDecoder().decode(file.bytes);
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.endsWith("%%EOF"));
  assert.ok(text.includes("Gazley Wellington"));
  assert.ok(text.includes(issued.quoteRecord.number));
  assert.ok(text.includes("Service Plan administered by Dashub"));
  assert.ok(!text.includes("12 month service - $420.00"));
  assert.ok(!text.includes("Dashub fee"));
  assert.equal(file.mimeType, "application/pdf");
});

test("changed first-payment date requires explicit instalment confirmation", () => {
  const app = fixture();
  const advisor = app.actor("sandbox-advisor");
  const draft = completeDraft(app, advisor, "P");
  draft.firstPaymentDate = "2026-12-01";
  draft.paymentChangeConfirmed = false;
  const saved = app.saveDraft(advisor, draft, 5);
  assert.equal(saved.quote.paymentChange.requiresConfirmation, true);
  assert.notEqual(saved.quote.paymentChange.amountDifferenceCents, 0);
  assert.throws(() => app.issueQuote(advisor, saved.id, { at: "2026-10-17T09:00:00.000Z" }), /Confirm the changed instalment/);
  draft.paymentChangeConfirmed = true;
  app.saveDraft(advisor, draft, 5, saved.id);
  assert.equal(app.issueQuote(advisor, saved.id, { at: "2026-10-17T09:00:00.000Z" }).status, "quote");
});

test("signature and payment setup are both required; activation awaits first payment then becomes Live", () => {
  const app = fixture();
  const manager = app.actor("gazley-manager");
  const saved = app.saveDraft(manager, completeDraft(app, manager, "A"), 5);
  assert.throws(() => app.activate(manager, saved.id, { at: "2026-10-17T11:00:00.000Z" }), /signature and payment-method/);
  app.recordSignature(manager, saved.id, { method: "physical", confirmedHeldByDealer: true, contractVersion: "DP-CONTRACT-V1" }, { at: "2026-10-17T10:00:00.000Z" });
  assert.throws(() => app.activate(manager, saved.id, { at: "2026-10-17T11:00:00.000Z" }), /signature and payment-method/);
  app.setupPaymentMethod(manager, saved.id, { at: "2026-10-17T10:30:00.000Z" });
  const active = app.activate(manager, saved.id, { at: "2026-10-17T11:00:00.000Z" });
  assert.equal(active.operationalStatus, "awaiting_first_payment");
  assert.equal(active.directSale, true);
  assert.equal(active.sellingAdvisorId, manager.id);
  assert.equal(active.contract.signature.method, "physical");
  assert.equal(active.contractDelivery.length, 2);
  assert.ok(active.contractDelivery.every((item) => item.status === "sandbox_logged" && item.live === false));
  assert.equal(active.activation.paymentMethod.cardNumber, undefined);
  assert.equal(active.activation.paymentMethod.cvc, undefined);
  assert.equal(active.ledger.some((entry) => entry.type === "setup_fee"), false);
  const live = app.simulatePayment(manager, active.id, "PAY-1", "success");
  assert.equal(live.operationalStatus, "live");
  assert.equal(live.ledger.find((entry) => entry.type === "setup_fee").amountCents, 4900);
});

test("sandbox payment integration never accepts card data in the persisted token", () => {
  const method = sandboxIntegrations.paymentProvider.setupPaymentMethod({ customerName: "Safe Customer", cardNumber: "4111111111111111", cvc: "123" });
  assert.equal(method.cardNumber, undefined);
  assert.equal(method.cvc, undefined);
  assert.equal(method.live, false);
  assert.match(method.token, /^pm_/);
});
