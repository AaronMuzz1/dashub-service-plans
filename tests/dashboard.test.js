import test from "node:test";
import assert from "node:assert/strict";
import { createDemoWorkspace } from "../lib/adapters/demo-data.js";
import { buildDashboardOverview, summarizePlanForDashboard } from "../lib/domain/dashboard.js";
import { todayLocalDate } from "../lib/domain/dates.js";
import { canViewPlan } from "../lib/domain/permissions.js";

function dashboardFor(userId) {
  const workspace = createDemoWorkspace();
  const actor = workspace.users.find((user) => user.id === userId);
  return { workspace, actor, dashboard: buildDashboardOverview({ actor, plans: workspace.plans, payouts: workspace.payouts, today: todayLocalDate() }) };
}

const metricLabels = (dashboard) => dashboard.metricGroups.flatMap((group) => group.metrics.map((metric) => metric.label));

test("advisor dashboard prioritises plan creation and claims without Dashub finance", () => {
  const { actor, workspace, dashboard } = dashboardFor("sandbox-advisor");
  assert.equal(dashboard.role, "advisor");
  assert.deepEqual(dashboard.actions.map((action) => action.label), ["Create a Plan", "Claim a Plan"]);
  assert.ok(metricLabels(dashboard).includes("Active Plans"));
  assert.ok(!metricLabels(dashboard).includes("Customer Collections"));
  assert.ok(!metricLabels(dashboard).includes("Dashub Revenue / Fees"));
  assert.ok(dashboard.attention.some((item) => item.id === "funding-risk"));
  assert.ok(!dashboard.attention.some((item) => ["awaiting-invoices", "invoice-exceptions"].includes(item.id)));
  assert.ok(dashboard.recentPlans.every((summary) => canViewPlan(actor, workspace.plans.find((plan) => plan.id === summary.id))));
});

test("manager dashboard shows dealership commercial and operational information only", () => {
  const { actor, workspace, dashboard } = dashboardFor("harbour-manager");
  assert.equal(dashboard.role, "manager");
  for (const label of ["Active Plans", "Plans Sold This Month", "Plan Value Sold This Month", "Services / Claims", "Claims Awaiting Dealer Invoice", "Upcoming Dealer Payout", "Plans At Risk of Expiry", "Funding / Payment Issues"]) {
    assert.ok(metricLabels(dashboard).includes(label), `missing manager metric: ${label}`);
  }
  assert.ok(dashboard.attention.some((item) => item.id === "awaiting-invoices"));
  assert.ok(dashboard.attention.some((item) => item.id === "expiry-risk"));
  assert.ok(!metricLabels(dashboard).includes("Customer Collections"));
  assert.ok(dashboard.recentPlans.every((summary) => canViewPlan(actor, workspace.plans.find((plan) => plan.id === summary.id))));
  assert.ok(!dashboard.recentPlans.some((summary) => workspace.plans.find((plan) => plan.id === summary.id)?.dealerGroupId === "gazley-demo"));
});

test("Dashub Admin dashboard exposes platform financial and operational exceptions", () => {
  const { dashboard } = dashboardFor("dashub-admin");
  assert.equal(dashboard.role, "dashub_admin");
  for (const label of ["Active Plans", "New Plans", "New Plan Value", "Customer Collections", "Claims Payable", "Next Weekly Dealer Payout", "Dashub Revenue / Fees", "Failed Collections", "Invoice Exceptions", "Plans At Risk of Expiry"]) {
    assert.ok(metricLabels(dashboard).includes(label), `missing admin metric: ${label}`);
  }
  assert.ok(dashboard.attention.some((item) => item.id === "invoice-exceptions"));
  assert.ok(dashboard.attention.some((item) => item.id === "failed-collections"));
  assert.ok(dashboard.attention.some((item) => item.id === "expiry-risk"));
});

test("recent plan summary leads with registration and keeps the internal reference secondary", () => {
  const workspace = createDemoWorkspace();
  const plan = workspace.plans.find((item) => item.id === "active-schedule");
  const summary = summarizePlanForDashboard(plan);
  assert.equal(summary.customerName, "Priya Nair");
  assert.match(summary.vehicleLabel, /^SVC201 · 2023 Toyota Corolla$/);
  assert.equal(summary.internalReference, "active-schedule");
  assert.equal(summary.serviceCount, 2);
});
