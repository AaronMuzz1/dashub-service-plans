import test from "node:test";
import assert from "node:assert/strict";
import { createDemoWorkspace } from "../lib/adapters/demo-data.js";
import { createLocalPlanRepository } from "../lib/adapters/local-plan-repository.js";
import { manualServiceSource } from "../lib/adapters/manual-service-source.js";
import { createServicePlans } from "../lib/application/service-plans.js";

function fixture() {
  const values = new Map();
  const repository = createLocalPlanRepository({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
  repository.seed(createDemoWorkspace());
  return createServicePlans({ repository, serviceSource: manualServiceSource });
}

function prepareActivation(app, actor, id) {
  app.recordSignature(actor, id, { method: "digital", evidence: "data:image/png;base64,c2ln", contractVersion: "DP-CONTRACT-V1", customerName: actor.name }, { at: "2026-10-20T09:00:00.000Z" });
  app.setupPaymentMethod(actor, id, { at: "2026-10-20T09:05:00.000Z" });
}

test("follow-up scheduling, outcome history, duplicate prevention and ownership changes are audited", () => {
  const app = fixture();
  const advisor = app.actor("sandbox-advisor");
  const manager = app.actor("gazley-manager");
  const quote = app.issueQuote(advisor, "demo-dealer", { at: "2026-10-01T09:00:00.000Z" });
  assert.equal(quote.quoteRecord.nextFollowUpDate, "2026-10-08");
  const assigned = app.assignQuote(manager, quote.id, manager.id, "Manager reassignment", { at: "2026-10-02T09:00:00.000Z" });
  assert.equal(assigned.quoteRecord.currentOwnerId, manager.id);
  assert.equal(assigned.quoteRecord.assignmentHistory.length, 2);
  const followed = app.recordFollowUp(advisor, quote.id, { actionId: "follow-1", outcome: "No Answer", notes: "Left voicemail" }, { at: "2026-10-08T10:00:00.000Z" });
  assert.equal(followed.quoteRecord.nextFollowUpDate, "2026-10-15");
  assert.equal(followed.quoteRecord.followUps[0].advisorId, advisor.id);
  assert.throws(() => app.recordFollowUp(advisor, quote.id, { actionId: "follow-1", outcome: "No Answer", notes: "Left voicemail" }, { at: "2026-10-08T10:00:00.000Z" }), /already been recorded/);
  const considering = app.recordFollowUp(manager, quote.id, { actionId: "follow-2", outcome: "Customer Considering", notes: "Reviewing with family", nextFollowUpDate: "2026-10-20" }, { at: "2026-10-15T10:00:00.000Z" });
  assert.equal(considering.quoteRecord.nextFollowUpDate, "2026-10-20");
  const declined = app.recordFollowUp(manager, quote.id, { actionId: "follow-3", outcome: "Declined", notes: "Customer declined" }, { at: "2026-10-20T10:00:00.000Z" });
  assert.equal(declined.quoteRecord.status, "lost");
  assert.equal(declined.quoteRecord.nextFollowUpDate, null);
  assert.throws(() => app.recordFollowUp(manager, quote.id, { outcome: "Contacted", notes: "Too late" }), /stop|outstanding/);
});

test("conversion cohort reassigns to seller, excludes direct sales, and never exceeds 100 percent", () => {
  const app = fixture();
  const advisor = app.actor("sandbox-advisor");
  const manager = app.actor("gazley-manager");
  const quote = app.issueQuote(advisor, "demo-dealer", { at: "2026-10-17T09:00:00.000Z" });
  app.recordFollowUp(advisor, quote.id, { actionId: "conversion-follow", outcome: "Contacted", notes: "Customer ready" }, { at: "2026-10-18T09:00:00.000Z" });
  prepareActivation(app, manager, quote.id);
  const sold = app.activate(manager, quote.id, { at: "2026-10-20T10:00:00.000Z", today: "2026-10-20" });
  assert.equal(sold.quoteRecord.currentOwnerId, manager.id);
  assert.equal(sold.quoteRecord.quotingAdvisorId, advisor.id);
  assert.equal(sold.sellingAdvisorId, manager.id);
  assert.equal(sold.quoteRecord.assignmentHistory.at(-1).reason, "Automatic conversion assignment");

  const directDraft = structuredClone(app.get(manager, "demo-dealer").draft);
  directDraft.customer = { ...directDraft.customer, firstName: "Direct", email: "direct@example.test" };
  directDraft.vehicle.registration = "DIRECT1";
  const direct = app.saveDraft(manager, directDraft, 5);
  prepareActivation(app, manager, direct.id);
  app.activate(manager, direct.id, { at: "2026-10-21T10:00:00.000Z", today: "2026-10-21" });

  const report = app.salesPerformance(manager, { preset: "current_month", scope: "dealer_group" }, "2026-10-22");
  const managerRow = report.leaderboard.find((row) => row.advisorId === manager.id);
  const advisorRow = report.leaderboard.find((row) => row.advisorId === advisor.id);
  assert.ok(managerRow.plansSold >= 2);
  assert.ok(managerRow.assignedQuotes >= 1);
  assert.ok(managerRow.convertedAssigned >= 1);
  assert.ok(managerRow.conversionRate <= 100);
  assert.ok(advisorRow.quotesIssued >= 1);
  assert.equal(report.summary.directSales >= 1, true);
  assert.equal(report.summary.convertedFollowingFollowUp >= 1, true);
  assert.ok(report.leaderboard.some((row) => row.advisorId === "zero-advisor" && row.plansSold === 0 && row.quotesIssued === 0));
});

test("role and branch boundaries constrain performance while Dashub Admin can see platform tenants", () => {
  const app = fixture();
  const advisor = app.actor("sandbox-advisor");
  const admin = app.actor("dashub-admin");
  const branch = app.salesPerformance(advisor, { preset: "year", scope: "branch", branchId: "wellington-demo" }, "2026-10-22");
  assert.ok(branch.rows.every((row) => row.dealerGroupId === "gazley-demo" && row.branchId === "wellington-demo"));
  assert.ok(branch.leaderboard.every((row) => row.branchId === "wellington-demo"));
  const group = app.salesPerformance(advisor, { preset: "year", scope: "dealer_group" }, "2026-10-22");
  assert.ok(group.rows.every((row) => row.dealerGroupId === "gazley-demo"));
  const platform = app.salesPerformance(admin, { preset: "year", scope: "dealer_group" }, "2026-10-22");
  assert.ok(new Set(platform.rows.map((row) => row.dealerGroupId)).size > 1);
});

test("filtered Excel export contains quote, sales, advisor, branch and vehicle fields", () => {
  const app = fixture();
  const admin = app.actor("dashub-admin");
  const exported = app.salesExcel(admin, { preset: "year", scope: "dealer_group" }, "2026-10-22");
  assert.equal(exported.mimeType, "application/vnd.ms-excel");
  assert.match(exported.filename, /\.xls$/);
  for (const label of ["Sales Performance", "Quote", "Advisor", "Branch", "Brand", "Model", "Plan type", "Direct sale", "Follow-up outcome", "Follow-up"]) assert.ok(exported.content.includes(label), label);
});
