import { buildQuote } from "../domain/quote.js";
import { actorFromUser, canClaimPlan, canCreateDealerPlan, canEditPlan, canManageTemplate, canReverseClaim, canViewPlan, isDashubAdmin } from "../domain/permissions.js";
import { activateQuote, cancelPlan, claimNextService, markWeeklyPayoutPaid, receiveDealerInvoice, recordTopUp, resolveInvoiceException, reverseServiceClaim, scheduleWeeklyPayouts, simulateScheduledPayment } from "../domain/operations.js";
import { buildFinanceOverview } from "../domain/finance.js";
import { sandboxIntegrations } from "../adapters/sandbox-integrations.js";

const newId = () => globalThis.crypto?.randomUUID?.() ?? `sandbox-${Date.now()}-${Math.random()}`;
const context = (actor) => ({ actorId: actor.id });

function permitted(condition) { if (!condition) throw new Error("You do not have permission for this action."); }
function requiredPlan(repository, actor, id) {
  const plan = repository.get(id);
  if (!plan || !canViewPlan(actor, plan)) throw new Error("Plan was not found or is outside your access.");
  return plan;
}

export function createServicePlans({ repository, serviceSource, integrations = sandboxIntegrations }) {
  if (!repository || typeof repository.list !== "function" || typeof repository.put !== "function") throw new Error("A plan repository is required.");
  if (!serviceSource || typeof serviceSource.getProposals !== "function") throw new Error("A service proposal source is required.");

  return {
    capabilities: () => ({ payments: integrations.paymentProvider.connected, vehicleLookup: integrations.vehicleLookup.connected, email: integrations.emailSender.connected }),
    workspace: () => repository.getWorkspace(),
    actor: (id) => actorFromUser(repository.getWorkspace(), id),
    list(actor) { return repository.list().filter((plan) => canViewPlan(actor, plan)); },
    get(actor, id) { const plan = repository.get(id); return plan && canViewPlan(actor, plan) ? plan : null; },
    proposedServices: (input) => serviceSource.getProposals(input),
    quote: buildQuote,
    saveDealerQuote(actor, draft, id = null) {
      const existing = id ? repository.get(id) : null;
      if (id && !existing) throw new Error("Plan was not found.");
      permitted(existing ? canEditPlan(actor, existing) : canCreateDealerPlan(actor));
      const quote = buildQuote(draft);
      const now = new Date().toISOString();
      return repository.put({
        ...existing,
        id: existing?.id ?? newId(), origin: "dealer", status: "quote",
        dealerGroupId: existing?.dealerGroupId ?? actor.dealerGroupId,
        branchId: existing?.branchId ?? actor.branchId,
        advisorId: existing?.advisorId ?? actor.id,
        quoteCreatorId: existing?.quoteCreatorId ?? actor.id,
        createdAt: existing?.createdAt ?? now, updatedAt: now, quote, draft,
        audit: [...(existing?.audit ?? []), { id: newId(), at: now, actorId: actor.id, action: existing ? "quote_updated" : "quote_created", summary: "Sandbox quote saved." }],
      });
    },
    activate(actor, id) {
      const plan = requiredPlan(repository, actor, id);
      permitted(isDashubAdmin(actor) || actor.permissions?.activatePlans);
      const company = repository.getWorkspace().companies.find((item) => item.id === plan.dealerGroupId);
      return repository.put(activateQuote(plan, { subscriptionActive: company?.subscriptionActive, commercialTerms: company?.commercialTerms }, context(actor)));
    },
    simulatePayment(actor, id, paymentId, outcome) {
      const plan = requiredPlan(repository, actor, id);
      permitted(isDashubAdmin(actor) || actor.permissions?.managePayments);
      return repository.put(simulateScheduledPayment(plan, paymentId, outcome, context(actor)));
    },
    topUp(actor, id, amountCents) {
      const plan = requiredPlan(repository, actor, id);
      permitted(isDashubAdmin(actor) || actor.permissions?.managePayments);
      return repository.put(recordTopUp(plan, amountCents, context(actor)));
    },
    claim(actor, id, input) {
      const plan = requiredPlan(repository, actor, id);
      permitted(canClaimPlan(actor, plan, repository.getWorkspace()));
      return repository.put(claimNextService(plan, input, context(actor)));
    },
    reverseClaim(actor, id, claimId, reason) {
      const plan = requiredPlan(repository, actor, id);
      permitted(canReverseClaim(actor, plan));
      const result = reverseServiceClaim(plan, repository.listPayouts(), repository.listAdjustments(), claimId, reason, context(actor));
      repository.putMany([result.plan], result.payouts, result.adjustments);
      return result;
    },
    receiveInvoice(actor, id, claimId, input) {
      const plan = requiredPlan(repository, actor, id);
      permitted(isDashubAdmin(actor) || actor.permissions?.manageInvoices);
      const duplicate = repository.list().some((item) => item.claims?.some((claim) => claim.invoice?.number?.toLowerCase() === String(input.invoiceNumber ?? "").trim().toLowerCase()));
      if (duplicate) throw new Error("Invoice number already exists in this sandbox.");
      return repository.put(receiveDealerInvoice(plan, claimId, input, context(actor)));
    },
    resolveInvoice(actor, id, claimId, reason) {
      permitted(isDashubAdmin(actor));
      return repository.put(resolveInvoiceException(requiredPlan(repository, actor, id), claimId, reason, context(actor)));
    },
    schedulePayouts(actor) {
      permitted(isDashubAdmin(actor));
      const result = scheduleWeeklyPayouts(repository.list(), repository.listPayouts(), context(actor), repository.listAdjustments());
      if (result.created.length) repository.putMany(result.plans, result.payouts, result.adjustments);
      return result.created;
    },
    markPayoutPaid(actor, payoutId) {
      permitted(isDashubAdmin(actor));
      const result = markWeeklyPayoutPaid(repository.list(), repository.listPayouts(), payoutId, context(actor), repository.listAdjustments());
      repository.putMany(result.plans, result.payouts, result.adjustments);
      return result.payouts.find((item) => item.id === payoutId);
    },
    cancel(actor, id, cancellationFeeCents) {
      permitted(isDashubAdmin(actor));
      return repository.put(cancelPlan(requiredPlan(repository, actor, id), cancellationFeeCents, context(actor)));
    },
    templates(actor) {
      return repository.listTemplates().filter((template) => template.origin === "manufacturer"
        ? isDashubAdmin(actor) || actor.manufacturerIds?.includes(template.manufacturerId)
        : isDashubAdmin(actor) || actor.dealerGroupId === template.dealerGroupId);
    },
    saveTemplate(actor, input, id = null) {
      const existing = id ? repository.listTemplates().find((item) => item.id === id) : null;
      if (id && !existing) throw new Error("Template was not found.");
      const target = existing ?? { origin: "dealer", dealerGroupId: actor.dealerGroupId };
      permitted(canManageTemplate(actor, target));
      const brand = String(input.brand ?? "").trim();
      const model = String(input.model ?? "").trim();
      if (!brand || !model) throw new Error("Brand and model are required.");
      if (!Array.isArray(input.services) || !input.services.length) throw new Error("At least one service is required.");
      const quoteDraft = {
        quoteDate: "2026-01-01", customer: { firstName: "Template", lastName: "Validation", mobile: "0210000000", email: "template@example.test", address: "Sandbox" },
        vehicle: { year: "2024", make: brand, model }, currentOdometer: "0", annualKm: "15000",
        intervalMonths: input.intervalMonths, intervalKm: input.intervalKm,
        numberOfServices: String(input.services.length), services: input.services,
        frequency: "weekly", firstPaymentDate: "2026-01-08",
      };
      buildQuote(quoteDraft);
      return repository.putTemplate({ ...target, id: existing?.id ?? newId(), brand, model,
        intervalMonths: String(input.intervalMonths), intervalKm: String(input.intervalKm),
        branchIds: input.branchIds ?? [], services: input.services.map((item) => ({ ...item })), updatedAt: new Date().toISOString() });
    },
    payouts(actor) { return repository.listPayouts().filter((payout) => isDashubAdmin(actor) || payout.dealerGroupId === actor.dealerGroupId); },
    adjustments(actor) { return repository.listAdjustments().filter((adjustment) => isDashubAdmin(actor) || adjustment.dealerGroupId === actor.dealerGroupId); },
    finance(actor, today) {
      permitted(isDashubAdmin(actor));
      return buildFinanceOverview(repository.list(), repository.listPayouts(), today, repository.listAdjustments());
    },
    updateCompany(actor, id, changes) {
      permitted(isDashubAdmin(actor));
      const current = repository.getWorkspace().companies.find((item) => item.id === id);
      if (!current) throw new Error("Dealer group not found.");
      return repository.updateCompany({ ...current, subscriptionActive: changes.subscriptionActive ?? current.subscriptionActive,
        manufacturerAdministration: changes.manufacturerAdministration ?? current.manufacturerAdministration });
    },
    updateUser(actor, id, permissions) {
      permitted(isDashubAdmin(actor));
      const current = repository.getWorkspace().users.find((item) => item.id === id);
      if (!current) throw new Error("User not found.");
      return repository.updateUser({ ...current, permissions: { ...current.permissions, ...permissions } });
    },
  };
}
