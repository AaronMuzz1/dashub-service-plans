import { addDays, daysBetween, parseDateOnly } from "./dates.js";

export const LOST_REASONS = Object.freeze([
  "Customer declined",
  "Price",
  "Purchased elsewhere",
  "Vehicle sold/traded",
  "No longer required",
  "Unable to contact",
  "Other",
]);

export const FOLLOW_UP_OUTCOMES = Object.freeze([
  "Contacted",
  "No Answer",
  "Customer Considering",
  "Follow-up Required",
  "Declined",
]);

export const DEFAULT_FOLLOW_UP_SETTINGS = Object.freeze({
  firstAfterDays: 7,
  secondAfterDays: 14,
  finalBeforeExpiryDays: 3,
});

const copy = (value) => JSON.parse(JSON.stringify(value));
const atDate = (value) => String(value ?? "").slice(0, 10);
const key = (context) => context?.idFactory?.() ?? globalThis.crypto?.randomUUID?.() ?? `sandbox-${Date.now()}-${Math.random()}`;
const timestamp = (context) => context?.at ?? new Date().toISOString();

function audit(plan, context, action, summary) {
  const at = timestamp(context);
  plan.audit ??= [];
  plan.audit.push({ id: key(context), at, actorId: context?.actorId ?? "sandbox", action, summary });
  plan.updatedAt = at;
}

export function quoteValidityDays(plan, company, template) {
  const configured = plan.origin === "manufacturer"
    ? template?.quoteValidityDays ?? plan.programQuoteValidityDays
    : company?.quoteValidityDays;
  const days = Number(configured ?? 30);
  if (!Number.isSafeInteger(days) || days < 1 || days > 365) throw new Error("Quote validity must be between 1 and 365 days.");
  return days;
}

export function nextQuoteNumber(plans, issuedDate) {
  parseDateOnly(issuedDate);
  const prefix = `DP-${issuedDate.replaceAll("-", "")}`;
  const used = new Set(plans.map((plan) => plan.quoteRecord?.number).filter(Boolean));
  let sequence = plans.filter((plan) => plan.quoteRecord?.number?.startsWith(prefix)).length + 1;
  while (used.has(`${prefix}-${String(sequence).padStart(4, "0")}`)) sequence += 1;
  return `${prefix}-${String(sequence).padStart(4, "0")}`;
}

export function issueQuote(plan, { number, validityDays, followUpSettings = DEFAULT_FOLLOW_UP_SETTINGS }, context) {
  if (!plan?.quote) throw new Error("Complete the Service Plan before issuing a quote.");
  if (!["draft", "quote"].includes(plan.status) || plan.quoteRecord?.status === "sold") throw new Error("This record cannot be issued as a quote.");
  if (plan.quote.paymentChange?.requiresConfirmation && !plan.draft?.paymentChangeConfirmed) {
    throw new Error("Confirm the changed instalment amount before issuing the quote.");
  }
  const result = copy(plan);
  const at = timestamp(context);
  const issueDate = atDate(at);
  const expiryDate = addDays(issueDate, validityDays);
  result.status = "quote";
  result.quoteRecord = {
    number,
    status: "outstanding",
    issuedAt: at,
    issueDate,
    expiryDate,
    validityDays,
    creatorId: context.actorId,
    quotingAdvisorId: context.actorId,
    currentOwnerId: context.actorId,
    assignmentHistory: [{ id: key(context), at, actorId: context.actorId, fromAdvisorId: null, toAdvisorId: context.actorId, reason: "Quote issued" }],
    followUps: [],
    nextFollowUpDate: addDays(issueDate, followUpSettings.firstAfterDays),
    terminalAt: null,
    lostReason: null,
  };
  audit(result, context, "quote_issued", `${number} issued; valid until ${expiryDate}.`);
  return result;
}

export function expireQuote(plan, today, context = {}) {
  parseDateOnly(today);
  if (plan?.status !== "quote" || plan.quoteRecord?.status !== "outstanding" || plan.quoteRecord.expiryDate >= today) return plan;
  const result = copy(plan);
  const at = context.at ?? `${today}T00:00:00.000Z`;
  result.status = "lost";
  result.quoteRecord.status = "expired";
  result.quoteRecord.lostReason = "Quote Expired";
  result.quoteRecord.terminalAt = at;
  result.quoteRecord.nextFollowUpDate = null;
  audit(result, { ...context, at }, "quote_expired", `${result.quoteRecord.number} closed automatically as Lost: Quote Expired.`);
  return result;
}

export function markQuoteLost(plan, reason, context) {
  if (plan?.status !== "quote" || plan.quoteRecord?.status !== "outstanding") throw new Error("Only an outstanding issued quote can be marked Lost.");
  if (!LOST_REASONS.includes(reason)) throw new Error("Choose a valid lost quote reason.");
  const result = copy(plan);
  result.status = "lost";
  result.quoteRecord.status = "lost";
  result.quoteRecord.lostReason = reason;
  result.quoteRecord.terminalAt = timestamp(context);
  result.quoteRecord.nextFollowUpDate = null;
  audit(result, context, "quote_lost", `${result.quoteRecord.number} marked Lost: ${reason}.`);
  return result;
}

export function supersedeQuote(plan, replacementId, context) {
  if (plan?.status !== "quote" || plan.quoteRecord?.status !== "outstanding") throw new Error("Only an outstanding quote can be superseded.");
  const result = copy(plan);
  result.status = "lost";
  result.quoteRecord.status = "superseded";
  result.quoteRecord.supersededById = replacementId;
  result.quoteRecord.terminalAt = timestamp(context);
  result.quoteRecord.nextFollowUpDate = null;
  audit(result, context, "quote_superseded", `${result.quoteRecord.number} superseded by a newly issued quote.`);
  return result;
}

export function assignQuote(plan, toAdvisorId, reason, context) {
  if (plan?.status !== "quote" || plan.quoteRecord?.status !== "outstanding") throw new Error("Only an outstanding quote can be reassigned.");
  if (!String(toAdvisorId ?? "").trim()) throw new Error("Choose an Advisor.");
  if (plan.quoteRecord.currentOwnerId === toAdvisorId) return plan;
  const result = copy(plan);
  const fromAdvisorId = result.quoteRecord.currentOwnerId;
  result.quoteRecord.currentOwnerId = toAdvisorId;
  result.quoteRecord.assignmentHistory.push({
    id: key(context), at: timestamp(context), actorId: context.actorId,
    fromAdvisorId, toAdvisorId, reason: String(reason ?? "Quote ownership changed").trim() || "Quote ownership changed",
  });
  audit(result, context, "quote_reassigned", `Quote ownership changed from ${fromAdvisorId} to ${toAdvisorId}.`);
  return result;
}

function nextAutomaticFollowUp(plan, settings, outcome, completedDate) {
  if (outcome === "Declined") return null;
  const completed = plan.quoteRecord.followUps.length;
  if (completed === 0) return addDays(plan.quoteRecord.issueDate, settings.secondAfterDays);
  const finalDate = addDays(plan.quoteRecord.expiryDate, -settings.finalBeforeExpiryDays);
  if (finalDate > completedDate) return finalDate;
  return null;
}

export function recordFollowUp(plan, input, settings = DEFAULT_FOLLOW_UP_SETTINGS, context) {
  if (plan?.status !== "quote" || plan.quoteRecord?.status !== "outstanding") throw new Error("Follow-ups stop when a quote is no longer outstanding.");
  if (!FOLLOW_UP_OUTCOMES.includes(input?.outcome)) throw new Error("Choose a valid follow-up outcome.");
  const notes = String(input?.notes ?? "").trim();
  if (!notes) throw new Error("Follow-up notes are required.");
  if (input.actionId && plan.quoteRecord.followUps.some((item) => item.actionId === input.actionId)) throw new Error("This follow-up has already been recorded.");
  const result = copy(plan);
  const at = timestamp(context);
  const completedDate = atDate(at);
  let nextFollowUpDate = input.nextFollowUpDate || nextAutomaticFollowUp(result, settings, input.outcome, completedDate);
  if (nextFollowUpDate) {
    parseDateOnly(nextFollowUpDate);
    if (nextFollowUpDate <= completedDate) throw new Error("The next follow-up date must be in the future.");
    if (nextFollowUpDate > result.quoteRecord.expiryDate) nextFollowUpDate = result.quoteRecord.expiryDate;
  }
  result.quoteRecord.followUps.push({
    id: key(context), actionId: input.actionId ?? null, at, advisorId: context.actorId,
    outcome: input.outcome, notes, nextFollowUpDate: nextFollowUpDate ?? null,
  });
  result.quoteRecord.nextFollowUpDate = nextFollowUpDate ?? null;
  audit(result, context, "quote_follow_up", `${input.outcome}${nextFollowUpDate ? `; next follow-up ${nextFollowUpDate}` : ""}.`);
  if (input.outcome === "Declined") return markQuoteLost(result, "Customer declined", context);
  return result;
}

export function followUpState(plan, today) {
  const due = plan?.status === "quote" && plan.quoteRecord?.status === "outstanding" ? plan.quoteRecord.nextFollowUpDate : null;
  if (!due) return null;
  return { date: due, state: due < today ? "overdue" : due === today ? "due" : "scheduled", daysFromToday: daysBetween(today, due) };
}

export function matchCustomers(plans, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (needle.length < 2) return [];
  const seen = new Map();
  for (const plan of plans) {
    const customer = plan.quote?.customer ?? plan.draft?.customer;
    if (!customer) continue;
    const vehicle = plan.quote?.vehicle ?? plan.draft?.vehicle ?? {};
    const haystack = `${customer.firstName} ${customer.lastName} ${customer.email} ${customer.mobile}`.toLowerCase();
    if (!haystack.includes(needle)) continue;
    const identity = customer.id ?? `${customer.email}|${customer.mobile}`.toLowerCase();
    if (!seen.has(identity)) seen.set(identity, {
      id: customer.id ?? identity,
      customer: copy(customer),
      detail: `${customer.email || "No email"} · ${customer.mobile || "No mobile"}`,
      lastVehicle: [vehicle.year, vehicle.make, vehicle.model, vehicle.registration].filter(Boolean).join(" ") || "No vehicle on record",
    });
  }
  return [...seen.values()].slice(0, 6);
}

export function recordSignature(plan, input, context) {
  if (!plan?.quote) throw new Error("A completed Service Plan is required.");
  if (!['digital', 'physical'].includes(input?.method)) throw new Error("Choose digital or physical signing.");
  const result = copy(plan);
  const at = timestamp(context);
  result.activation ??= {};
  if (input.method === "digital") {
    const evidence = String(input.evidence ?? "").trim();
    if (!evidence) throw new Error("Digital signature evidence is required.");
    result.activation.signature = { method: "digital", evidence, signedAt: at, contractVersion: input.contractVersion, customerName: input.customerName };
  } else {
    if (!input.confirmedHeldByDealer) throw new Error("Confirm the dealership holds the physically signed copy.");
    result.activation.signature = { method: "physical", confirmedHeldByDealer: true, confirmedByAdvisorId: context.actorId, signedAt: at, contractVersion: input.contractVersion };
  }
  audit(result, context, "contract_signed", `${input.method === "digital" ? "Digital signature captured" : "Physical signed-copy custody confirmed"} for ${input.contractVersion}.`);
  return result;
}

export function recordPaymentMethod(plan, paymentMethod, context) {
  if (!paymentMethod?.token || paymentMethod.provider !== "sandbox") throw new Error("A sandbox payment-method token is required.");
  if (paymentMethod.cardNumber || paymentMethod.cvc) throw new Error("Card numbers and CVC must never be stored.");
  const result = copy(plan);
  result.activation ??= {};
  result.activation.paymentMethod = { ...paymentMethod, cardNumber: undefined, cvc: undefined, setUpAt: timestamp(context) };
  audit(result, context, "payment_method_setup", "Sandbox payment method token recorded; no card number or CVC stored.");
  return result;
}

export function activationPrerequisites(plan) {
  return {
    signatureComplete: Boolean(plan?.activation?.signature),
    paymentMethodComplete: Boolean(plan?.activation?.paymentMethod?.token),
    ready: Boolean(plan?.activation?.signature && plan?.activation?.paymentMethod?.token),
  };
}

export function planRegisterCategory(plan) {
  if (plan.status === "draft") return "drafts";
  if (plan.status === "quote") return "quotes";
  if (plan.status === "completed") return "completed";
  if (["lost", "cancelled"].includes(plan.status)) return "lost";
  return "active";
}
