import { buildQuote } from "../domain/quote.js";
import { todayLocalDate } from "../domain/dates.js";
import { actorFromUser, canClaimPlan, canCreateDealerPlan, canEditPlan, canManageTemplate, canReverseClaim, canViewPlan, isDashubAdmin } from "../domain/permissions.js";
import { activateQuote, cancelPlan, claimNextService, markWeeklyPayoutPaid, receiveDealerInvoice, recordTopUp, resolveInvoiceException, reverseServiceClaim, scheduleWeeklyPayouts, simulateScheduledPayment } from "../domain/operations.js";
import { buildFinanceOverview } from "../domain/finance.js";
import {
  activationPrerequisites, assignQuote, expireQuote, issueQuote as issueQuoteRecord, markQuoteLost,
  matchCustomers, nextQuoteNumber, quoteValidityDays, recordFollowUp, recordPaymentMethod,
  recordSignature, supersedeQuote,
} from "../domain/sales.js";
import { buildSalesPerformance } from "../domain/performance.js";
import { createQuotePdf, quotePdfFilename } from "../documents/quote-pdf.js";
import { createSalesExcel } from "../documents/sales-excel.js";
import { sandboxIntegrations } from "../adapters/sandbox-integrations.js";

const newId = () => globalThis.crypto?.randomUUID?.() ?? `sandbox-${Date.now()}-${Math.random()}`;
const context = (actor, options = {}) => ({ actorId: actor.id, ...options });
const copy = (value) => JSON.parse(JSON.stringify(value));

function permitted(condition) { if (!condition) throw new Error("You do not have permission for this action."); }
function requiredPlan(repository, actor, id) {
  const plan = repository.get(id);
  if (!plan || !canViewPlan(actor, plan)) throw new Error("Plan was not found or is outside your access.");
  return plan;
}
function companyFor(repository, plan) { return repository.getWorkspace().companies.find((item) => item.id === plan.dealerGroupId); }
function log(record, actor, action, summary, at = new Date().toISOString()) {
  record.audit ??= [];
  record.audit.push({ id: newId(), at, actorId: actor.id, action, summary });
  record.updatedAt = at;
}

export function createServicePlans({ repository, serviceSource, integrations = sandboxIntegrations }) {
  if (!repository || typeof repository.list !== "function" || typeof repository.put !== "function") throw new Error("A plan repository is required.");
  if (!serviceSource || typeof serviceSource.getProposals !== "function") throw new Error("A service proposal source is required.");

  function expireAccessible(actor, today = todayLocalDate()) {
    const changes = repository.list().filter((plan) => canViewPlan(actor, plan)).map((plan) => expireQuote(plan, today, context(actor, { at: `${today}T00:00:00.000Z` })))
      .filter((plan) => repository.get(plan.id)?.quoteRecord?.status !== plan.quoteRecord?.status);
    if (changes.length) repository.putMany(changes);
  }

  const api = {
    capabilities: () => ({
      payments: integrations.paymentProvider.connected, vehicleLookup: integrations.vehicleLookup.connected, email: integrations.emailSender.connected,
      sandbox: { payments: integrations.paymentProvider.mode === "sandbox", vehicleLookup: integrations.vehicleLookup.mode === "sandbox", email: integrations.emailSender.mode === "sandbox" },
    }),
    workspace: () => repository.getWorkspace(),
    actor: (id) => actorFromUser(repository.getWorkspace(), id),
    list(actor, today = todayLocalDate()) { expireAccessible(actor, today); return repository.list().filter((plan) => canViewPlan(actor, plan)); },
    get(actor, id, today = todayLocalDate()) { expireAccessible(actor, today); const plan = repository.get(id); return plan && canViewPlan(actor, plan) ? plan : null; },
    proposedServices: (input) => serviceSource.getProposals(input),
    quote: buildQuote,
    customerMatches(actor, query) { return matchCustomers(api.list(actor), query); },
    lookupVehicle(actor, registration) {
      permitted(Boolean(actor?.dealerGroupId) || isDashubAdmin(actor));
      return integrations.vehicleLookup.lookupRegistration(registration);
    },
    planOptions(actor, draft) {
      const make = String(draft?.vehicle?.make ?? "").toLowerCase();
      const model = String(draft?.vehicle?.model ?? "").toLowerCase();
      const templates = api.templates(actor).filter((template) => (!template.brand || template.brand.toLowerCase() === make)
        && (!template.model || template.model.toLowerCase() === model)
        && (template.origin === "manufacturer" || !template.branchIds?.length || template.branchIds.includes(actor.branchId)));
      return [
        ...templates.map((template) => ({ ...copy(template), optionType: template.origin, lockedPricing: template.origin === "manufacturer" })),
        { id: "custom", optionType: "custom", origin: "dealer", name: "Create Custom Plan", lockedPricing: false },
      ];
    },
    saveDraft(actor, draft, currentStep = 0, id = null, metadata = {}) {
      const existing = id ? repository.get(id) : null;
      if (id && !existing) throw new Error("Plan was not found.");
      if (existing) permitted(canEditPlan(actor, existing));
      const origin = draft.planSource?.origin === "manufacturer" ? "manufacturer" : "dealer";
      if (!existing) permitted(origin === "manufacturer"
        ? actor.permissions?.viewManufacturerPlans && actor.manufacturerIds?.includes(draft.planSource?.manufacturerId)
        : canCreateDealerPlan(actor));
      if (origin === "manufacturer") {
        const template = repository.listTemplates().find((item) => item.id === draft.planSource?.templateId && item.origin === "manufacturer");
        if (!template) throw new Error("The authorised manufacturer plan setup was not found.");
        const unchanged = template.services.length === draft.services?.length && template.services.every((service, index) => {
          const proposed = draft.services[index];
          return service.name === proposed?.name && String(service.price) === String(proposed?.price) && (service.taxMode ?? "inclusive") === (proposed?.taxMode ?? "inclusive") && String(service.description ?? "") === String(proposed?.description ?? "");
        });
        if (!unchanged) throw new Error("Authorised manufacturer service descriptions and pricing are locked.");
      }
      let quote = null;
      try { quote = buildQuote(draft); } catch { /* Partial drafts are intentionally valid. */ }
      const now = metadata.at ?? new Date().toISOString();
      const saved = {
        ...existing,
        id: existing?.id ?? newId(), origin, status: "draft",
        manufacturerId: draft.planSource?.manufacturerId ?? existing?.manufacturerId,
        dealerGroupId: existing?.dealerGroupId ?? actor.dealerGroupId,
        branchId: existing?.branchId ?? actor.branchId,
        originalCreatorId: existing?.originalCreatorId ?? actor.id,
        currentEditorId: actor.id,
        currentOwnerId: existing?.currentOwnerId ?? actor.id,
        supersedesQuoteId: metadata.supersedesQuoteId ?? existing?.supersedesQuoteId ?? null,
        createdAt: existing?.createdAt ?? now, updatedAt: now, quote, draft: copy(draft), currentStep,
        audit: [...(existing?.audit ?? []), { id: newId(), at: now, actorId: actor.id, action: existing ? "draft_updated" : "draft_created", summary: `Draft saved at wizard step ${currentStep + 1}.` }],
      };
      return repository.put(saved);
    },
    // Compatibility entry point retained for BUILD-001 callers. Deliberate issueQuote is now separate.
    saveDealerQuote(actor, draft, id = null) {
      if (id) permitted(repository.get(id)?.origin === "dealer");
      return api.saveDraft(actor, draft, 5, id);
    },
    issueQuote(actor, id, options = {}) {
      const plan = requiredPlan(repository, actor, id);
      permitted(plan.dealerGroupId === actor.dealerGroupId || isDashubAdmin(actor));
      const quote = buildQuote(plan.draft);
      const company = companyFor(repository, plan);
      const template = repository.listTemplates().find((item) => item.id === plan.draft?.planSource?.templateId);
      const validityDays = quoteValidityDays(plan, company, template);
      const at = options.at ?? new Date().toISOString();
      const issueDate = at.slice(0, 10);
      const prepared = { ...plan, quote };
      const issued = issueQuoteRecord(prepared, {
        number: nextQuoteNumber(repository.list(), issueDate), validityDays,
        followUpSettings: company?.followUpSettings,
      }, context(actor, { at }));
      if (prepared.supersedesQuoteId) {
        const old = requiredPlan(repository, actor, prepared.supersedesQuoteId);
        const superseded = supersedeQuote(old, issued.id, context(actor, { at }));
        issued.supersedesQuoteId = old.id;
        repository.putMany([superseded, issued]);
      } else repository.put(issued);
      return issued;
    },
    markQuoteLost(actor, id, reason, options = {}) {
      const plan = requiredPlan(repository, actor, id);
      permitted(plan.dealerGroupId === actor.dealerGroupId || isDashubAdmin(actor));
      return repository.put(markQuoteLost(plan, reason, context(actor, options)));
    },
    assignQuote(actor, id, advisorId, reason, options = {}) {
      const plan = requiredPlan(repository, actor, id);
      const target = repository.getWorkspace().users.find((user) => user.id === advisorId);
      permitted(target && target.dealerGroupId === plan.dealerGroupId && (isDashubAdmin(actor) || actor.dealerGroupId === plan.dealerGroupId));
      if (!["advisor", "manager"].includes(target.role)) throw new Error("Quote ownership can only be assigned to a sales participant.");
      return repository.put(assignQuote(plan, advisorId, reason, context(actor, options)));
    },
    recordFollowUp(actor, id, input, options = {}) {
      const plan = requiredPlan(repository, actor, id);
      permitted(plan.dealerGroupId === actor.dealerGroupId || isDashubAdmin(actor));
      const settings = companyFor(repository, plan)?.followUpSettings;
      return repository.put(recordFollowUp(plan, input, settings, context(actor, options)));
    },
    recordSignature(actor, id, input, options = {}) {
      const plan = requiredPlan(repository, actor, id);
      permitted(plan.dealerGroupId === actor.dealerGroupId || isDashubAdmin(actor));
      return repository.put(recordSignature(plan, input, context(actor, options)));
    },
    setupPaymentMethod(actor, id, options = {}) {
      const plan = requiredPlan(repository, actor, id);
      permitted(plan.dealerGroupId === actor.dealerGroupId || isDashubAdmin(actor));
      const customerName = `${plan.quote.customer.firstName} ${plan.quote.customer.lastName}`;
      const token = integrations.paymentProvider.setupPaymentMethod({ customerName });
      return repository.put(recordPaymentMethod(plan, token, context(actor, options)));
    },
    activationPrerequisites(actor, id) { return activationPrerequisites(requiredPlan(repository, actor, id)); },
    activate(actor, id, options = {}) {
      let plan = requiredPlan(repository, actor, id);
      permitted(isDashubAdmin(actor) || actor.permissions?.activatePlans);
      if (plan.status === "quote") {
        plan = expireQuote(plan, options.today ?? todayLocalDate(), context(actor));
        if (plan.quoteRecord?.status !== "outstanding") throw new Error("Only a valid outstanding quote can be activated. Refresh and reissue expired pricing.");
      }
      if (plan.status !== "quote" && plan.status !== "draft") throw new Error("Only a draft direct sale or valid quote can be activated.");
      if (!plan.quote) plan = { ...plan, quote: buildQuote(plan.draft) };
      if (plan.quote.paymentChange?.requiresConfirmation && !plan.draft?.paymentChangeConfirmed) throw new Error("Confirm the changed instalment amount before activation.");
      const company = companyFor(repository, plan);
      const at = options.at ?? new Date().toISOString();
      const activated = activateQuote(plan, {
        subscriptionActive: company?.subscriptionActive,
        commercialTerms: company?.commercialTerms,
        activationEvidence: plan.activation,
        requirePrerequisites: true,
      }, context(actor, { at }));
      activated.sellingAdvisorId = actor.id;
      activated.directSale = !plan.quoteRecord;
      if (activated.quoteRecord) {
        const previousOwner = activated.quoteRecord.currentOwnerId;
        activated.quoteRecord.status = "sold";
        activated.quoteRecord.soldAt = at;
        activated.quoteRecord.terminalAt = at;
        activated.quoteRecord.nextFollowUpDate = null;
        activated.quoteRecord.convertingAdvisorId = actor.id;
        activated.quoteRecord.currentOwnerId = actor.id;
        if (previousOwner !== actor.id) activated.quoteRecord.assignmentHistory.push({ id: newId(), at, actorId: actor.id, fromAdvisorId: previousOwner, toAdvisorId: actor.id, reason: "Automatic conversion assignment" });
      }
      const adminEmail = company?.servicePlansAdminEmail;
      const recipients = [plan.quote.customer.email, adminEmail].filter(Boolean);
      activated.contractDelivery = recipients.map((to) => integrations.emailSender.deliver({
        to, subject: `Your Service Plan contract`, documentName: `${activated.contract.contractVersion}-${activated.id}.pdf`,
      }));
      activated.activation.signedDocument = { contractVersion: activated.contract.contractVersion, retained: true, signatureMethod: activated.activation.signature.method };
      log(activated, actor, "contract_delivery_logged", `${activated.contractDelivery.length} sandbox contract deliveries logged; no live email sent.`, at);
      return repository.put(activated);
    },
    quotePdf(actor, id) {
      const plan = requiredPlan(repository, actor, id);
      const company = companyFor(repository, plan);
      const branch = company?.branches?.find((item) => item.id === plan.branchId);
      const dealer = { name: branch?.tradingName ?? company?.name, address: branch?.address ?? company?.address, phone: branch?.phone ?? company?.phone, email: branch?.email ?? company?.email, logo: branch?.logo ?? company?.logo };
      return { bytes: createQuotePdf(plan, dealer), filename: quotePdfFilename(plan), mimeType: "application/pdf" };
    },
    salesPerformance(actor, filters = {}, today = todayLocalDate()) {
      return buildSalesPerformance({ plans: api.list(actor, today), users: repository.getWorkspace().users, companies: repository.getWorkspace().companies, actor, filters, today });
    },
    salesExcel(actor, filters = {}, today = todayLocalDate()) {
      const report = api.salesPerformance(actor, filters, today);
      return { content: createSalesExcel(report), filename: `dashplan-sales-${report.range.start}-to-${report.range.end}.xls`, mimeType: "application/vnd.ms-excel" };
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
        vehicle: { year: "2024", make: brand, model }, lastCompletedService: { date: "2026-01-01", odometer: "0", serviceTablePosition: null },
        currentOdometer: "0", annualKm: "15000", intervalMonths: input.intervalMonths, intervalKm: input.intervalKm,
        numberOfServices: String(input.services.length), services: input.services, frequency: "weekly", firstPaymentDate: "2026-01-08",
      };
      buildQuote(quoteDraft);
      return repository.putTemplate({ ...target, id: existing?.id ?? newId(), brand, model,
        intervalMonths: String(input.intervalMonths), intervalKm: String(input.intervalKm), quoteValidityDays: input.quoteValidityDays ?? existing?.quoteValidityDays ?? 30,
        branchIds: input.branchIds ?? [], services: input.services.map((item) => ({ ...item })), updatedAt: new Date().toISOString() });
    },
    updateManufacturerProgram(actor, id, changes) {
      permitted(isDashubAdmin(actor));
      const template = repository.listTemplates().find((item) => item.id === id && item.origin === "manufacturer");
      if (!template) throw new Error("Manufacturer program was not found.");
      const quoteValidityDays = Number(changes.quoteValidityDays);
      if (!Number.isSafeInteger(quoteValidityDays) || quoteValidityDays < 1 || quoteValidityDays > 365) throw new Error("Quote validity must be between 1 and 365 days.");
      return repository.putTemplate({ ...template, quoteValidityDays, updatedAt: new Date().toISOString(), updatedBy: actor.id });
    },
    payouts(actor) { return repository.listPayouts().filter((payout) => isDashubAdmin(actor) || payout.dealerGroupId === actor.dealerGroupId); },
    adjustments(actor) { return repository.listAdjustments().filter((adjustment) => isDashubAdmin(actor) || adjustment.dealerGroupId === actor.dealerGroupId); },
    finance(actor, today) { permitted(isDashubAdmin(actor)); return buildFinanceOverview(repository.list(), repository.listPayouts(), today, repository.listAdjustments()); },
    updateCompany(actor, id, changes) {
      permitted(isDashubAdmin(actor));
      const current = repository.getWorkspace().companies.find((item) => item.id === id);
      if (!current) throw new Error("Dealer group not found.");
      if (changes.quoteValidityDays !== undefined && (!Number.isSafeInteger(changes.quoteValidityDays) || changes.quoteValidityDays < 1 || changes.quoteValidityDays > 365)) throw new Error("Quote validity must be between 1 and 365 days.");
      if (changes.followUpSettings) {
        const { firstAfterDays, secondAfterDays, finalBeforeExpiryDays } = changes.followUpSettings;
        if (![firstAfterDays, secondAfterDays, finalBeforeExpiryDays].every((value) => Number.isSafeInteger(value) && value > 0) || secondAfterDays <= firstAfterDays) throw new Error("Follow-up timing must use positive days with the second follow-up after the first.");
      }
      if (changes.servicePlansAdminEmail !== undefined && !/^\S+@\S+\.\S+$/.test(changes.servicePlansAdminEmail)) throw new Error("Enter a valid Service Plans administration email.");
      return repository.updateCompany({ ...current, ...changes, id: current.id, branches: current.branches, commercialTerms: current.commercialTerms });
    },
    updateUser(actor, id, permissions) {
      permitted(isDashubAdmin(actor));
      const current = repository.getWorkspace().users.find((item) => item.id === id);
      if (!current) throw new Error("User not found.");
      return repository.updateUser({ ...current, permissions: { ...current.permissions, ...permissions } });
    },
  };
  return api;
}
