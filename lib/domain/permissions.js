export const DEMO_ACTOR = Object.freeze({
  id: "sandbox-advisor",
  name: "Sandbox advisor",
  dealerGroupId: "gazley-demo",
  branchId: "wellington-demo",
  manufacturerIds: ["sample-manufacturer"],
  permissions: {
    createDealerPlans: true,
    editDealerPlans: true,
    priceDealerPlans: true,
    viewManufacturerPlans: true,
  },
});

export function canCreateDealerPlan(actor) {
  return Boolean(actor?.dealerGroupId && actor?.permissions?.createDealerPlans && actor?.permissions?.priceDealerPlans);
}

export function canEditPlan(actor, plan) {
  return Boolean(plan?.origin === "dealer" && actor?.dealerGroupId === plan.dealerGroupId
    && actor?.permissions?.editDealerPlans && actor?.permissions?.priceDealerPlans);
}

export function canViewPlan(actor, plan) {
  if (plan?.origin === "manufacturer") return Boolean(actor?.permissions?.viewManufacturerPlans && actor?.manufacturerIds?.includes(plan.manufacturerId));
  return Boolean(actor?.dealerGroupId && actor.dealerGroupId === plan?.dealerGroupId);
}
