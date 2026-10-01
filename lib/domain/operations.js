import { addDays, daysBetween, parseDateOnly } from "./dates.js";

export const CLAIM_FINANCIAL_STATUS = Object.freeze({
  awaiting_dealer_invoice: "Awaiting Dealer Invoice",
  invoice_matched: "Invoice Matched",
  exception: "Exception",
  scheduled_for_payout: "Scheduled for Payout",
  paid: "Paid",
  reversed: "Reversed / Voided",
});

const copy = (value) => JSON.parse(JSON.stringify(value));
const key = (context) => context?.idFactory?.() ?? context?.id ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const timestamp = (context) => context?.at ?? new Date().toISOString();
const datePart = (value) => value.slice(0, 10);

function assertCents(value, label, allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(`${label} must be a valid amount in cents.`);
}

function activePlan(plan) {
  if (!plan?.contract || !["active", "completed"].includes(plan.status)) throw new Error("An active plan is required.");
}

function log(plan, context, action, summary) {
  plan.audit ??= [];
  plan.audit.push({ id: key(context), at: timestamp(context), actorId: context?.actorId ?? "sandbox", action, summary });
  plan.updatedAt = timestamp(context);
}

export function getEntitlements(plan) {
  const claims = (plan.claims ?? []).filter((claim) => !claim.reversedAt);
  return (plan.contract?.services ?? plan.quote.services).map((service, index) => ({
    ...service,
    status: claims.some((claim) => claim.serviceNumber === index + 1) ? "claimed" : "pending",
    claim: claims.find((claim) => claim.serviceNumber === index + 1) ?? null,
  }));
}

export function getPlanFinancials(plan) {
  const ledger = plan.ledger ?? [];
  const sum = (...types) => ledger.filter((entry) => types.includes(entry.type)).reduce((total, entry) => total + entry.amountCents, 0);
  const customerCollectedCents = sum("collection", "top_up");
  const dealerShortfallCents = sum("dealer_shortfall", "dealer_shortfall_reversal");
  const cashAppliedCents = (plan.claims ?? []).filter((claim) => !claim.reversedAt).reduce((total, claim) => total + claim.cashAppliedCents, 0);
  const refundedCents = sum("refund");
  const totalCents = plan.contract?.totalCents ?? plan.quote.funding.totalCents;
  const remainingObligationCents = Math.max(0, totalCents - customerCollectedCents - dealerShortfallCents);
  const cashAvailableCents = Math.max(0, customerCollectedCents - cashAppliedCents - refundedCents);
  const next = getEntitlements(plan).find((service) => service.status === "pending");
  return {
    totalCents, customerCollectedCents, dealerShortfallCents, cashAvailableCents,
    remainingObligationCents, refundedCents,
    nextServiceShortfallCents: next ? Math.max(0, next.grossCents - cashAvailableCents) : 0,
    failedPayments: (plan.paymentSchedule ?? []).filter((payment) => payment.status === "failed"),
    futureScheduledCents: Math.min(remainingObligationCents, (plan.paymentSchedule ?? []).filter((payment) => payment.status === "scheduled").reduce((sum, payment) => sum + payment.amountCents, 0)),
  };
}

export function activateQuote(plan, { subscriptionActive, commercialTerms }, context) {
  if (plan.status !== "quote" || plan.contract) throw new Error("Only an unsold quote can be activated.");
  if (!subscriptionActive) throw new Error("An active Service Plans subscription is required.");
  const terms = {
    setupFeeCents: commercialTerms?.setupFeeCents ?? 0,
    ongoingFeeCents: commercialTerms?.ongoingFeeCents ?? 0,
    providerFeeCents: commercialTerms?.providerFeeCents ?? 0,
    providerFeeTreatment: commercialTerms?.providerFeeTreatment ?? "dashub",
  };
  for (const [name, amount] of Object.entries(terms).filter(([name]) => name.endsWith("Cents"))) assertCents(amount, name, true);
  if (!["dashub", "dealer"].includes(terms.providerFeeTreatment)) throw new Error("Invalid provider fee treatment.");
  const result = copy(plan);
  const at = timestamp(context);
  result.status = "active";
  result.contract = {
    revision: 1, activatedAt: at, contractingParty: "Dashub", totalCents: result.quote.funding.totalCents,
    frequency: result.quote.frequency, firstPaymentDate: result.quote.firstPaymentDate,
    services: copy(result.quote.services), commercialTerms: terms,
  };
  result.revisions = [{ number: 1, at, reason: "Initial activation", consentRecorded: true, contract: copy(result.contract) }];
  result.paymentSchedule = result.quote.funding.payments.map((payment, index) => ({
    id: `PAY-${index + 1}`, date: payment.date, amountCents: payment.amountCents, status: "scheduled", collectedCents: 0, attempts: [],
  }));
  result.ledger = terms.setupFeeCents ? [{ id: key(context), type: "setup_fee", amountCents: terms.setupFeeCents, at, note: "Sandbox activation charge" }] : [];
  result.claims = [];
  log(result, context, "plan_activated", "Contract revision 1 activated; setup fee recorded in sandbox.");
  return result;
}

export function simulateScheduledPayment(plan, paymentId, outcome, context) {
  activePlan(plan);
  if (!["success", "failure", "retry_success"].includes(outcome)) throw new Error("Invalid payment outcome.");
  const result = copy(plan);
  const payment = result.paymentSchedule.find((item) => item.id === paymentId);
  if (!payment) throw new Error("Scheduled payment was not found.");
  if (outcome === "retry_success" ? payment.status !== "failed" : payment.status !== "scheduled") {
    throw new Error("Payment is not eligible for this action.");
  }
  const at = timestamp(context);
  if (outcome === "failure") {
    payment.status = "failed";
    payment.attempts.push({ at, outcome: "failed", amountCents: 0 });
    log(result, context, "payment_failed", `${payment.id} failed; plan remains active.`);
    return result;
  }
  const amountCents = Math.min(payment.amountCents, getPlanFinancials(result).remainingObligationCents);
  if (amountCents <= 0) throw new Error("The contractual amount is already satisfied.");
  payment.status = "succeeded";
  payment.collectedCents = amountCents;
  payment.attempts.push({ at, outcome: outcome === "retry_success" ? "retry_succeeded" : "succeeded", amountCents });
  result.ledger.push({ id: key(context), type: "collection", amountCents, at, paymentId, note: outcome === "retry_success" ? "Successful retry" : "Scheduled payment" });
  log(result, context, outcome === "retry_success" ? "payment_recovered" : "payment_collected", `${payment.id} collected in sandbox.`);
  return result;
}

export function recordTopUp(plan, amountCents, context) {
  activePlan(plan);
  assertCents(amountCents, "Top-up");
  const remaining = getPlanFinancials(plan).remainingObligationCents;
  if (amountCents > remaining) throw new Error("Top-up cannot exceed the remaining contractual amount.");
  const result = copy(plan);
  result.ledger.push({ id: key(context), type: "top_up", amountCents, at: timestamp(context), note: "Customer one-off top-up" });
  log(result, context, "top_up", `Customer top-up of ${amountCents} cents recorded.`);
  return result;
}

export function claimNextService(plan, input, context) {
  if (plan?.status !== "active") throw new Error("An active plan is required to claim.");
  const claims = (plan.claims ?? []).filter((claim) => !claim.reversedAt);
  const serviceNumber = plan.contract.services.findIndex((service, index) => !claims.some((claim) => claim.serviceNumber === index + 1)) + 1;
  if (input?.serviceNumber !== serviceNumber) throw new Error("Only the next sequential unclaimed service can be claimed.");
  const service = plan.contract.services[serviceNumber - 1];
  if (!service) throw new Error("All service entitlements have been claimed.");
  if (!input.completed) throw new Error("Confirm that the service was completed.");
  const roNumber = String(input.roNumber ?? "").trim();
  if (!roNumber) throw new Error("RO number is required.");
  parseDateOnly(input.serviceDate);
  if (input.serviceDate < datePart(plan.contract.activatedAt)) throw new Error("Service date cannot precede activation.");
  const previousClaim = [...claims].reverse().find((claim) => claim.serviceNumber < serviceNumber);
  const laterClaim = claims.find((claim) => claim.serviceNumber > serviceNumber);
  if (previousClaim && input.serviceDate < previousClaim.serviceDate) throw new Error("Service date cannot precede the previous claim.");
  if (laterClaim && input.serviceDate > laterClaim.serviceDate) throw new Error("Service date cannot follow the next claimed service.");
  const odometer = Number(input.currentOdometer);
  if (input.currentOdometer === "" || input.currentOdometer == null || !Number.isSafeInteger(odometer) || odometer < (previousClaim?.currentOdometer ?? plan.quote.currentOdometer) || (laterClaim && odometer > laterClaim.currentOdometer)) throw new Error("Enter a current odometer consistent with adjacent claims.");
  const available = getPlanFinancials(plan).cashAvailableCents;
  const shortfallCents = Math.max(0, service.grossCents - available);
  if (input.dealerCollectedShortfallCents !== shortfallCents) throw new Error(`Dealer-collected shortfall must equal ${shortfallCents} cents.`);
  const result = copy(plan);
  const id = key(context);
  const at = timestamp(context);
  const earlyClaim = daysBetween(input.serviceDate, service.predictedDate) >= 30;
  const claim = {
    id, serviceNumber, serviceName: service.name, expectedCents: service.grossCents,
    predictedDate: service.predictedDate, predictedKm: service.predictedKm,
    serviceDate: input.serviceDate, currentOdometer: odometer, roNumber,
    completed: true, earlyClaim, dealerShortfallCents: shortfallCents,
    cashAppliedCents: service.grossCents - shortfallCents,
    poNumber: `SP-${datePart(at).replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`, poStatus: "open",
    financialStatus: "awaiting_dealer_invoice", invoice: null, payoutId: null, createdAt: at,
  };
  result.claims.push(claim);
  if (claim.cashAppliedCents) result.ledger.push({ id: key(context), type: "claim_funding_applied", amountCents: -claim.cashAppliedCents, at, claimId: id, note: `Funding applied to ${claim.poNumber}` });
  if (shortfallCents) result.ledger.push({ id: key(context), type: "dealer_shortfall", amountCents: shortfallCents, at, claimId: id, note: "Collected directly by dealer; reduces remaining obligation" });
  if (getEntitlements(result).every((item) => item.status === "claimed")) result.status = "completed";
  log(result, context, earlyClaim ? "early_claim" : "service_claimed", `Service ${serviceNumber} claimed under ${claim.poNumber}${earlyClaim ? " (Early Claim)" : ""}.`);
  return result;
}

export function receiveDealerInvoice(plan, claimId, input, context) {
  activePlan(plan);
  const result = copy(plan);
  const claim = result.claims.find((item) => item.id === claimId && !item.reversedAt);
  if (!claim) throw new Error("Claim was not found.");
  if (claim.invoice) throw new Error("Only one dealer invoice is allowed per service PO.");
  if (claim.financialStatus !== "awaiting_dealer_invoice") throw new Error("Claim is not awaiting an invoice.");
  const invoiceNumber = String(input?.invoiceNumber ?? "").trim();
  if (!invoiceNumber) throw new Error("Invoice number is required.");
  assertCents(input.amountCents, "Invoice amount");
  const matched = Math.abs(input.amountCents - claim.expectedCents) <= 5;
  claim.invoice = { number: invoiceNumber, poNumber: claim.poNumber, amountCents: input.amountCents, receivedAt: timestamp(context), matched, resolution: null };
  claim.financialStatus = matched ? "invoice_matched" : "exception";
  log(result, context, matched ? "invoice_matched" : "invoice_exception", `Invoice ${invoiceNumber} received for ${claim.poNumber}; ${matched ? "matched" : "exception"}.`);
  return result;
}

export function resolveInvoiceException(plan, claimId, reason, context) {
  activePlan(plan);
  const result = copy(plan);
  const claim = result.claims.find((item) => item.id === claimId);
  if (!claim || claim.financialStatus !== "exception") throw new Error("An invoice exception is required.");
  if (!String(reason ?? "").trim()) throw new Error("Exception resolution reason is required.");
  claim.invoice.resolution = { reason: reason.trim(), at: timestamp(context), actorId: context?.actorId ?? "sandbox" };
  claim.financialStatus = "invoice_matched";
  log(result, context, "invoice_exception_resolved", `Invoice ${claim.invoice.number} exception approved: ${reason.trim()}`);
  return result;
}

const planSnapshot = (plan) => {
  const snapshot = copy(plan);
  delete snapshot.audit; // Audit events hold snapshots; avoid nesting prior snapshots.
  return snapshot;
};

function payoutTotals(payout) {
  payout.grossCents = payout.lines.reduce((sum, line) => sum + line.grossCents, 0);
  payout.feesCents = payout.lines.reduce((sum, line) => sum + line.dashubFeeCents + line.providerFeeCents, 0);
  payout.adjustmentCents = (payout.adjustments ?? []).filter((item) => item.status !== "void").reduce((sum, item) => sum + item.amountCents, 0);
  payout.netCents = payout.grossCents - payout.feesCents + payout.adjustmentCents;
}

function releaseScheduledOffsets(payout, adjustments, context) {
  let excess = Math.max(0, -payout.netCents);
  for (const line of [...(payout.adjustments ?? [])].reverse()) {
    if (!excess || line.status !== "scheduled") continue;
    const adjustment = adjustments.find((item) => item.id === line.adjustmentId);
    const offset = adjustment?.offsets.find((item) => item.payoutId === payout.id && item.status === "scheduled" && item.id === line.offsetId);
    if (!offset) throw new Error("Scheduled adjustment state is inconsistent.");
    const released = Math.min(excess, -line.amountCents);
    line.status = "void";
    line.voidedAt = timestamp(context);
    offset.status = "void";
    offset.voidedAt = timestamp(context);
    if (-line.amountCents > released) {
      const amountCents = -line.amountCents - released;
      const offsetId = key(context);
      payout.adjustments.push({ ...line, amountCents: -amountCents, status: "scheduled", offsetId, voidedAt: undefined });
      adjustment.offsets.push({ id: offsetId, payoutId: payout.id, amountCents, status: "scheduled" });
    }
    excess -= released;
    payoutTotals(payout);
  }
  if (excess) throw new Error("Unable to release enough scheduled offsets.");
}

/** Append-only claim and settlement reversal. The containing repository writes all records atomically. */
export function reverseServiceClaim(plan, payouts, adjustments, claimId, reason, context) {
  activePlan(plan);
  const explanation = String(reason ?? "").trim();
  if (!explanation) throw new Error("A reversal reason is required.");
  const original = plan.claims?.find((item) => item.id === claimId);
  if (!original || original.reversedAt) throw new Error("An unreversed service claim is required.");
  const originalPayout = original.payoutId ? payouts.find((item) => item.id === original.payoutId) : null;
  if (original.payoutId && !originalPayout) throw new Error("The linked dealer payout was not found.");
  if (originalPayout && !originalPayout.lines.some((line) => line.claimId === claimId)) throw new Error("The claim is missing from its payout.");
  if (originalPayout && !["scheduled", "paid"].includes(originalPayout.status)) throw new Error("The linked payout cannot be reversed.");
  const before = { plan: planSnapshot(plan), payout: originalPayout ? copy(originalPayout) : null, adjustments: copy(adjustments) };
  const updatedPlan = copy(plan);
  const updatedPayouts = copy(payouts);
  const updatedAdjustments = copy(adjustments);
  const claim = updatedPlan.claims.find((item) => item.id === claimId);
  const payout = originalPayout && updatedPayouts.find((item) => item.id === originalPayout.id);
  const at = timestamp(context);
  const actorId = context?.actorId ?? "sandbox";
  const previousStatus = claim.financialStatus;
  const priorPayoutId = claim.payoutId;
  claim.reversedAt = at;
  claim.reversedBy = actorId;
  claim.reversalReason = explanation;
  claim.financialStatusBeforeReversal = previousStatus;
  claim.financialStatus = "reversed";
  claim.poStatus = "void";
  if (claim.invoice) claim.invoice = { ...claim.invoice, status: "void", voidedAt: at, statusBeforeVoid: previousStatus };
  if (claim.cashAppliedCents) updatedPlan.ledger.push({ id: key(context), type: "claim_funding_reversal", amountCents: claim.cashAppliedCents, at, claimId, note: `Funding restored from void ${claim.poNumber}` });
  if (claim.dealerShortfallCents) updatedPlan.ledger.push({ id: key(context), type: "dealer_shortfall_reversal", amountCents: -claim.dealerShortfallCents, at, claimId, note: `Dealer shortfall reversed for void ${claim.poNumber}` });
  let adjustment = null;
  if (payout?.status === "scheduled") {
    const line = payout.lines.find((item) => item.claimId === claimId);
    payout.lines = payout.lines.filter((item) => item.claimId !== claimId);
    payout.voidedLines ??= [];
    payout.voidedLines.push({ ...line, voidedAt: at, reason: explanation, actorId });
    payoutTotals(payout);
    releaseScheduledOffsets(payout, updatedAdjustments, context);
    if (!payout.lines.length) payout.status = "void";
    claim.payoutId = null;
    claim.priorPayoutId = priorPayoutId;
  } else if (payout?.status === "paid") {
    const line = payout.lines.find((item) => item.claimId === claimId);
    adjustment = {
      id: `SP-ADJ-${key(context)}`, dealerGroupId: plan.dealerGroupId, branchId: plan.branchId,
      planId: plan.id, claimId, originalPayoutId: payout.id, originalPoNumber: claim.poNumber,
      amountCents: -line.netCents, originalNetCents: line.netCents, createdAt: at, actorId, reason: explanation, offsets: [],
    };
    updatedAdjustments.push(adjustment);
    claim.adjustmentId = adjustment.id;
    // The completed payout and its original remittance line are immutable.
  }
  if (updatedPlan.status === "completed") updatedPlan.status = "active";
  updatedPlan.updatedAt = at;
  const after = { plan: planSnapshot(updatedPlan), payout: payout ? copy(payout) : null, adjustments: copy(updatedAdjustments) };
  updatedPlan.audit ??= [];
  updatedPlan.audit.push({
    id: key(context), at, actorId, action: "claim_reversed",
    summary: `${claim.poNumber} voided: ${explanation}. ${adjustment ? `Paid payout ${priorPayoutId} preserved; adjustment ${adjustment.id} created.` : priorPayoutId ? `Pending payout ${priorPayoutId} amended.` : "No payout had completed."}`,
    claimId, poNumber: claim.poNumber, originalPayoutId: priorPayoutId, adjustmentId: adjustment?.id ?? null, reason: explanation, before, after,
  });
  return { plan: updatedPlan, payouts: updatedPayouts, adjustments: updatedAdjustments, adjustment };
}

export function nextWeeklyPayoutDate(date) {
  const parsed = parseDateOnly(date);
  const days = ((5 - parsed.getUTCDay() + 7) % 7) || 7; // next Friday
  return addDays(date, days);
}

export function scheduleWeeklyPayouts(plans, existingPayouts, context, existingAdjustments = []) {
  const at = timestamp(context);
  const groups = new Map();
  for (const plan of plans) {
    for (const claim of plan.claims ?? []) {
      if (claim.financialStatus !== "invoice_matched") continue;
      const groupKey = `${plan.dealerGroupId}/${plan.branchId}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      const terms = plan.contract.commercialTerms;
      const dashubFeeCents = terms.ongoingFeeCents;
      const providerFeeCents = terms.providerFeeTreatment === "dealer" ? terms.providerFeeCents : 0;
      const grossCents = claim.invoice.amountCents;
      const netCents = grossCents - dashubFeeCents - providerFeeCents;
      if (netCents < 0) throw new Error("Payout fees cannot exceed the dealer invoice.");
      groups.get(groupKey).push({ planId: plan.id, claimId: claim.id, roNumber: claim.roNumber, poNumber: claim.poNumber, invoiceNumber: claim.invoice.number, grossCents, dashubFeeCents, providerFeeCents, netCents });
    }
  }
  const updatedPlans = plans.map(copy);
  const payouts = [...existingPayouts];
  const adjustments = copy(existingAdjustments);
  for (const [groupKey, lines] of groups) {
    const [dealerGroupId, branchId] = groupKey.split("/");
    const id = `SP-PAYOUT-${datePart(at).replaceAll("-", "")}-${key(context).slice(0, 8).toUpperCase()}`;
    const payout = {
      id, dealerGroupId, branchId, weekEnding: nextWeeklyPayoutDate(datePart(at)), status: "scheduled", createdAt: at,
      lines, adjustments: [], voidedLines: [],
    };
    payoutTotals(payout);
    let availableCents = payout.netCents;
    for (const adjustment of adjustments.filter((item) => item.dealerGroupId === dealerGroupId && item.branchId === branchId)) {
      const appliedCents = adjustment.offsets.filter((item) => item.status !== "void").reduce((sum, item) => sum + item.amountCents, 0);
      const amountCents = Math.min(availableCents, -adjustment.amountCents - appliedCents);
      if (amountCents <= 0) continue;
      const offsetId = key(context);
      payout.adjustments.push({ adjustmentId: adjustment.id, offsetId, planId: adjustment.planId, claimId: adjustment.claimId, originalPayoutId: adjustment.originalPayoutId, amountCents: -amountCents, status: "scheduled" });
      adjustment.offsets.push({ id: offsetId, payoutId: id, amountCents, status: "scheduled" });
      availableCents -= amountCents;
    }
    payoutTotals(payout);
    payouts.push(payout);
    for (const line of lines) {
      const plan = updatedPlans.find((item) => item.id === line.planId);
      const claim = plan.claims.find((item) => item.id === line.claimId);
      claim.financialStatus = "scheduled_for_payout";
      claim.payoutId = id;
      log(plan, context, "payout_scheduled", `${claim.poNumber} scheduled in ${id}.`);
    }
  }
  return { plans: updatedPlans, payouts, adjustments, created: payouts.slice(existingPayouts.length) };
}

export function markWeeklyPayoutPaid(plans, payouts, payoutId, context, existingAdjustments = []) {
  const updatedPayouts = copy(payouts);
  const adjustments = copy(existingAdjustments);
  const payout = updatedPayouts.find((item) => item.id === payoutId);
  if (!payout || payout.status !== "scheduled") throw new Error("A scheduled payout is required.");
  const updatedPlans = plans.map(copy);
  for (const line of payout.lines) {
    const plan = updatedPlans.find((item) => item.id === line.planId);
    const claim = plan?.claims?.find((item) => item.id === line.claimId);
    if (!claim || claim.financialStatus !== "scheduled_for_payout" || claim.payoutId !== payoutId) throw new Error("Payout claim state is inconsistent.");
    claim.financialStatus = "paid";
    log(plan, context, "payout_paid", `${claim.poNumber} marked paid in sandbox payout ${payoutId}.`);
  }
  for (const offsetLine of payout.adjustments ?? []) {
    if (offsetLine.status !== "scheduled") continue;
    const adjustment = adjustments.find((item) => item.id === offsetLine.adjustmentId);
    const offset = adjustment?.offsets.find((item) => item.id === offsetLine.offsetId && item.payoutId === payoutId);
    if (!offset || offset.status !== "scheduled") throw new Error("Payout adjustment state is inconsistent.");
    offset.status = "paid";
    offsetLine.status = "paid";
  }
  payout.status = "paid";
  payout.paidAt = timestamp(context);
  return { plans: updatedPlans, payouts: updatedPayouts, adjustments };
}

export function cancelPlan(plan, cancellationFeeCents, context) {
  if (plan?.status !== "active") throw new Error("Only an active plan can be cancelled.");
  assertCents(cancellationFeeCents, "Cancellation fee", true);
  const result = copy(plan);
  const claimedCents = result.claims.filter((claim) => !claim.reversedAt).reduce((sum, claim) => sum + claim.expectedCents, 0);
  const clearedCents = getPlanFinancials(result).customerCollectedCents;
  const refundableCents = Math.max(0, clearedCents - claimedCents - cancellationFeeCents);
  const at = timestamp(context);
  if (cancellationFeeCents) result.ledger.push({ id: key(context), type: "cancellation_fee", amountCents: cancellationFeeCents, at });
  if (refundableCents) result.ledger.push({ id: key(context), type: "refund", amountCents: refundableCents, at, note: "Sandbox refund; no provider call" });
  result.status = "cancelled";
  result.cancelledAt = at;
  log(result, context, "plan_cancelled", `Cancelled; simulated refund ${refundableCents} cents after claimed services and fee.`);
  return result;
}

export function expiryRisk(plan, today) {
  if (plan.status !== "active") return null;
  const next = getEntitlements(plan).find((service) => service.status === "pending");
  if (!next) return null;
  const proposedExpiry = addDays(next.predictedDate, 365);
  const daysToExpiry = daysBetween(today, proposedExpiry);
  return daysToExpiry <= 45 ? { nextServiceDate: next.predictedDate, proposedExpiry, daysToExpiry, legalReviewRequired: true } : null;
}
