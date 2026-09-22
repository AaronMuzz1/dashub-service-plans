import test from "node:test";
import assert from "node:assert/strict";
import { buildQuote } from "../lib/domain/quote.js";
import { activateQuote, cancelPlan, claimNextService, getPlanFinancials, markWeeklyPayoutPaid, nextWeeklyPayoutDate, receiveDealerInvoice, recordTopUp, resolveInvoiceException, scheduleWeeklyPayouts, simulateScheduledPayment } from "../lib/domain/operations.js";
import { createDemoWorkspace } from "../lib/adapters/demo-data.js";

let sequence = 0;
const ctx = (date = "2026-05-01") => ({ at: `${date}T10:00:00.000Z`, actorId: "test", idFactory: () => `record-${++sequence}` });
function quotePlan(id = "plan", branchId = "branch") {
  const draft = {
    quoteDate: "2026-01-01", customer: { firstName: "Test", lastName: "Customer", mobile: "021 123 4567", email: "test@example.test", address: "1 Test Road" },
    vehicle: { year: "2022", make: "Toyota", model: "RAV4", registration: "TEST01", vin: "" },
    currentOdometer: "40000", annualKm: "12000", intervalMonths: "6", intervalKm: "15000", numberOfServices: "2",
    frequency: "monthly", firstPaymentDate: "2026-01-05",
    services: [{ name: "First", price: "500.00", taxMode: "inclusive" }, { name: "Second", price: "900.00", taxMode: "inclusive" }],
  };
  return { id, origin: "dealer", status: "quote", dealerGroupId: "dealer", branchId, quote: buildQuote(draft), draft, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
}
const terms = { setupFeeCents: 4900, ongoingFeeCents: 1500, providerFeeCents: 125, providerFeeTreatment: "dealer" };
const activate = (plan) => activateQuote(plan, { subscriptionActive: true, commercialTerms: terms }, ctx("2026-01-02"));

test("activation requires subscription and snapshots contract and setup fee", () => {
  const quote = quotePlan();
  assert.throws(() => activateQuote(quote, { subscriptionActive: false, commercialTerms: terms }, ctx()), /subscription/);
  const active = activate(quote);
  assert.equal(active.status, "active");
  assert.equal(active.contract.totalCents, 140000);
  assert.equal(active.contract.commercialTerms.setupFeeCents, 4900);
  assert.equal(active.revisions.length, 1);
  assert.equal(active.ledger[0].type, "setup_fee");
  quote.draft.services[0].price = "999.00";
  assert.equal(active.contract.services[0].grossCents, 50000);
});

test("failed payment stays active, retry clears issue, and top-up caps remaining obligation", () => {
  let plan = activate(quotePlan());
  plan = simulateScheduledPayment(plan, "PAY-1", "success", ctx());
  plan = simulateScheduledPayment(plan, "PAY-2", "failure", ctx());
  assert.equal(plan.status, "active");
  assert.equal(getPlanFinancials(plan).failedPayments.length, 1);
  plan = simulateScheduledPayment(plan, "PAY-2", "retry_success", ctx());
  assert.equal(getPlanFinancials(plan).failedPayments.length, 0);
  assert.equal(plan.paymentSchedule[1].attempts.length, 2);
  const remaining = getPlanFinancials(plan).remainingObligationCents;
  assert.throws(() => recordTopUp(plan, remaining + 1, ctx()), /cannot exceed/);
  plan = recordTopUp(plan, remaining - 100, ctx());
  assert.equal(getPlanFinancials(plan).remainingObligationCents, 100);
  plan = simulateScheduledPayment(plan, "PAY-3", "success", ctx());
  assert.equal(plan.paymentSchedule[2].collectedCents, 100);
  assert.equal(getPlanFinancials(plan).remainingObligationCents, 0);
  assert.throws(() => simulateScheduledPayment(plan, "PAY-4", "success", ctx()), /already satisfied/);
});

test("sequential early claim logs PO and dealer shortfall satisfies customer obligation", () => {
  let plan = activate(quotePlan());
  plan = simulateScheduledPayment(plan, "PAY-1", "success", ctx());
  assert.throws(() => claimNextService(plan, { serviceNumber: 2 }, ctx()), /next sequential/);
  const shortfall = getPlanFinancials(plan).nextServiceShortfallCents;
  assert.ok(shortfall > 0);
  assert.throws(() => claimNextService(plan, { serviceNumber: 1, completed: true, roNumber: "RO1", serviceDate: "2026-05-01", currentOdometer: 46000, dealerCollectedShortfallCents: 0 }, ctx()), /shortfall/);
  plan = claimNextService(plan, { serviceNumber: 1, completed: true, roNumber: "RO1", serviceDate: "2026-05-01", currentOdometer: 46000, dealerCollectedShortfallCents: shortfall }, ctx());
  assert.equal(plan.claims[0].earlyClaim, true);
  assert.match(plan.claims[0].poNumber, /^SP-20260501-/);
  assert.equal(plan.claims[0].financialStatus, "awaiting_dealer_invoice");
  assert.equal(plan.audit.at(-1).action, "early_claim");
  assert.equal(getPlanFinancials(plan).remainingObligationCents, 90000);
  assert.equal(getPlanFinancials(plan).cashAvailableCents, 0);
  assert.throws(() => claimNextService(plan, { serviceNumber: 1 }, ctx()), /next sequential/);
});

test("invoice tolerance is inclusive at five cents, one invoice per PO, exception can be reviewed", () => {
  let plan = activate(quotePlan());
  plan = claimNextService(plan, { serviceNumber: 1, completed: true, roNumber: "RO2", serviceDate: "2026-07-01", currentOdometer: 47000, dealerCollectedShortfallCents: 50000 }, ctx("2026-07-01"));
  const id = plan.claims[0].id;
  const matched = receiveDealerInvoice(plan, id, { invoiceNumber: "INV-1", amountCents: 50005 }, ctx());
  assert.equal(matched.claims[0].financialStatus, "invoice_matched");
  assert.throws(() => receiveDealerInvoice(matched, id, { invoiceNumber: "INV-2", amountCents: 50000 }, ctx()), /one dealer invoice/);
  let exception = receiveDealerInvoice(plan, id, { invoiceNumber: "INV-3", amountCents: 50006 }, ctx());
  assert.equal(exception.claims[0].financialStatus, "exception");
  exception = resolveInvoiceException(exception, id, "Approved variance in sandbox", ctx());
  assert.equal(exception.claims[0].financialStatus, "invoice_matched");
  assert.equal(exception.claims[0].invoice.resolution.reason, "Approved variance in sandbox");
});

test("weekly consolidated payouts group branches and calculate gross, fees, net", () => {
  const makeMatched = (id, branch) => {
    let plan = activate(quotePlan(id, branch));
    plan = claimNextService(plan, { serviceNumber: 1, completed: true, roNumber: `RO-${id}`, serviceDate: "2026-07-01", currentOdometer: 47000, dealerCollectedShortfallCents: 50000 }, ctx("2026-07-01"));
    return receiveDealerInvoice(plan, plan.claims[0].id, { invoiceNumber: `INV-${id}`, amountCents: 50000 }, ctx());
  };
  const plans = [makeMatched("one", "central"), makeMatched("two", "central"), makeMatched("three", "north")];
  const result = scheduleWeeklyPayouts(plans, [], ctx("2026-07-02"));
  assert.equal(result.created.length, 2);
  const central = result.created.find((payout) => payout.branchId === "central");
  assert.equal(central.lines.length, 2);
  assert.equal(central.grossCents, 100000);
  assert.equal(central.feesCents, 3250);
  assert.equal(central.netCents, 96750);
  assert.equal(central.weekEnding, "2026-07-03");
  assert.equal(result.plans[0].claims[0].financialStatus, "scheduled_for_payout");
  const paid = markWeeklyPayoutPaid(result.plans, result.payouts, central.id, ctx("2026-07-03"));
  assert.equal(paid.payouts.find((item) => item.id === central.id).status, "paid");
  assert.equal(paid.plans[0].claims[0].financialStatus, "paid");
  assert.equal(paid.plans[2].claims[0].financialStatus, "scheduled_for_payout");
  assert.equal(nextWeeklyPayoutDate("2026-07-03"), "2026-07-10");
});

test("cancellation refund uses cleared funds less claims and fee; seed covers requested states", () => {
  let plan = activate(quotePlan());
  plan = recordTopUp(plan, 100000, ctx());
  plan = claimNextService(plan, { serviceNumber: 1, completed: true, roNumber: "RO3", serviceDate: "2026-07-01", currentOdometer: 47000, dealerCollectedShortfallCents: 0 }, ctx("2026-07-01"));
  const cancelled = cancelPlan(plan, 5000, ctx());
  assert.equal(cancelled.ledger.find((entry) => entry.type === "refund").amountCents, 45000);
  const workspace = createDemoWorkspace();
  assert.equal(workspace.companies.length, 3);
  assert.ok(workspace.plans.some((item) => item.scenario === "Genuine funding shortfall"));
  assert.ok(workspace.plans.some((item) => item.claims?.some((claim) => claim.earlyClaim)));
  assert.ok(workspace.plans.some((item) => item.claims?.some((claim) => claim.financialStatus === "exception")));
});
