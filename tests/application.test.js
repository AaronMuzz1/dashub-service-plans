import test from "node:test";
import assert from "node:assert/strict";
import { createDemoWorkspace } from "../lib/adapters/demo-data.js";
import { createLocalPlanRepository } from "../lib/adapters/local-plan-repository.js";
import { manualServiceSource } from "../lib/adapters/manual-service-source.js";
import { createServicePlans } from "../lib/application/service-plans.js";
import { getPlanFinancials } from "../lib/domain/operations.js";

function fixture() {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const repository = createLocalPlanRepository(storage);
  repository.seed(createDemoWorkspace());
  return createServicePlans({ repository, serviceSource: manualServiceSource });
}

test("application applies dealer scope, subscription and template permissions", () => {
  const app = fixture();
  const admin = app.actor("dashub-admin");
  const advisor = app.actor("sandbox-advisor");
  const harbour = app.actor("harbour-manager");
  assert.ok(app.list(advisor).every((plan) => plan.dealerGroupId === "gazley-demo" || plan.origin === "manufacturer"));
  assert.ok(!app.list(advisor).some((plan) => plan.dealerGroupId === "harbour-demo"));
  assert.ok(app.list(harbour).some((plan) => plan.dealerGroupId === "harbour-demo"));
  assert.throws(() => app.finance(advisor, "2026-09-22"), /permission/);
  assert.ok(app.finance(admin, "2026-09-22").find((metric) => metric.key === "awaitingInvoices").records.length);
  assert.throws(() => app.saveTemplate(advisor, { brand: "Toyota" }), /permission/);
  assert.throws(() => app.saveDealerQuote(advisor, app.get(admin, "demo-manufacturer").draft, "demo-manufacturer"), /permission/);
  app.updateCompany(admin, "gazley-demo", { subscriptionActive: false });
  assert.throws(() => app.activate(admin, "demo-dealer"), /subscription/);
  assert.throws(() => app.claim(advisor, "funding-shortfall", {}), /permission/);
});

test("application persists cross-plan invoice and payout state locally", () => {
  const app = fixture();
  const admin = app.actor("dashub-admin");
  const plan = app.get(admin, "awaiting-invoice");
  const claim = plan.claims[0];
  assert.equal(claim.financialStatus, "awaiting_dealer_invoice");
  const received = app.receiveInvoice(admin, plan.id, claim.id, { invoiceNumber: "INV-NEW-205", amountCents: claim.expectedCents - 5 });
  assert.equal(received.claims[0].financialStatus, "invoice_matched");
  assert.throws(() => app.receiveInvoice(admin, "early-service", app.get(admin, "early-service").claims[0].id,
    { invoiceNumber: "INV-NEW-205", amountCents: 46000 }), /already exists/);
  const created = app.schedulePayouts(admin);
  assert.equal(created.length, 1);
  assert.equal(created[0].branchId, "harbour-north");
  assert.equal(app.get(admin, plan.id).claims[0].financialStatus, "scheduled_for_payout");
  app.markPayoutPaid(admin, created[0].id);
  assert.equal(app.get(admin, plan.id).claims[0].financialStatus, "paid");
  assert.equal(app.payouts(admin).find((item) => item.id === created[0].id).status, "paid");
  assert.ok(getPlanFinancials(app.get(admin, plan.id)).remainingObligationCents >= 0);
});
