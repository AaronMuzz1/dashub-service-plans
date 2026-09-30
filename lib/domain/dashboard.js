import { daysBetween } from "./dates.js";
import { expiryRisk, getEntitlements, getPlanFinancials } from "./operations.js";
import { canCreateDealerPlan, canViewPlan, isDashubAdmin } from "./permissions.js";

const sum = (items, value) => items.reduce((total, item) => total + value(item), 0);
const customerName = (plan) => `${plan.quote.customer.firstName} ${plan.quote.customer.lastName}`;
const monthOf = (value) => value?.slice(0, 7);
const countNote = (count, singular, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;
const planTarget = (plans, label) => ({ view: "plans", planIds: plans.map((plan) => plan.id), label });

function scopedRecords(actor, plans, payouts) {
  const visiblePlans = plans.filter((plan) => canViewPlan(actor, plan));
  const visiblePayouts = payouts.filter((payout) => isDashubAdmin(actor) || payout.dealerGroupId === actor.dealerGroupId);
  return { plans: visiblePlans, payouts: visiblePayouts };
}

function upcomingService(plan, today) {
  if (plan.status !== "active") return null;
  const service = getEntitlements(plan).find((item) => item.status === "pending");
  if (!service) return null;
  const daysUntilDue = daysBetween(today, service.predictedDate);
  return { plan, service, daysUntilDue };
}

function projectedFundingRisk(plan, today) {
  const upcoming = upcomingService(plan, today);
  if (!upcoming || upcoming.daysUntilDue < 0 || upcoming.daysUntilDue > 90) return null;
  const financials = getPlanFinancials(plan);
  const scheduledBeforeService = sum(
    (plan.paymentSchedule ?? []).filter((payment) => payment.status === "scheduled" && payment.date >= today && payment.date < upcoming.service.predictedDate),
    (payment) => payment.amountCents,
  );
  const projectedAvailableCents = financials.cashAvailableCents + scheduledBeforeService;
  const shortfallCents = Math.max(0, upcoming.service.grossCents - projectedAvailableCents);
  return shortfallCents ? { ...upcoming, shortfallCents, failedPayments: financials.failedPayments.length } : null;
}

export function summarizePlanForDashboard(plan) {
  const registration = plan.quote.vehicle.registration || "No registration";
  return {
    id: plan.id,
    customerName: customerName(plan),
    registration,
    vehicleLabel: `${registration} · ${plan.quote.vehicle.year} ${plan.quote.vehicle.make} ${plan.quote.vehicle.model}`,
    status: plan.status,
    origin: plan.origin,
    originLabel: plan.origin === "manufacturer" ? "Manufacturer plan" : "Dealer plan",
    serviceCount: Number(plan.quote.numberOfServices),
    totalCents: plan.quote.funding.totalCents,
    updatedAt: plan.updatedAt,
    internalReference: plan.id,
  };
}

function advisorModel(actor, records) {
  const { activePlans, activeClaims, dueSoon, fundingRisks } = records;
  const actions = [];
  if (canCreateDealerPlan(actor)) actions.push({ id: "create-plan", label: "Create a Plan", detail: "Build and price a new Service Plan.", icon: "+", target: { view: "form" } });
  if (actor.permissions?.claimServices) actions.push({ id: "claim-plan", label: "Claim a Plan", detail: "Find an active plan and claim its next service.", icon: "✓", target: { view: "claims" } });

  const attention = [];
  if (fundingRisks.length) {
    const first = fundingRisks[0];
    attention.push({ id: "funding-risk", title: "Upcoming service funding issue", count: fundingRisks.length,
      detail: `${customerName(first.plan)} · ${first.plan.quote.vehicle.registration || "No registration"}`,
      amountCents: first.shortfallCents, date: first.service.predictedDate, tone: "warning", target: { view: "detail", planId: first.plan.id } });
  }
  const dueWithoutFundingRisk = dueSoon.filter((item) => !fundingRisks.some((risk) => risk.plan.id === item.plan.id));
  if (dueWithoutFundingRisk.length) {
    const first = dueWithoutFundingRisk[0];
    attention.push({ id: "services-due", title: "Services due soon", count: dueWithoutFundingRisk.length,
      detail: `${customerName(first.plan)} · ${first.plan.quote.vehicle.registration || "No registration"}`,
      date: first.service.predictedDate, tone: "info", target: { view: "claims", planId: first.plan.id } });
  }

  return {
    role: "advisor",
    description: "Create plans, claim services and review the work that needs your attention.",
    actions,
    metricGroups: [{ id: "advisor-overview", label: "Your overview", metrics: [
      { id: "active-plans", label: "Active Plans", value: activePlans.length, note: "Plans available in your dealership", target: planTarget(activePlans, "Active Plans") },
      { id: "plans", label: "Plans", value: records.plans.length, note: "Quotes and plans in your scope", target: { view: "plans" } },
      { id: "claims", label: "Claims", value: activeClaims.length, note: "Service claims on visible plans", target: { view: "invoices", filter: "all" } },
    ] }],
    attention,
  };
}

function managerModel(records) {
  const { activePlans, soldThisMonth, activeClaims, awaitingInvoices, expiryRisks, fundingRisks, nextPayouts } = records;
  const attention = [];
  if (awaitingInvoices.length) attention.push({ id: "awaiting-invoices", title: "Claims awaiting dealer invoice", count: awaitingInvoices.length,
    detail: countNote(awaitingInvoices.length, "claim is", "claims are") + " ready for invoice processing.", tone: "warning", target: { view: "invoices", filter: "awaiting_dealer_invoice" } });
  if (expiryRisks.length) {
    const first = expiryRisks[0];
    attention.push({ id: "expiry-risk", title: "Plans at risk of expiry", count: expiryRisks.length,
      detail: `${customerName(first.plan)} · ${first.plan.quote.vehicle.registration || "No registration"}`,
      date: first.risk.proposedExpiry, tone: "warning", target: planTarget(expiryRisks.map((item) => item.plan), "Plans at risk of expiry") });
  }
  if (fundingRisks.length) {
    const first = fundingRisks[0];
    attention.push({ id: "funding-risk", title: "Upcoming service funding issue", count: fundingRisks.length,
      detail: `${customerName(first.plan)} · ${first.plan.quote.vehicle.registration || "No registration"}`,
      amountCents: first.shortfallCents, date: first.service.predictedDate, tone: "warning", target: planTarget(fundingRisks.map((item) => item.plan), "Plans with funding issues") });
  }
  return {
    role: "manager",
    description: "Track your dealership’s Service Plan sales, claims and upcoming payouts.",
    actions: [],
    metricGroups: [
      { id: "commercial", label: "Commercial", metrics: [
        { id: "active-plans", label: "Active Plans", value: activePlans.length, note: "Current dealership plans", target: planTarget(activePlans, "Active Plans") },
        { id: "plans-sold", label: "Plans Sold This Month", value: soldThisMonth.length, note: "Activated this calendar month", target: planTarget(soldThisMonth, "Plans sold this month") },
        { id: "value-sold", label: "Plan Value Sold This Month", value: sum(soldThisMonth, (plan) => plan.contract.totalCents), format: "money", note: "Contracted plan value", target: planTarget(soldThisMonth, "Plans sold this month") },
      ] },
      { id: "operations", label: "Operations", metrics: [
        { id: "claims", label: "Services / Claims", value: activeClaims.length, note: "Claims across dealership plans", target: { view: "invoices", filter: "all" } },
        { id: "awaiting-invoices", label: "Claims Awaiting Dealer Invoice", value: awaitingInvoices.length, note: "Dealer invoices still required", target: { view: "invoices", filter: "awaiting_dealer_invoice" } },
        { id: "upcoming-payout", label: "Upcoming Dealer Payout", value: sum(nextPayouts, (payout) => payout.netCents), format: "money", note: nextPayouts[0]?.weekEnding ? `Week ending ${nextPayouts[0].weekEnding}` : "No payout currently scheduled", target: { view: "payouts" } },
        { id: "expiry-risk", label: "Plans At Risk of Expiry", value: expiryRisks.length, note: "Require dealership review", target: planTarget(expiryRisks.map((item) => item.plan), "Plans at risk of expiry") },
        { id: "funding-issues", label: "Funding / Payment Issues", value: fundingRisks.length, note: "May affect an upcoming service", target: planTarget(fundingRisks.map((item) => item.plan), "Plans with funding issues") },
      ] },
    ],
    attention,
  };
}

function adminModel(records) {
  const { activePlans, newPlans, activeClaims, awaitingInvoices, invoiceExceptions, expiryRisks, fundingRisks, failedCollections, claimsPayable, nextPayouts, collectedCents, dashubFeesCents } = records;
  const failedCollectionPlans = [...new Map(failedCollections.map(({ plan }) => [plan.id, plan])).values()];
  const attention = [];
  if (awaitingInvoices.length) attention.push({ id: "awaiting-invoices", title: "Claims awaiting dealer invoice", count: awaitingInvoices.length,
    detail: "Dealer invoices are required before these claims can progress.", tone: "warning", target: { view: "invoices", filter: "awaiting_dealer_invoice" } });
  if (invoiceExceptions.length) attention.push({ id: "invoice-exceptions", title: "Invoice exceptions", count: invoiceExceptions.length,
    detail: "Invoice values need Dashub review.", tone: "danger", target: { view: "invoices", filter: "exception" } });
  if (failedCollections.length) attention.push({ id: "failed-collections", title: "Failed collections", count: failedCollections.length,
    detail: "Current failed payments require follow-up.", tone: "danger", target: planTarget(failedCollectionPlans, "Plans with failed collections") });
  if (fundingRisks.length) attention.push({ id: "funding-risk", title: "Upcoming service funding issues", count: fundingRisks.length,
    detail: "Projected funds may be insufficient at the next service point.", tone: "warning", target: planTarget(fundingRisks.map((item) => item.plan), "Plans with funding issues") });
  if (expiryRisks.length) attention.push({ id: "expiry-risk", title: "Plans at risk of expiry", count: expiryRisks.length,
    detail: "Proposed expiry reviews are approaching.", tone: "warning", target: { view: "finance", financeKey: "expiryRisk" } });

  return {
    role: "dashub_admin",
    description: "Monitor Service Plan performance, collections and dealer operations.",
    actions: [],
    metricGroups: [
      { id: "plan-activity", label: "Plan activity", metrics: [
        { id: "active-plans", label: "Active Plans", value: activePlans.length, note: "Active across the platform", target: planTarget(activePlans, "Active Plans") },
        { id: "new-plans", label: "New Plans", value: newPlans.length, note: "Created this calendar month", target: planTarget(newPlans, "New plans this month") },
        { id: "new-plan-value", label: "New Plan Value", value: sum(newPlans, (plan) => plan.quote.funding.totalCents), format: "money", note: "Value created this month", target: planTarget(newPlans, "New plans this month") },
      ] },
      { id: "financial", label: "Financial overview", metrics: [
        { id: "collections", label: "Customer Collections", value: collectedCents, format: "money", note: "Cleared customer payments", target: { view: "finance", financeKey: "collected" } },
        { id: "claims-payable", label: "Claims Payable", value: sum(claimsPayable, ({ claim }) => claim.invoice?.amountCents ?? claim.expectedCents), format: "money", note: countNote(claimsPayable.length, "claim", "claims"), target: { view: "finance", financeKey: "payable" } },
        { id: "next-payout", label: "Next Weekly Dealer Payout", value: sum(nextPayouts, (payout) => payout.netCents), format: "money", note: nextPayouts[0]?.weekEnding ? `Week ending ${nextPayouts[0].weekEnding}` : "No payout currently scheduled", target: { view: "payouts" } },
        { id: "dashub-fees", label: "Dashub Revenue / Fees", value: dashubFeesCents, format: "money", note: "Setup, cancellation and paid payout fees", target: { view: "finance", financeKey: "setupFees" } },
      ] },
      { id: "exceptions", label: "Operational exceptions", metrics: [
        { id: "failed-collections", label: "Failed Collections", value: failedCollections.length, note: "Current failed payments", target: planTarget(failedCollectionPlans, "Plans with failed collections") },
        { id: "invoice-exceptions", label: "Invoice Exceptions", value: invoiceExceptions.length, note: "Require Dashub review", target: { view: "invoices", filter: "exception" } },
        { id: "expiry-risk", label: "Plans At Risk of Expiry", value: expiryRisks.length, note: "Proposed expiry reviews", target: { view: "finance", financeKey: "expiryRisk" } },
      ] },
    ],
    attention,
  };
}

export function buildDashboardOverview({ actor, plans = [], payouts = [], today }) {
  if (!actor || !today) throw new Error("Dashboard actor and date are required.");
  const scoped = scopedRecords(actor, plans, payouts);
  const currentMonth = monthOf(today);
  const activePlans = scoped.plans.filter((plan) => plan.status === "active");
  const soldThisMonth = scoped.plans.filter((plan) => monthOf(plan.contract?.activatedAt) === currentMonth);
  const newPlans = scoped.plans.filter((plan) => monthOf(plan.createdAt) === currentMonth);
  const activeClaims = scoped.plans.flatMap((plan) => (plan.claims ?? []).filter((claim) => !claim.reversedAt).map((claim) => ({ plan, claim })));
  const awaitingInvoices = activeClaims.filter(({ claim }) => claim.financialStatus === "awaiting_dealer_invoice");
  const invoiceExceptions = activeClaims.filter(({ claim }) => claim.financialStatus === "exception");
  const claimsPayable = activeClaims.filter(({ claim }) => ["invoice_matched", "scheduled_for_payout"].includes(claim.financialStatus));
  const upcoming = activePlans.map((plan) => upcomingService(plan, today)).filter(Boolean);
  const dueSoon = upcoming.filter((item) => item.daysUntilDue >= 0 && item.daysUntilDue <= 45);
  const fundingRisks = activePlans.map((plan) => projectedFundingRisk(plan, today)).filter(Boolean);
  const expiryRisks = activePlans.map((plan) => ({ plan, risk: expiryRisk(plan, today) })).filter((item) => item.risk);
  const failedCollections = activePlans.flatMap((plan) => getPlanFinancials(plan).failedPayments.map((payment) => ({ plan, payment })));
  const scheduledPayouts = scoped.payouts.filter((payout) => payout.status === "scheduled").sort((a, b) => a.weekEnding.localeCompare(b.weekEnding));
  const nextWeek = scheduledPayouts[0]?.weekEnding;
  const nextPayouts = scheduledPayouts.filter((payout) => payout.weekEnding === nextWeek);
  const collectedCents = sum(scoped.plans, (plan) => getPlanFinancials(plan).customerCollectedCents);
  const setupAndCancellationFees = sum(scoped.plans, (plan) => sum((plan.ledger ?? []).filter((entry) => ["setup_fee", "cancellation_fee"].includes(entry.type)), (entry) => entry.amountCents));
  const paidPayoutFees = sum(scoped.payouts.filter((payout) => payout.status === "paid"), (payout) => sum(payout.lines ?? [], (line) => line.dashubFeeCents));
  const records = { ...scoped, activePlans, soldThisMonth, newPlans, activeClaims, awaitingInvoices, invoiceExceptions, claimsPayable,
    dueSoon, fundingRisks, expiryRisks, failedCollections, nextPayouts, collectedCents, dashubFeesCents: setupAndCancellationFees + paidPayoutFees };
  const roleModel = isDashubAdmin(actor) ? adminModel(records) : actor.role === "manager" ? managerModel(records) : advisorModel(actor, records);
  return {
    ...roleModel,
    recentPlans: [...scoped.plans].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6).map(summarizePlanForDashboard),
  };
}
