"use client";

import { useEffect, useRef, useState } from "react";
import { createLocalPlanRepository } from "../../lib/adapters/local-plan-repository.js";
import { createDemoWorkspace } from "../../lib/adapters/demo-data.js";
import { manualServiceSource } from "../../lib/adapters/manual-service-source.js";
import { createServicePlans } from "../../lib/application/service-plans.js";
import { formatMoney } from "../../lib/domain/money.js";
import { canCreateDealerPlan, isDashubAdmin } from "../../lib/domain/permissions.js";
import PlanForm, { newDraft } from "./PlanForm.jsx";
import PlanDetail from "./PlanDetail.jsx";
import Dashboard from "./Dashboard.jsx";
import { PayoutAdjustmentRegister } from "./ClaimReversals.jsx";
import { ClaimsArea, InvoicesArea, PayoutsArea } from "./WorkQueues.jsx";
import { AdminArea, FinanceArea, TemplatesArea } from "./ManagementAreas.jsx";
import ActivationFlow from "./ActivationFlow.jsx";
import SalesPerformance from "./SalesPerformance.jsx";
import { planRegisterCategory } from "../../lib/domain/sales.js";

const nav = [
  ["dashboard", "▦", "Dashboard"], ["plans", "▤", "Plans"], ["form", "＋", "Create Service Plan"], ["sales", "↗", "Sales Performance"],
  ["claims", "✓", "Claims"], ["invoices", "▧", "Invoices"], ["payouts", "↗", "Dealer payouts"],
  ["finance", "◫", "Finance"], ["templates", "◈", "Plan templates"], ["admin", "⚙", "Dashub Admin"],
];
const customerName = (plan) => { const customer = plan.quote?.customer ?? plan.draft?.customer ?? {}; return `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() || "Unnamed customer"; };

export default function ServicePlansApp() {
  const contentRef = useRef(null);
  const [service, setService] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [actorId, setActorId] = useState("dashub-admin");
  const [view, setView] = useState("dashboard");
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [templateDraft, setTemplateDraft] = useState(null);
  const [formInitialStep, setFormInitialStep] = useState(0);
  const [supersedesQuoteId, setSupersedesQuoteId] = useState(null);
  const [formSession, setFormSession] = useState(0);
  const [claimSession, setClaimSession] = useState(0);
  const [planSession, setPlanSession] = useState(0);
  const [planFocus, setPlanFocus] = useState(null);
  const [invoiceSession, setInvoiceSession] = useState(0);
  const [invoiceFilter, setInvoiceFilter] = useState("all");
  const [financeSession, setFinanceSession] = useState(0);
  const [financeKey, setFinanceKey] = useState("collected");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const repository = createLocalPlanRepository(window.localStorage);
    repository.seed(createDemoWorkspace());
    const instance = createServicePlans({ repository, serviceSource: manualServiceSource });
    setService(instance); setWorkspace(instance.workspace());
  }, []);
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }); }, [view, actorId]);

  const actor = workspace?.users.find((user) => user.id === actorId);
  const plans = service && actor ? service.list(actor) : [];
  const completedPlans = plans.filter((plan) => plan.quote);
  const selectedPlan = plans.find((plan) => plan.id === selectedId);
  const editingPlan = plans.find((plan) => plan.id === editingId);

  function navigate(next) {
    if (next === "form") return startCreate();
    if (["admin", "finance"].includes(next) && !isDashubAdmin(actor)) return;
    if (next === "plans") { setPlanFocus(null); setPlanSession((value) => value + 1); }
    if (next === "claims") { setSelectedId(null); setClaimSession((value) => value + 1); }
    if (next === "invoices") { setInvoiceFilter("all"); setInvoiceSession((value) => value + 1); }
    if (next === "finance") { setFinanceKey("collected"); setFinanceSession((value) => value + 1); }
    setView(next); setNotice(""); setError("");
  }
  function openDashboardTarget(target) {
    if (!target) return;
    if (target.view === "form") return startCreate();
    if (target.view === "detail") return openPlan(target.planId);
    if (target.view === "claims") {
      if (target.planId) return openClaims(target.planId);
      setSelectedId(null); setClaimSession((value) => value + 1); setView("claims");
    } else if (target.view === "plans") {
      setPlanFocus(target.planIds ? { ids: target.planIds, label: target.label } : null);
      setPlanSession((value) => value + 1); setView("plans");
    } else if (target.view === "invoices") {
      setInvoiceFilter(target.filter ?? "all"); setInvoiceSession((value) => value + 1); setView("invoices");
    } else if (target.view === "finance" && isDashubAdmin(actor)) {
      setFinanceKey(target.financeKey ?? "collected"); setFinanceSession((value) => value + 1); setView("finance");
    } else if (target.view === "payouts") setView("payouts");
    setNotice(""); setError("");
  }
  function refresh() { setWorkspace(service.workspace()); }
  function action(run, message) {
    try {
      const result = run();
      refresh(); setError(""); setNotice(typeof message === "function" ? message(result) : message ?? "Sandbox record updated.");
      return result;
    } catch (cause) { setError(cause.message); setNotice(""); return null; }
  }
  function activationAction(run, message) {
    const result = run(); refresh(); setError(""); setNotice(message); return result;
  }
  function openPlan(id) { setSelectedId(id); navigate("detail"); }
  function openClaims(id) { setSelectedId(id); setClaimSession((value) => value + 1); setView("claims"); setNotice(""); setError(""); }
  function startCreate(fromTemplate = null) {
    if (!canCreateDealerPlan(actor)) { setError("This persona cannot create priced dealer plans."); return; }
    setEditingId(null);
    setSupersedesQuoteId(null); setFormInitialStep(0);
    const blank = newDraft();
    setTemplateDraft(fromTemplate ? {
      ...blank, vehicle: { ...blank.vehicle, make: fromTemplate.brand, model: fromTemplate.model },
      intervalMonths: String(fromTemplate.intervalMonths), intervalKm: String(fromTemplate.intervalKm),
      numberOfServices: String(fromTemplate.services.length), services: fromTemplate.services.map((item) => ({ ...item })),
      planSource: { origin: fromTemplate.origin, optionType: fromTemplate.origin, templateId: fromTemplate.id, manufacturerId: fromTemplate.manufacturerId, lockedPricing: fromTemplate.origin === "manufacturer" },
    } : null);
    setFormSession((value) => value + 1); setView("form"); setNotice(""); setError("");
  }
  function editPlan(plan) {
    const revising = plan.status === "quote";
    setEditingId(revising ? null : plan.id); setSupersedesQuoteId(revising ? plan.id : null); setTemplateDraft(plan.draft);
    setFormInitialStep(plan.currentStep ?? (revising ? 5 : 0)); setFormSession((value) => value + 1); setView("form"); setNotice(""); setError("");
  }
  function saveDraft(draft, step) {
    const saved = service.saveDraft(actor, draft, step, editingId, { supersedesQuoteId });
    setEditingId(saved.id); refresh(); setNotice("Draft saved. It remains shared across the authorised dealer group."); return saved;
  }
  function issueFromForm(draft, step) {
    const saved = service.saveDraft(actor, draft, step, editingId, { supersedesQuoteId });
    const issued = service.issueQuote(actor, saved.id);
    refresh(); setSelectedId(issued.id); setEditingId(null); setSupersedesQuoteId(null); setView("detail"); setNotice(`${issued.quoteRecord.number} issued.`);
  }
  function proceedFromForm(draft, step) {
    const saved = service.saveDraft(actor, draft, step, editingId, { supersedesQuoteId });
    const activationRecord = supersedesQuoteId ? service.issueQuote(actor, saved.id) : saved;
    refresh(); setSelectedId(activationRecord.id); setEditingId(activationRecord.id); setSupersedesQuoteId(null); setView("activation"); setNotice("");
  }
  function openRecord(id) {
    const plan = plans.find((item) => item.id === id);
    if (plan?.status === "draft") return editPlan(plan);
    setSelectedId(id); setView("detail"); setNotice(""); setError("");
  }
  function downloadQuote(plan, print = false) {
    try {
      const file = service.quotePdf(actor, plan.id);
      const url = URL.createObjectURL(new Blob([file.bytes], { type: file.mimeType }));
      if (print) { const popup = window.open(url, "_blank"); popup?.addEventListener("load", () => popup.print(), { once: true }); }
      else { const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.filename; anchor.click(); }
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (cause) { setError(cause.message); }
  }

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brandIcon">D</span><div>Dashub <small>DashPlan</small></div></div>
      <div className="sideLabel">WORKSPACE</div>
      <nav aria-label="Main navigation">{nav.filter(([id]) => !["admin", "finance"].includes(id) || isDashubAdmin(actor)).map(([id, icon, label]) => <button key={id} className={`navItem${view === id || id === "plans" && view === "detail" ? " active" : ""}`} onClick={() => navigate(id)}><span>{icon}</span>{label}</button>)}</nav>
      <div className="sidebarBottom"><span className="statusDot" /> BUILD-002 SANDBOX <small>Browser-local records · no live integrations</small></div>
    </aside>
    <section className="content" ref={contentRef}>
      <div className="topbar"><span>Dealer group workspace <b>/</b> Service Plans <b>/</b> {nav.find(([id]) => id === view)?.[2] ?? "Plan detail"}</span><label className="personaSelect">Sandbox persona <select aria-label="Sandbox persona" value={actorId} onChange={(event) => { setActorId(event.target.value); setView("dashboard"); setSelectedId(null); setNotice(""); setError(""); }}>{workspace?.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label></div>
      {notice && <div className="notice" role="status">{notice}</div>}
      {error && <div className="errorBox globalError" role="alert">{error}</div>}
      {!service || !workspace || !actor ? <div className="emptyState">Loading local workspace…</div> : <>
        {view === "dashboard" && <Dashboard actor={actor} plans={completedPlans} payouts={service.payouts(actor)} onNavigate={openDashboardTarget} onOpenPlan={openRecord} />}
        {view === "plans" && <PlansRegister key={planSession} plans={plans} initialFocus={planFocus} onOpen={openRecord} onCreate={() => startCreate()} canCreate={canCreateDealerPlan(actor)} />}
        {view === "detail" && selectedPlan && <PlanDetail key={selectedPlan.id} plan={selectedPlan} actor={actor} workspace={workspace} service={service} onAction={action} onBack={() => navigate("plans")} onEdit={() => editPlan(selectedPlan)} onActivation={() => setView("activation")} onDownload={() => downloadQuote(selectedPlan)} onPrint={() => downloadQuote(selectedPlan, true)} onClaim={() => openClaims(selectedPlan.id)} onInvoices={() => navigate("invoices")} />}
        {view === "form" && <PlanForm key={formSession} initialDraft={editingPlan?.draft ?? templateDraft} initialStep={formInitialStep} editing={Boolean(editingId)} findCustomers={(query) => service.customerMatches(actor, query)} getPlanOptions={(draft) => service.planOptions(actor, draft)} onLookupVehicle={(registration) => service.lookupVehicle(actor, registration)} onCancel={() => navigate("plans")} onSaveDraft={saveDraft} onIssueQuote={issueFromForm} onProceedActivation={proceedFromForm} />}
        {view === "activation" && selectedPlan && <ActivationFlow key={selectedPlan.id} plan={selectedPlan} actor={actor} onBack={() => navigate("plans")} onRecordSignature={(input) => activationAction(() => service.recordSignature(actor, selectedPlan.id, input), "Signature evidence recorded.")} onSetupPayment={() => activationAction(() => service.setupPaymentMethod(actor, selectedPlan.id), "Sandbox payment method set up.")} onActivate={() => activationAction(() => service.activate(actor, selectedPlan.id), "Service Plan activated.")} onViewPlan={() => setView("detail")} />}
        {view === "sales" && <SalesPerformance actor={actor} workspace={workspace} service={service} onOpenPlan={openRecord} />}
        {view === "claims" && <ClaimsArea key={claimSession} plans={completedPlans} workspace={workspace} actor={actor} service={service} onAction={action} onOpenPlan={openRecord} initialPlanId={selectedId} />}
        {view === "invoices" && <InvoicesArea key={invoiceSession} plans={completedPlans} actor={actor} service={service} onAction={action} onOpenPlan={openRecord} initialFilter={invoiceFilter} />}
        {view === "payouts" && <><PayoutsArea plans={completedPlans} payouts={service.payouts(actor)} workspace={workspace} actor={actor} service={service} onAction={action} onOpenPlan={openRecord} /><PayoutAdjustmentRegister adjustments={service.adjustments(actor)} payouts={service.payouts(actor)} onOpenPlan={openRecord} /></>}
        {view === "finance" && <FinanceArea key={financeSession} actor={actor} service={service} onOpenPlan={openPlan} initialKey={financeKey} />}
        {view === "templates" && <TemplatesArea templates={service.templates(actor)} workspace={workspace} actor={actor} service={service} onAction={action} onUseTemplate={startCreate} />}
        {view === "admin" && <AdminArea workspace={workspace} actor={actor} service={service} onAction={action} onOpenFinance={() => navigate("finance")} onOpenPlans={() => navigate("plans")} />}
      </>}
    </section>
  </main>;
}

function PlansRegister({ plans, initialFocus, onOpen, onCreate, canCreate }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("drafts");
  const [focus, setFocus] = useState(initialFocus);
  const statuses = [["drafts", "Drafts"], ["quotes", "Quotes"], ["active", "Active Plans"], ["completed", "Completed"], ["lost", "Lost / Cancelled"]];
  const filtered = plans.filter((plan) => (!focus || focus.ids.includes(plan.id)) && planRegisterCategory(plan) === status)
    .filter((plan) => { const vehicle = plan.quote?.vehicle ?? plan.draft?.vehicle ?? {}; return `${customerName(plan)} ${vehicle.registration ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""} ${plan.quoteRecord?.number ?? ""}`.toLowerCase().includes(search.toLowerCase()); });
  return <><header className="pageHeader"><div><p className="eyebrow">DASHPLAN REGISTER</p><h1>Plans</h1><p className="sub">Shared dealer-group drafts, quotes and Service Plans with tenant-scoped search.</p></div>{canCreate && <button className="primaryButton" onClick={onCreate}>＋ Create Service Plan</button>}</header><section className="panel">{focus && <div className="dashboardFilterNotice" role="status"><span>Showing: <strong>{focus.label}</strong></span><button type="button" className="textButton" onClick={() => setFocus(null)}>Show all plans</button></div>}<div className="registerFilters"><label className="field">Search plans<input placeholder="Customer, registration, vehicle or quote" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div><div className="registerTabs">{statuses.map(([value, label]) => <button key={value} className={status === value ? "active" : ""} onClick={() => setStatus(value)}>{label}<span>{plans.filter((plan) => planRegisterCategory(plan) === value).length}</span></button>)}</div><PlanList plans={filtered} onOpen={onOpen} /></section></>;
}

function PlanList({ plans, onOpen }) {
  if (!plans.length) return <div className="emptyState">No plans match this view.</div>;
  return <div className="planList">{plans.map((plan) => { const quote = plan.quote; const vehicle = quote?.vehicle ?? plan.draft?.vehicle ?? {}; return <button className="planRow" key={plan.id} onClick={() => onOpen(plan.id)}><span className={`planIcon ${plan.origin}`}>{plan.origin === "manufacturer" ? "M" : "D"}</span><span className="planMain"><strong>{customerName(plan)}</strong><small>{vehicle.registration || "No registration"} · {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle incomplete"} · {plan.quoteRecord?.number ?? (plan.status === "draft" ? `Draft · step ${(plan.currentStep ?? 0) + 1}` : plan.scenario ?? "Service Plan")}</small></span><span className="pill">{plan.quoteRecord?.status?.replaceAll("_", " ") ?? plan.status.replaceAll("_", " ")}</span><span className="planType">{plan.origin === "manufacturer" ? "Manufacturer · locked" : "Dealer"}</span><strong className="planValue">{quote ? formatMoney(quote.funding.totalCents) : "Incomplete"}</strong><span className="rowArrow">→</span></button>; })}</div>;
}
