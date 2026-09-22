import test from "node:test";
import assert from "node:assert/strict";
import { canEditPlan, canViewPlan, DEMO_ACTOR } from "../lib/domain/permissions.js";
import { createServicePlans } from "../lib/application/service-plans.js";
import { manualServiceSource } from "../lib/adapters/manual-service-source.js";
import { createDemoPlans } from "../lib/adapters/demo-data.js";

test("dealer edits respect group and pricing permission; manufacturer plans stay locked", () => {
  const [dealer, manufacturer] = createDemoPlans();
  assert.equal(canEditPlan(DEMO_ACTOR, dealer), true);
  assert.equal(canEditPlan(DEMO_ACTOR, manufacturer), false);
  assert.equal(canEditPlan({ ...DEMO_ACTOR, dealerGroupId: "another-group" }, dealer), false);
  assert.equal(canEditPlan({ ...DEMO_ACTOR, permissions: { ...DEMO_ACTOR.permissions, priceDealerPlans: false } }, dealer), false);
  assert.equal(canViewPlan({ ...DEMO_ACTOR, manufacturerIds: [] }, manufacturer), false);
  const repository = { list: () => [dealer, manufacturer], get: (id) => [dealer, manufacturer].find((plan) => plan.id === id), put: () => { throw new Error("must not write"); } };
  const app = createServicePlans({ repository, serviceSource: manualServiceSource });
  assert.throws(() => app.saveDealerQuote(DEMO_ACTOR, manufacturer.draft, manufacturer.id), /permission/);
});
