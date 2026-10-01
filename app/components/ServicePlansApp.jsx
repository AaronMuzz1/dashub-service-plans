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

const nav = [
  ["dashboard", "▦", "Dashboard"], ["plans", "▤", "Plans"], ["form", "＋", "Create plan"],
  ["claims", "✓", "Claims"], ["invoices", "▧", "Invoices"], ["payouts", "↗", "Dealer payouts"],
  ["finance", "◫", "Finance"], ["templates", "◈", "Plan templates"], ["admin", "⚙", "Dashub Admin"],
];
const customerName = (plan) => `${plan.quote.customer.firstName} ${plan.quote.customer.lastName}`;

export default function ServicePlansApp() {
  const contentRef = useRef(null);
  const [service, setService] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [actorId, setActorId] = useState("dashub-admin");
  const [view, setView] = useState("dashboard");
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [templateDraft, setTemplateDraft] = useState(null);
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
  function openPlan(id) { setSelectedId(id); navigate("detail"); }
  function openClaims(id) { setSelectedId(id); setClaimSession((value) => value + 1); setView("claims"); setNotice(""); setError(""); }
  function startCreate(fromTemplate = null) {
    if (!canCreateDealerPlan(actor)) { setError("This persona cannot create priced dealer plans."); return; }
    setEditingId(null);
    const blank = newDraft();
    setTemplateDraft(fromTemplate ? {
      ...blank, vehicle: { ...blank.vehicle, make: fromTemplate.brand, model: fromTemplate.model },
      intervalMonths: String(fromTemplate.intervalMonths), intervalKm: String(fromTemplate.intervalKm),
      numberOfServices: String(fromTemplate.services.length), services: fromTemplate.services.map((item) => ({ ...item })),
    } : null);
    setFormSession((value) => value + 1); setView("form"); setNotice(""); setError("");
  }
  function editPlan(plan) { setEditingId(plan.id); setTemplateDraft(null); setFormSession((value) => value + 1); setView("form"); setNotice(""); setError(""); }
  function savePlan(draft) {
    const saved = service.saveDealerQuote(actor, draft, editingId);
    refresh(); setSelectedId(saved.id); setEditingId(null); setTemplateDraft(null); setView("detail");
    setNotice("Quote saved locally. Activate it to create a sandbox contract and terms snapshot.");
  }

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brandIcon">D</span><div>Dashub <small>Service Plans</small></div></div>
      <div className="sideLabel">WORKSPACE</div>
      <nav aria-label="Main navigation">{nav.filter(([id]) => !["admin", "finance"].includes(id) || isDashubAdmin(actor)).map(([id, icon, label]) => <button key={id} className={`navItem${view === id || id === "plans" && view === "detail" ? " active" : ""}`} onClick={() => navigate(id)}><span>{icon}</span>{label}</button>)}</nav>
      <div className="sidebarBottom"><span className="statusDot" /> BUILD-001 SANDBOX <small>Browser-local records · no live services</small></div>
    </aside>
    <section className="content" ref={contentRef}>
      <div className="topbar"><span>Dealer group workspace <b>/</b> Service Plans <b>/</b> {nav.find(([id]) => id === view)?.[2] ?? "Plan detail"}</span><label className="personaSelect">Sandbox persona <select aria-label="Sandbox persona" value={actorId} onChange={(event) => { setActorId(event.target.value); setView("dashboard"); setSelectedId(null); setNotice(""); setError(""); }}>{workspace?.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label></div>
      {notice && <div className="notice" role="status">{notice}</div>}
      {error && <div className="errorBox globalError" role="alert">{error}</div>}
      {!service || !workspace || !actor ? <div className="emptyState">Loading local workspace…</div> : <>
        {view === "dashboard" && <Dashboard actor={actor} plans={plans} payouts={service.payouts(actor)} onNavigate={openDashboardTarget} onOpenPlan={openPlan} />}
        {view === "plans" && <PlansRegister key={planSession} plans={plans} initialFocus={planFocus} onOpen={openPlan} onCreate={() => startCreate()} canCreate={canCreateDealerPlan(actor)} />}
        {view === "detail" && selectedPlan && <PlanDetail key={selectedPlan.id} plan={selectedPlan} actor={actor} workspace={workspace} service={service} onAction={action} onBack={() => navigate("plans")} onEdit={() => editPlan(selectedPlan)} onClaim={() => openClaims(selectedPlan.id)} onInvoices={() => navigate("invoices")} />}
        {view === "form" && <PlanForm key={formSession} initialDraft={editingPlan?.draft ?? templateDraft} editing={Boolean(editingId)} onCancel={() => navigate("plans")} onSave={savePlan} />}
        {view === "claims" && <ClaimsArea key={claimSession} plans={plans} workspace={workspace} actor={actor} service={service} onAction={action} onOpenPlan={openPlan} initialPlanId={selectedId} />}
        {view === "invoices" && <InvoicesArea key={invoiceSession} plans={plans} actor={actor} service={service} onAction={action} onOpenPlan={openPlan} initialFilter={invoiceFilter} />}
        {view === "payouts" && <><PayoutsArea plans={plans} payouts={service.payouts(actor)} workspace={workspace} actor={actor} service={service} onAction={action} onOpenPlan={openPlan} /><PayoutAdjustmentRegister adjustments={service.adjustments(actor)} payouts={service.payouts(actor)} onOpenPlan={openPlan} /></>}
        {view === "finance" && <FinanceArea key={financeSession} actor={actor} service={service} onOpenPlan={openPlan} initialKey={financeKey} />}
        {view === "templates" && <TemplatesArea templates={service.templates(actor)} workspace={workspace} actor={actor} service={service} onAction={action} onUseTemplate={startCreate} />}
        {view === "admin" && <AdminArea workspace={workspace} actor={actor} service={service} onAction={action} onOpenFinance={() => navigate("finance")} onOpenPlans={() => navigate("plans")} />}
      </>}
    </section>
  </main>;
}

function PlansRegister({ plans, initialFocus, onOpen, onCreate, canCreate }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [focus, setFocus] = useState(initialFocus);
  const statuses = ["all", "quote", "active", "completed", "cancelled"];
  const filtered = plans.filter((plan) => (!focus || focus.ids.includes(plan.id)) && (status === "all" || plan.status === status)
    && `${customerName(plan)} ${plan.quote.vehicle.registration} ${plan.quote.vehicle.make} ${plan.quote.vehicle.model}`.toLowerCase().includes(search.toLowerCase()));
  return <><header className="pageHeader"><div><p className="eyebrow">PLAN REGISTER</p><h1>Plans</h1><p className="sub">Search customer or registration and filter by lifecycle status.</p></div>{canCreate && <button className="primaryButton" onClick={onCreate}>＋ Create plan</button>}</header><section className="panel">{focus && <div className="dashboardFilterNotice" role="status"><span>Showing: <strong>{focus.label}</strong></span><button type="button" className="textButton" onClick={() => setFocus(null)}>Show all plans</button></div>}<div className="registerFilters"><label className="field">Search plans<input placeholder="Customer, registration or vehicle" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="filterRow">{statuses.map((item) => <button key={item} className={`filterButton${status === item ? " active" : ""}`} onClick={() => setStatus(item)}>{item === "all" ? "All" : item[0].toUpperCase() + item.slice(1)} ({item === "all" ? plans.length : plans.filter((plan) => plan.status === item).length})</button>)}</div></div><PlanList plans={filtered} onOpen={onOpen} /></section></>;
}

function PlanList({ plans, onOpen }) {
  if (!plans.length) return <div className="emptyState">No plans match this view.</div>;
  return <div className="planList">{plans.map((plan) => <button className="planRow" key={plan.id} onClick={() => onOpen(plan.id)}><span className={`planIcon ${plan.origin}`}>{plan.origin === "manufacturer" ? "M" : "D"}</span><span className="planMain"><strong>{customerName(plan)}</strong><small>{plan.quote.vehicle.registration || "No registration"} · {plan.quote.vehicle.year} {plan.quote.vehicle.make} {plan.quote.vehicle.model} · {plan.scenario ?? `${plan.quote.numberOfServices} services`}</small></span><span className="pill">{plan.status}</span><span className="planType">{plan.origin === "manufacturer" ? "Manufacturer · locked" : "Dealer"}</span><strong className="planValue">{formatMoney(plan.quote.funding.totalCents)}</strong><span className="rowArrow">→</span></button>)}</div>;
}
