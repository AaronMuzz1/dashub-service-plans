import { expiryRisk, getEntitlements, getPlanFinancials } from "./operations.js";
import { daysBetween } from "./dates.js";

export function buildFinanceOverview(plans, payouts, today, adjustments = []) {
  const records = Object.fromEntries([
    "collected", "future", "failures", "obligations", "upcoming", "awaitingInvoices", "payable", "nextPayout",
    "setupFees", "ongoingFees", "cancellationFees", "refunds", "forfeited", "expiryRisk", "claimReversals", "dealerOffsets",
  ].map((key) => [key, []]));
  for (const plan of plans) {
    const base = { planId: plan.id, customer: `${plan.quote.customer.firstName} ${plan.quote.customer.lastName}`, dealerGroupId: plan.dealerGroupId, branchId: plan.branchId };
    const financials = getPlanFinancials(plan);
    for (const entry of plan.ledger ?? []) {
      const target = { collection: "collected", top_up: "collected", setup_fee: "setupFees", cancellation_fee: "cancellationFees", refund: "refunds", forfeiture: "forfeited" }[entry.type];
      if (target) records[target].push({ ...base, date: entry.at.slice(0, 10), amountCents: entry.amountCents, detail: entry.note ?? entry.type.replaceAll("_", " ") });
    }
    if (["active", "completed"].includes(plan.status)) {
      if (financials.remainingObligationCents) records.obligations.push({ ...base, amountCents: financials.remainingObligationCents, detail: "Remaining contractual obligation" });
      let remaining = financials.remainingObligationCents;
      for (const payment of plan.paymentSchedule ?? []) {
        if (payment.status === "scheduled" && payment.date >= today && remaining > 0) {
          const amountCents = Math.min(payment.amountCents, remaining);
          records.future.push({ ...base, date: payment.date, amountCents, detail: payment.id });
          remaining -= amountCents;
        }
        if (payment.status === "failed" || payment.attempts.some((attempt) => attempt.outcome === "failed")) {
          records.failures.push({ ...base, date: payment.date, amountCents: payment.amountCents, detail: `${payment.id} · ${payment.status === "failed" ? "Retry needed" : "Recovered"}` });
        }
      }
      for (const entitlement of getEntitlements(plan)) {
        if (entitlement.status === "pending" && daysBetween(today, entitlement.predictedDate) >= 0 && daysBetween(today, entitlement.predictedDate) <= 90) {
          records.upcoming.push({ ...base, date: entitlement.predictedDate, amountCents: entitlement.grossCents, detail: entitlement.name });
        }
      }
      const risk = expiryRisk(plan, today);
      if (risk) records.expiryRisk.push({ ...base, date: risk.proposedExpiry, amountCents: financials.cashAvailableCents, detail: `Proposed expiry review · ${risk.daysToExpiry} days` });
    }
    for (const claim of plan.claims ?? []) {
      if (claim.reversedAt) records.claimReversals.push({ ...base, date: claim.reversedAt.slice(0, 10), amountCents: -claim.expectedCents,
        detail: `Void ${claim.poNumber} · original payout ${claim.priorPayoutId ?? claim.payoutId ?? "none"} · adjustment ${claim.adjustmentId ?? "none"} · ${claim.reversalReason}` });
      if (claim.financialStatus === "awaiting_dealer_invoice") records.awaitingInvoices.push({ ...base, date: claim.serviceDate, amountCents: claim.expectedCents, detail: claim.poNumber });
      if (["invoice_matched", "scheduled_for_payout"].includes(claim.financialStatus)) records.payable.push({ ...base, date: claim.serviceDate, amountCents: claim.invoice.amountCents, detail: `${claim.poNumber} · ${claim.financialStatus.replaceAll("_", " ")}` });
    }
  }
  for (const payout of payouts) {
    if (payout.status === "scheduled") records.nextPayout.push({ planId: payout.lines[0]?.planId, customer: payout.branchId, dealerGroupId: payout.dealerGroupId, branchId: payout.branchId, date: payout.weekEnding, amountCents: payout.netCents, detail: payout.id });
    for (const line of payout.lines) if (line.dashubFeeCents) records.ongoingFees.push({ planId: line.planId, customer: line.poNumber, dealerGroupId: payout.dealerGroupId, branchId: payout.branchId, date: payout.weekEnding, amountCents: line.dashubFeeCents, detail: "Dashub ongoing fee" });
  }
  for (const adjustment of adjustments) {
    const allocated = adjustment.offsets.filter((item) => item.status !== "void").reduce((sum, item) => sum + item.amountCents, 0);
    records.dealerOffsets.push({
      planId: adjustment.planId, customer: adjustment.originalPoNumber, dealerGroupId: adjustment.dealerGroupId, branchId: adjustment.branchId,
      date: adjustment.createdAt.slice(0, 10), amountCents: adjustment.amountCents,
      detail: `${adjustment.id} · original paid payout ${adjustment.originalPayoutId} · ${adjustment.reason} · ${allocated} cents allocated to subsequent payouts; ${-adjustment.amountCents - allocated} cents available`,
    });
  }
  const definition = [
    ["collected", "Customer payments collected", "money"],
    ["future", "Future scheduled collections", "money"],
    ["failures", "Failed payments and retries", "count"],
    ["obligations", "Plan funding obligations", "money"],
    ["upcoming", "Upcoming predicted claims", "count"],
    ["awaitingInvoices", "Claims awaiting invoices", "count"],
    ["payable", "Claims payable", "money"],
    ["nextPayout", "Next weekly dealer payout", "money"],
    ["setupFees", "Setup fees", "money"],
    ["ongoingFees", "Ongoing Dashub fees", "money"],
    ["cancellationFees", "Cancellation fees", "money"],
    ["refunds", "Refunds", "money"],
    ["forfeited", "Forfeited funds", "money"],
    ["expiryRisk", "Plans at risk of expiry", "count"],
    ["claimReversals", "Reversed service claims", "count"],
    ["dealerOffsets", "Dealer payout adjustments", "money"],
  ];
  return definition.map(([key, label, unit]) => ({ key, label, unit,
    value: unit === "count" ? records[key].length : records[key].reduce((sum, item) => sum + item.amountCents, 0),
    records: records[key],
  }));
}
