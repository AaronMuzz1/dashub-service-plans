import { addDays, addMonths, daysBetween, parseDateOnly } from "./dates.js";
import { followUpState } from "./sales.js";

const datePart = (value) => String(value ?? "").slice(0, 10);
const inRange = (date, range) => Boolean(date && date >= range.start && date <= range.end);
const nameOf = (plan) => `${plan.quote?.customer?.firstName ?? plan.draft?.customer?.firstName ?? ""} ${plan.quote?.customer?.lastName ?? plan.draft?.customer?.lastName ?? ""}`.trim();

function startOfMonth(date) { return `${date.slice(0, 7)}-01`; }
function endOfMonth(date) { return addDays(addMonths(startOfMonth(date), 1), -1); }

export function resolvePerformanceRange(preset = "current_month", today, custom = {}) {
  parseDateOnly(today);
  let start;
  let end;
  if (preset === "previous_month") {
    end = addDays(startOfMonth(today), -1);
    start = startOfMonth(end);
  } else if (preset === "quarter") {
    const [year, month] = today.split("-").map(Number);
    const quarterMonth = Math.floor((month - 1) / 3) * 3 + 1;
    start = `${year}-${String(quarterMonth).padStart(2, "0")}-01`;
    end = addDays(addMonths(start, 3), -1);
  } else if (preset === "year") {
    start = `${today.slice(0, 4)}-01-01`;
    end = `${today.slice(0, 4)}-12-31`;
  } else if (preset === "custom") {
    start = custom.start;
    end = custom.end;
    parseDateOnly(start);
    parseDateOnly(end);
    if (end < start) throw new Error("Custom report end date must be on or after its start date.");
  } else {
    start = startOfMonth(today);
    end = endOfMonth(today);
  }
  const length = daysBetween(start, end) + 1;
  const previous = { start: addDays(start, -length), end: addDays(start, -1) };
  return { start, end, previous, preset };
}

function passesDimension(plan, filters) {
  const quote = plan.quote ?? {};
  if (filters.dealerGroupId && plan.dealerGroupId !== filters.dealerGroupId) return false;
  if (filters.branchId && plan.branchId !== filters.branchId) return false;
  if (filters.brand && quote.vehicle?.make !== filters.brand) return false;
  if (filters.model && quote.vehicle?.model !== filters.model) return false;
  if (filters.planType && plan.origin !== filters.planType) return false;
  if (filters.advisorId && ![plan.quoteRecord?.quotingAdvisorId, plan.quoteRecord?.currentOwnerId, plan.sellingAdvisorId].includes(filters.advisorId)) return false;
  return true;
}

function quoteRow(plan) {
  return {
    recordType: "Quote",
    id: plan.id,
    number: plan.quoteRecord.number,
    date: plan.quoteRecord.issueDate,
    customer: nameOf(plan),
    dealerGroupId: plan.dealerGroupId,
    branchId: plan.branchId,
    advisorId: plan.quoteRecord.quotingAdvisorId,
    ownerId: plan.quoteRecord.currentOwnerId,
    status: plan.quoteRecord.status,
    brand: plan.quote.vehicle.make,
    model: plan.quote.vehicle.model,
    planType: plan.origin,
    directSale: false,
  };
}

function saleRow(plan) {
  return {
    recordType: "Sale",
    id: plan.id,
    number: plan.quoteRecord?.number ?? "Direct sale",
    date: datePart(plan.contract?.activatedAt),
    customer: nameOf(plan),
    dealerGroupId: plan.dealerGroupId,
    branchId: plan.branchId,
    advisorId: plan.sellingAdvisorId,
    ownerId: plan.quoteRecord?.currentOwnerId ?? plan.sellingAdvisorId,
    status: plan.operationalStatus ?? plan.status,
    brand: plan.quote.vehicle.make,
    model: plan.quote.vehicle.model,
    planType: plan.origin,
    directSale: Boolean(plan.directSale),
    followingFollowUp: !plan.directSale && (plan.quoteRecord?.followUps?.length ?? 0) > 0,
  };
}

function followUpRow(plan, item, state = "completed") {
  return {
    recordType: "Follow-up", id: plan.id, number: plan.quoteRecord.number,
    date: item.at ? datePart(item.at) : item.date, customer: nameOf(plan), dealerGroupId: plan.dealerGroupId, branchId: plan.branchId,
    advisorId: item.advisorId ?? plan.quoteRecord.currentOwnerId, ownerId: plan.quoteRecord.currentOwnerId,
    status: state, followUpOutcome: item.outcome ?? state, brand: plan.quote.vehicle.make, model: plan.quote.vehicle.model,
    planType: plan.origin, directSale: false,
  };
}

function summaries(plans, range, today) {
  const quotes = plans.filter((plan) => plan.quoteRecord && inRange(plan.quoteRecord.issueDate, range));
  const sales = plans.filter((plan) => plan.contract && inRange(datePart(plan.contract.activatedAt), range));
  const followUps = plans.flatMap((plan) => (plan.quoteRecord?.followUps ?? []).map((item) => ({ ...item, plan }))).filter((item) => inRange(datePart(item.at), range));
  const due = plans.map((plan) => ({ plan, state: followUpState(plan, today) })).filter((item) => item.state && item.state.date <= range.end);
  return {
    quotesIssued: quotes.length,
    plansSold: sales.length,
    directSales: sales.filter((plan) => plan.directSale).length,
    outstandingQuotes: quotes.filter((plan) => plan.quoteRecord.status === "outstanding").length,
    lostQuotes: quotes.filter((plan) => ["lost", "expired"].includes(plan.quoteRecord.status)).length,
    quoteExpiry: quotes.filter((plan) => plan.quoteRecord.status === "expired").length,
    followUpsDue: due.filter((item) => item.state.state === "due").length,
    followUpsOverdue: due.filter((item) => item.state.state === "overdue").length,
    followUpsCompleted: followUps.length,
    convertedFollowingFollowUp: sales.filter((plan) => !plan.directSale && (plan.quoteRecord?.followUps?.length ?? 0) > 0).length,
  };
}

function breakdown(rows, key, usersById = null) {
  const values = new Map();
  for (const row of rows) {
    const raw = row[key] || "Unspecified";
    const label = usersById ? usersById.get(raw)?.name ?? raw : raw;
    values.set(label, (values.get(label) ?? 0) + 1);
  }
  return [...values].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export function buildSalesPerformance({ plans, users, companies, actor, filters = {}, today }) {
  const range = resolvePerformanceRange(filters.preset, today, filters.custom);
  let scoped = plans.filter((plan) => passesDimension(plan, filters));
  if (actor.role !== "dashub_admin") scoped = scoped.filter((plan) => plan.dealerGroupId === actor.dealerGroupId);
  if (filters.scope === "branch") scoped = scoped.filter((plan) => plan.branchId === (filters.branchId || actor.branchId));

  const eligibleUsers = users.filter((user) => ["advisor", "manager"].includes(user.role))
    .filter((user) => actor.role === "dashub_admin" || user.dealerGroupId === actor.dealerGroupId)
    .filter((user) => !filters.dealerGroupId || user.dealerGroupId === filters.dealerGroupId)
    .filter((user) => !filters.branchId || user.branchId === filters.branchId)
    .filter((user) => filters.scope !== "branch" || user.branchId === (filters.branchId || actor.branchId));
  const usersById = new Map(users.map((user) => [user.id, user]));
  const issuedCohort = scoped.filter((plan) => plan.quoteRecord && inRange(plan.quoteRecord.issueDate, range));
  const periodSales = scoped.filter((plan) => plan.contract && inRange(datePart(plan.contract.activatedAt), range));
  const cohortOwner = (plan) => plan.sellingAdvisorId && plan.quoteRecord.status === "sold" ? plan.sellingAdvisorId : plan.quoteRecord.currentOwnerId;
  const leaderboard = eligibleUsers.map((user) => {
    const assigned = issuedCohort.filter((plan) => cohortOwner(plan) === user.id);
    const converted = assigned.filter((plan) => plan.quoteRecord.status === "sold" && plan.sellingAdvisorId === user.id);
    const quotesIssued = issuedCohort.filter((plan) => plan.quoteRecord.quotingAdvisorId === user.id).length;
    const plansSold = periodSales.filter((plan) => plan.sellingAdvisorId === user.id).length;
    return {
      advisorId: user.id, name: user.name, role: user.role, branchId: user.branchId,
      quotesIssued, plansSold, directSales: periodSales.filter((plan) => plan.sellingAdvisorId === user.id && plan.directSale).length,
      assignedQuotes: assigned.length, convertedAssigned: converted.length,
      conversionRate: assigned.length ? Math.min(100, Math.round(converted.length * 1000 / assigned.length) / 10) : 0,
    };
  }).sort((a, b) => b.plansSold - a.plansSold || b.quotesIssued - a.quotesIssued || a.name.localeCompare(b.name))
    .map((row, index) => ({ ...row, soldRank: index + 1 }));
  const quoteRanking = [...leaderboard].sort((a, b) => b.quotesIssued - a.quotesIssued || b.plansSold - a.plansSold || a.name.localeCompare(b.name))
    .map((row, index) => ({ advisorId: row.advisorId, rank: index + 1 }));
  for (const row of leaderboard) row.quoteRank = quoteRanking.find((item) => item.advisorId === row.advisorId).rank;

  const quoteRows = issuedCohort.map(quoteRow);
  const saleRows = periodSales.map(saleRow);
  const completedFollowUpRows = scoped.flatMap((plan) => (plan.quoteRecord?.followUps ?? []).filter((item) => inRange(datePart(item.at), range)).map((item) => followUpRow(plan, item)));
  const pendingFollowUpRows = scoped.map((plan) => ({ plan, state: followUpState(plan, today) })).filter((item) => item.state && inRange(item.state.date, range) && ["due", "overdue"].includes(item.state.state)).map(({ plan, state }) => followUpRow(plan, state, state.state));
  const followUpRows = [...completedFollowUpRows, ...pendingFollowUpRows];
  const activityRows = [...quoteRows, ...saleRows];
  const rows = [...activityRows, ...followUpRows];
  const summary = summaries(scoped, range, today);
  const conversionDenominator = issuedCohort.length;
  const converted = issuedCohort.filter((plan) => plan.quoteRecord.status === "sold").length;
  summary.quoteConversionPercentage = conversionDenominator ? Math.min(100, Math.round(converted * 1000 / conversionDenominator) / 10) : 0;
  const previousSummary = summaries(scoped, range.previous, range.previous.end);

  return {
    range,
    summary,
    previousSummary,
    leaderboard,
    own: leaderboard.find((row) => row.advisorId === actor.id) ?? null,
    rows,
    quoteRows,
    saleRows,
    breakdowns: {
      advisors: breakdown(activityRows, "advisorId", usersById),
      branches: breakdown(activityRows, "branchId"),
      brands: breakdown(activityRows, "brand"),
      models: breakdown(activityRows, "model"),
      planTypes: breakdown(activityRows, "planType"),
      lostReasons: breakdown(issuedCohort.filter((plan) => plan.quoteRecord.lostReason).map((plan) => ({ reason: plan.quoteRecord.lostReason })), "reason"),
      months: breakdown(activityRows.map((row) => ({ month: row.date.slice(0, 7) })), "month").sort((a, b) => a.label.localeCompare(b.label)),
    },
    companies: companies.map((company) => ({ id: company.id, name: company.name })),
  };
}
