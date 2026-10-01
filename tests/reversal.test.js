import test from "node:test";
import assert from "node:assert/strict";
import { createDemoWorkspace } from "../lib/adapters/demo-data.js";
import { createLocalPlanRepository } from "../lib/adapters/local-plan-repository.js";
import { manualServiceSource } from "../lib/adapters/manual-service-source.js";
import { createServicePlans } from "../lib/application/service-plans.js";
import { getEntitlements, getPlanFinancials, markWeeklyPayoutPaid, receiveDealerInvoice, reverseServiceClaim, scheduleWeeklyPayouts } from "../lib/domain/operations.js";

function fixture() {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const repository = createLocalPlanRepository(storage);
  repository.seed(createDemoWorkspace());
  return createServicePlans({ repository, serviceSource: manualServiceSource });
}

test("manager reverses pre-invoice claim with restored entitlement, PO and append-only ledger/audit", () => {
  const app = fixture();
  const manager = app.actor("harbour-manager");
  const before = app.get(manager, "awaiting-invoice");
  const claim = before.claims[0];
  const financial = getPlanFinancials(before);
  assert.ok(claim.dealerShortfallCents > 0);
  assert.throws(() => app.reverseClaim(manager, before.id, claim.id, ""), /reason/);
  const result = app.reverseClaim(manager, before.id, claim.id, "RO cancelled");
  const after = app.get(manager, before.id);
  assert.equal(result.adjustment, null);
  assert.equal(after.claims.length, before.claims.length);
  assert.equal(after.claims[0].financialStatus, "reversed");
  assert.equal(after.claims[0].poStatus, "void");
  assert.equal(after.claims[0].reversalReason, "RO cancelled");
  assert.equal(getEntitlements(after)[0].status, "pending");
  assert.equal(getPlanFinancials(after).cashAvailableCents, financial.cashAvailableCents + claim.cashAppliedCents);
  assert.equal(getPlanFinancials(after).remainingObligationCents, financial.remainingObligationCents + claim.dealerShortfallCents);
  assert.equal(after.ledger.filter((entry) => entry.type === "dealer_shortfall").length, 1);
  assert.equal(after.ledger.at(-1).type, "dealer_shortfall_reversal");
  assert.equal(after.ledger.at(-1).amountCents, -claim.dealerShortfallCents);
  const audit = after.audit.at(-1);
  assert.equal(audit.actorId, manager.id);
  assert.equal(audit.reason, "RO cancelled");
  assert.equal(audit.before.plan.claims[0].financialStatus, "awaiting_dealer_invoice");
  assert.equal(audit.after.plan.claims[0].financialStatus, "reversed");
  assert.equal(before.claims[0].financialStatus, "awaiting_dealer_invoice");
  assert.throws(() => app.reverseClaim(manager, before.id, claim.id, "again"), /unreversed/);
  const reclaimed = app.claim(manager, before.id, {
    serviceNumber: 1, currentOdometer: claim.currentOdometer, roNumber: "RO-REPLACEMENT",
    serviceDate: claim.serviceDate, completed: true, dealerCollectedShortfallCents: getPlanFinancials(after).nextServiceShortfallCents,
  });
  assert.equal(reclaimed.claims.length, 2);
  assert.equal(reclaimed.claims[0].poStatus, "void");
  assert.equal(reclaimed.claims[1].serviceNumber, 1);
  assert.notEqual(reclaimed.claims[1].poNumber, claim.poNumber);
  assert.equal(getEntitlements(reclaimed)[0].status, "claimed");
});

test("invoice match remains preserved but void after reversal before payout", () => {
  const app = fixture();
  const admin = app.actor("dashub-admin");
  const original = app.get(admin, "awaiting-invoice");
  const claimId = original.claims[0].id;
  app.receiveInvoice(admin, original.id, claimId, { invoiceNumber: "INV-VOID-205", amountCents: original.claims[0].expectedCents + 5 });
  const result = app.reverseClaim(admin, original.id, claimId, "Duplicate RO");
  const claim = result.plan.claims[0];
  assert.equal(claim.invoice.number, "INV-VOID-205");
  assert.equal(claim.invoice.matched, true);
  assert.equal(claim.invoice.status, "void");
  assert.equal(claim.invoice.statusBeforeVoid, "invoice_matched");
  assert.equal(claim.financialStatus, "reversed");
  assert.equal(app.schedulePayouts(admin).length, 0);
  assert.ok(result.plan.audit.some((entry) => entry.action === "invoice_matched"));
  assert.equal(app.finance(admin, "2026-09-22").find((item) => item.key === "claimReversals").records.length, 1);
});

test("scheduled payout removes claim line but retains voided remittance history", () => {
  const app = fixture();
  const admin = app.actor("dashub-admin");
  const before = app.get(admin, "awaiting-payout");
  const claim = before.claims[0];
  const payoutBefore = app.payouts(admin).find((item) => item.id === claim.payoutId);
  const result = app.reverseClaim(admin, before.id, claim.id, "Service not delivered");
  const payout = result.payouts.find((item) => item.id === payoutBefore.id);
  assert.equal(payout.status, "void");
  assert.equal(payout.lines.length, 0);
  assert.equal(payout.voidedLines.length, 1);
  assert.equal(payout.voidedLines[0].poNumber, claim.poNumber);
  assert.equal(payout.netCents, 0);
  assert.equal(result.plan.claims[0].priorPayoutId, payout.id);
  assert.equal(result.plan.claims[0].payoutId, null);
  assert.equal(getEntitlements(result.plan)[0].status, "pending");
  assert.equal(payoutBefore.status, "scheduled");
  assert.equal(payoutBefore.lines.length, 1);
  assert.equal(result.plan.audit.at(-1).before.payout.lines.length, 1);
  assert.equal(result.plan.audit.at(-1).after.payout.lines.length, 0);
});

test("paid payout stays immutable; negative dealer adjustment offsets next weekly payout", () => {
  const app = fixture();
  const admin = app.actor("dashub-admin");
  const before = app.get(admin, "completed-plan");
  const claim = before.claims[0];
  const originalPayout = app.payouts(admin).find((item) => item.id === claim.payoutId);
  const originalJSON = JSON.stringify(originalPayout);
  const result = app.reverseClaim(admin, before.id, claim.id, "Service reversal after settlement");
  const adjustment = result.adjustment;
  assert.equal(result.plan.status, "active");
  assert.equal(getEntitlements(result.plan)[0].status, "pending");
  assert.equal(JSON.stringify(app.payouts(admin).find((item) => item.id === originalPayout.id)), originalJSON);
  assert.equal(adjustment.amountCents, -originalPayout.lines[0].netCents);
  assert.equal(adjustment.originalPayoutId, originalPayout.id);
  assert.equal(result.plan.claims[0].adjustmentId, adjustment.id);
  assert.equal(result.plan.audit.at(-1).adjustmentId, adjustment.id);
  const early = app.get(admin, "early-service");
  app.receiveInvoice(admin, early.id, early.claims[0].id, { invoiceNumber: "INV-OFFSET-204", amountCents: early.claims[0].expectedCents });
  const [nextPayout] = app.schedulePayouts(admin);
  assert.equal(nextPayout.dealerGroupId, "alpine-demo");
  assert.equal(nextPayout.adjustments.length, 1);
  assert.equal(nextPayout.adjustmentCents, adjustment.amountCents);
  assert.equal(nextPayout.netCents, nextPayout.grossCents - nextPayout.feesCents + adjustment.amountCents);
  assert.equal(app.adjustments(admin)[0].offsets[0].status, "scheduled");
  app.markPayoutPaid(admin, nextPayout.id);
  assert.equal(app.adjustments(admin)[0].offsets[0].status, "paid");
  assert.equal(JSON.stringify(app.payouts(admin).find((item) => item.id === originalPayout.id)), originalJSON);
  const finance = app.finance(admin, "2026-09-22");
  const row = finance.find((item) => item.key === "dealerOffsets").records[0];
  assert.match(row.detail, new RegExp(originalPayout.id));
  assert.match(row.detail, /cents allocated/);
  assert.equal(row.amountCents, adjustment.amountCents);
});

test("reversing a newly scheduled claim releases its earlier paid-claim offset for another payout", () => {
  const app = fixture();
  const admin = app.actor("dashub-admin");
  const paid = app.get(admin, "completed-plan");
  const adjustment = app.reverseClaim(admin, paid.id, paid.claims[0].id, "Paid correction").adjustment;
  const early = app.get(admin, "early-service");
  app.receiveInvoice(admin, early.id, early.claims[0].id, { invoiceNumber: "INV-RELEASE-204", amountCents: early.claims[0].expectedCents });
  const [scheduled] = app.schedulePayouts(admin);
  assert.equal(scheduled.adjustmentCents, adjustment.amountCents);
  app.reverseClaim(admin, early.id, early.claims[0].id, "RO withdrawn before payout");
  const batch = app.payouts(admin).find((item) => item.id === scheduled.id);
  assert.equal(batch.status, "void");
  assert.equal(batch.netCents, 0);
  assert.equal(batch.adjustments[0].status, "void");
  assert.equal(app.adjustments(admin)[0].offsets[0].status, "void");
  assert.equal(app.adjustments(admin)[0].amountCents, adjustment.amountCents);
  assert.throws(() => app.markPayoutPaid(admin, scheduled.id), /scheduled payout/);
});

test("a dealer adjustment only offsets available net and carries its remainder forward", () => {
  const workspace = createDemoWorkspace();
  const paid = workspace.plans.find((item) => item.id === "completed-plan");
  const claim = paid.claims[0];
  const reversed = reverseServiceClaim(paid, workspace.payouts, [], claim.id, "Correct paid service", { at: "2026-09-22T10:00:00Z", actorId: "dashub-admin" });
  let early = structuredClone(workspace.plans.find((item) => item.id === "early-service"));
  early.contract.commercialTerms.ongoingFeeCents = 35000; // A valid but high fee leaves only $110 net to offset.
  early = receiveDealerInvoice(early, early.claims[0].id, { invoiceNumber: "INV-PARTIAL-204", amountCents: 46000 }, { at: "2026-09-22T10:10:00Z" });
  const scheduled = scheduleWeeklyPayouts([early], reversed.payouts, { at: "2026-09-22T11:00:00Z" }, reversed.adjustments);
  const batch = scheduled.created[0];
  assert.equal(batch.adjustmentCents, -11000);
  assert.equal(batch.netCents, 0);
  assert.equal(scheduled.adjustments[0].offsets[0].amountCents, 11000);
  const paidNext = markWeeklyPayoutPaid(scheduled.plans, scheduled.payouts, batch.id, { at: "2026-09-25T10:00:00Z" }, scheduled.adjustments);
  assert.equal(paidNext.adjustments[0].offsets[0].status, "paid");
  assert.equal(-paidNext.adjustments[0].amountCents - paidNext.adjustments[0].offsets[0].amountCents, 26000);
});

test("advisor denial and manager tenant boundary are enforced in application layer", () => {
  const app = fixture();
  const advisor = app.actor("sandbox-advisor");
  const manager = app.actor("harbour-manager");
  const gazley = app.get(advisor, "awaiting-payout");
  assert.throws(() => app.reverseClaim(advisor, gazley.id, gazley.claims[0].id, "Attempt"), /permission/);
  assert.throws(() => app.reverseClaim(manager, gazley.id, gazley.claims[0].id, "Attempt"), /outside your access/);
  const harbour = app.get(manager, "awaiting-invoice");
  assert.equal(app.reverseClaim(manager, harbour.id, harbour.claims[0].id, "Manager correction").plan.claims[0].reversedBy, manager.id);
});
