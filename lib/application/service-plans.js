import { buildQuote } from "../domain/quote.js";
import { canCreateDealerPlan, canEditPlan, canViewPlan } from "../domain/permissions.js";
import { sandboxIntegrations } from "../adapters/sandbox-integrations.js";

function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `sandbox-${Date.now()}-${Math.random()}`;
}

export function createServicePlans({ repository, serviceSource, integrations = sandboxIntegrations }) {
  if (!repository || typeof repository.list !== "function" || typeof repository.put !== "function") {
    throw new Error("A plan repository is required.");
  }
  if (!serviceSource || typeof serviceSource.getProposals !== "function") {
    throw new Error("A service proposal source is required.");
  }
  return {
    capabilities: () => ({ payments: integrations.paymentProvider.connected, vehicleLookup: integrations.vehicleLookup.connected, email: integrations.emailSender.connected }),
    list(actor) { return repository.list().filter((plan) => canViewPlan(actor, plan)); },
    get(actor, id) {
      const plan = repository.get(id);
      return plan && canViewPlan(actor, plan) ? plan : null;
    },
    proposedServices(context) { return serviceSource.getProposals(context); },
    quote: buildQuote,
    saveDealerQuote(actor, draft, id = null) {
      const existing = id ? repository.get(id) : null;
      if (id && !existing) throw new Error("Plan was not found.");
      if (existing ? !canEditPlan(actor, existing) : !canCreateDealerPlan(actor)) {
        throw new Error("You do not have permission to change this plan.");
      }
      const quote = buildQuote(draft);
      const now = new Date().toISOString();
      return repository.put({
        id: existing?.id ?? newId(),
        origin: "dealer",
        status: "quote",
        dealerGroupId: existing?.dealerGroupId ?? actor.dealerGroupId,
        branchId: existing?.branchId ?? actor.branchId,
        advisorId: existing?.advisorId ?? actor.id,
        quoteCreatorId: existing?.quoteCreatorId ?? actor.id,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        quote,
        draft,
      });
    },
  };
}
