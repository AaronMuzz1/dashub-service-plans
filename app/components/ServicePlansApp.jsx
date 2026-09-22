"use client";

import { useEffect, useState } from "react";
import { createLocalPlanRepository } from "../../lib/adapters/local-plan-repository.js";
import { createDemoWorkspace } from "../../lib/adapters/demo-data.js";
import { manualServiceSource } from "../../lib/adapters/manual-service-source.js";
import { createServicePlans } from "../../lib/application/service-plans.js";
import { formatMoney } from "../../lib/domain/money.js";
import { canCreateDealerPlan, isDashubAdmin } from "../../lib/domain/permissions.js";
import { getPlanFinancials } from "../../lib/domain/operations.js";
import PlanForm, { newDraft } from "./PlanForm.jsx";
import PlanDetail from "./PlanDetail.jsx";
import { ClaimsArea, InvoicesArea, PayoutsArea } from "./WorkQueues.jsx";
import { AdminArea, FinanceArea, TemplatesArea } from "./ManagementAreas.jsx";
import { Metric } from "./QuoteSummary.jsx";

const nav = [
  ["dashboard", "▦", "Dashboard"], ["plans", "▤", "Plans"], ["form", "＋", "Create plan"],
  ["claims", "✓", "Claims"], ["invoices", "▧", "Invoices"], ["payouts", "↗", "Dealer payouts"],
  ["finance", "◫", "Finance"], ["templates", "◈", "Plan templates"], ["admin", "⚙", "Dashub Admin"],
];
const customerName = (plan) => `${plan.quote.customer.firstName} ${plan.quote.customer.lastName}`;

export default function ServicePlansApp() {
  const [service, setService] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [actorId, setActorId] = useState("dashub-admin");
  const [view, setView] = useState("dashboard");
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [templateDraft, setTemplateDraft] = useState(null);
  const [formSession, setFormSession] = useState(0);
  const [claimSession, setClaimSession] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const repository = createLocalPlanRepository(window.localStorage);
    repository.seed(createDemoWorkspace());
    const instance = createServicePlans({ repository, serviceSource: manualServiceSource });
    setService(instance); setWorkspace(instance.workspace());
  }, []);

  const actor = workspace?.users.find((user) => user.id === actorId);
  const plans = service && actor ? service.list(actor) : [];
  const selectedPlan = plans.find((plan) => plan.id === selectedId);
  const editingPlan = plans.find((plan) => plan.id === editingId);
  const claimCount = plans.reduce((count, plan) => count + (plan.claims?.length ?? 0), 0);
  const collected = plans.reduce((sum, plan) => sum + getPlanFinancials(plan).customerCollectedCents, 0);

  function navigate(next) {
    if (next === "form") return startCreate();
    if (["admin", "finance"].includes(next) && !isDashubAdmin(actor)) return;
    setView(next); setNotice(""); setError("");
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
  function openClaims(id) { setSelectedId(id); setClaimSession((value) => value + 1); navigate("claims"); }
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
    <section className="content">
      <div className="topbar"><span>Dealer group workspace <b>/</b> Service Plans <b>/</b> {nav.find(([id]) => id === view)?.[2] ?? "Plan detail"}</span><label className="personaSelect">Sandbox persona <select aria-label="Sandbox persona" value={actorId} onChange={(event) => { setActorId(event.target.value); setView("dashboard"); setSelectedId(null); setNotice(""); setError(""); }}>{workspace?.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label></div>
      {notice && <div className="notice" role="status">{notice}</div>}
      {error && <div className="errorBox globalError" role="alert">{error}</div>}
      {!service || !workspace || !actor ? <div className="emptyState">Loading local workspace…</div> : <>
        {view === "dashboard" && <><header className="pageHeader"><div><p className="eyebrow">SERVICE PLANS · SANDBOX</p><h1>Plan workspace</h1><p className="sub">Explore the quote, claim and financial lifecycle with local, simulated records.</p></div>{canCreateDealerPlan(actor) && <button className="primaryButton" onClick={() => startCreate()}>＋ Create plan</button>}</header>
          <section className="metricGrid"><Metric label="Visible plans" value={plans.length} note="Dealer group scope and manufacturer access" /><Metric label="Active contracts" value={plans.filter((plan) => plan.status === "active").length} note="Service entitlements in progress" /><Metric label="Customer collections" value={formatMoney(collected)} note="Simulated local ledger" /><Metric label="Service claims" value={claimCount} note="PO and invoice lifecycle" /></section>
          <div className="mainGrid"><section className="panel"><div className="panelHeading"><div><h2>Recent plans</h2><p className="sub">Representative scenarios are seeded for hands-on review.</p></div><button className="textButton" onClick={() => navigate("plans")}>View all →</button></div><PlanList plans={plans.slice(0, 6)} onOpen={openPlan} /></section><section className="panel guidance"><span className="eyebrow">OPERATIONS</span><h2>Continue the journey</h2><p className="sub">Claim the next entitlement, match an invoice and review the weekly payout. Every action stays in this browser.</p><div className="guidanceRule"><b>01</b><button className="textButton" onClick={() => navigate("claims")}>Service claims →</button></div><div className="guidanceRule"><b>02</b><button className="textButton" onClick={() => navigate("invoices")}>Invoice queue →</button></div>{isDashubAdmin(actor) && <div className="guidanceRule"><b>03</b><button className="textButton" onClick={() => navigate("finance")}>Financial drilldowns →</button></div>}</section></div></>}
        {view === "plans" && <PlansRegister plans={plans} onOpen={openPlan} onCreate={() => startCreate()} canCreate={canCreateDealerPlan(actor)} />}
        {view === "detail" && selectedPlan && <PlanDetail key={selectedPlan.id} plan={selectedPlan} actor={actor} workspace={workspace} service={service} onAction={action} onBack={() => navigate("plans")} onEdit={() => editPlan(selectedPlan)} onClaim={() => openClaims(selectedPlan.id)} onInvoices={() => navigate("invoices")} />}
        {view === "form" && <PlanForm key={formSession} initialDraft={editingPlan?.draft ?? templateDraft} editing={Boolean(editingId)} onCancel={() => navigate("plans")} onSave={savePlan} />}
        {view === "claims" && <ClaimsArea key={claimSession} plans={plans} workspace={workspace} actor={actor} service={service} onAction={action} onOpenPlan={openPlan} initialPlanId={selectedId} />}
        {view === "invoices" && <InvoicesArea plans={plans} actor={actor} service={service} onAction={action} onOpenPlan={openPlan} />}
        {view === "payouts" && <PayoutsArea plans={plans} payouts={service.payouts(actor)} workspace={workspace} actor={actor} service={service} onAction={action} onOpenPlan={openPlan} />}
        {view === "finance" && <FinanceArea actor={actor} service={service} onOpenPlan={openPlan} />}
        {view === "templates" && <TemplatesArea templates={service.templates(actor)} workspace={workspace} actor={actor} service={service} onAction={action} onUseTemplate={startCreate} />}
        {view === "admin" && <AdminArea workspace={workspace} actor={actor} service={service} onAction={action} onOpenFinance={() => navigate("finance")} onOpenPlans={() => navigate("plans")} />}
      </>}
    </section>
  </main>;
}

function PlansRegister({ plans, onOpen, onCreate, canCreate }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const statuses = ["all", "quote", "active", "completed", "cancelled"];
  const filtered = plans.filter((plan) => (status === "all" || plan.status === status)
    && `${customerName(plan)} ${plan.quote.vehicle.registration} ${plan.quote.vehicle.make} ${plan.quote.vehicle.model}`.toLowerCase().includes(search.toLowerCase()));
  return <><header className="pageHeader"><div><p className="eyebrow">PLAN REGISTER</p><h1>Plans</h1><p className="sub">Search customer or registration and filter by lifecycle status.</p></div>{canCreate && <button className="primaryButton" onClick={onCreate}>＋ Create plan</button>}</header><section className="panel"><div className="registerFilters"><label className="field">Search plans<input placeholder="Customer, registration or vehicle" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="filterRow">{statuses.map((item) => <button key={item} className={`filterButton${status === item ? " active" : ""}`} onClick={() => setStatus(item)}>{item === "all" ? "All" : item[0].toUpperCase() + item.slice(1)} ({item === "all" ? plans.length : plans.filter((plan) => plan.status === item).length})</button>)}</div></div><PlanList plans={filtered} onOpen={onOpen} /></section></>;
}

function PlanList({ plans, onOpen }) {
  if (!plans.length) return <div className="emptyState">No plans match this view.</div>;
  return <div className="planList">{plans.map((plan) => <button className="planRow" key={plan.id} onClick={() => onOpen(plan.id)}><span className={`planIcon ${plan.origin}`}>{plan.origin === "manufacturer" ? "M" : "D"}</span><span className="planMain"><strong>{customerName(plan)}</strong><small>{plan.quote.vehicle.registration || "No registration"} · {plan.quote.vehicle.year} {plan.quote.vehicle.make} {plan.quote.vehicle.model} · {plan.scenario ?? `${plan.quote.numberOfServices} services`}</small></span><span className="pill">{plan.status}</span><span className="planType">{plan.origin === "manufacturer" ? "Manufacturer · locked" : "Dealer"}</span><strong className="planValue">{formatMoney(plan.quote.funding.totalCents)}</strong><span className="rowArrow">→</span></button>)}</div>;
}
