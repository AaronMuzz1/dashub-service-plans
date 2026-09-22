export const DEMO_ACTOR = Object.freeze({
  id: "sandbox-advisor",
  name: "Sandbox advisor",
  role: "advisor",
  dealerGroupId: "gazley-demo",
  branchId: "wellington-demo",
  manufacturerIds: ["sample-manufacturer"],
  permissions: {
    createDealerPlans: true,
    editDealerPlans: true,
    priceDealerPlans: true,
    viewManufacturerPlans: true,
    claimServices: true,
    manageDealerTemplates: true,
  },
});

export function isDashubAdmin(actor) { return actor?.role === "dashub_admin"; }

export function actorFromUser(workspace, userId) {
  const user = workspace.users.find((item) => item.id === userId);
  if (!user) throw new Error("Sandbox user was not found.");
  return { ...user, permissions: { ...user.permissions } };
}

export function canCreateDealerPlan(actor) {
  return Boolean(actor?.dealerGroupId && actor?.permissions?.createDealerPlans && actor?.permissions?.priceDealerPlans);
}

export function canEditPlan(actor, plan) {
  return Boolean(plan?.origin === "dealer" && plan.status === "quote" && (isDashubAdmin(actor) || actor?.dealerGroupId === plan.dealerGroupId)
    && actor?.permissions?.editDealerPlans && actor?.permissions?.priceDealerPlans);
}

export function canViewPlan(actor, plan) {
  if (isDashubAdmin(actor)) return true;
  if (plan?.origin === "manufacturer") return Boolean(actor?.permissions?.viewManufacturerPlans && actor?.manufacturerIds?.includes(plan.manufacturerId));
  return Boolean(actor?.dealerGroupId && actor.dealerGroupId === plan?.dealerGroupId);
}

export function canClaimPlan(actor, plan, workspace) {
  const company = workspace.companies.find((item) => item.id === plan?.dealerGroupId);
  return Boolean(plan?.status === "active" && company?.subscriptionActive && canViewPlan(actor, plan)
    && (isDashubAdmin(actor) || actor?.permissions?.claimServices));
}

export function canManageTemplate(actor, template) {
  return Boolean(template?.origin === "dealer" && (isDashubAdmin(actor) || actor?.dealerGroupId === template.dealerGroupId)
    && actor?.permissions?.manageDealerTemplates && actor?.permissions?.priceDealerPlans);
}
