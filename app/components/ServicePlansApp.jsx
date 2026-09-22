"use client";

import { useEffect, useState } from "react";
import { createLocalPlanRepository } from "../../lib/adapters/local-plan-repository.js";
import { createDemoPlans } from "../../lib/adapters/demo-data.js";
import { manualServiceSource } from "../../lib/adapters/manual-service-source.js";
import { createServicePlans } from "../../lib/application/service-plans.js";
import { formatMoney } from "../../lib/domain/money.js";
import { canCreateDealerPlan, canEditPlan, DEMO_ACTOR } from "../../lib/domain/permissions.js";
import PlanForm from "./PlanForm.jsx";
import QuoteSummary, { displayDate, Metric } from "./QuoteSummary.jsx";

export default function ServicePlansApp() {
  const [service, setService] = useState(null);
  const [plans, setPlans] = useState([]);
  const [view, setView] = useState("dashboard");
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [formSession, setFormSession] = useState(0);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const repository = createLocalPlanRepository(window.localStorage);
    repository.seed(createDemoPlans());
    const instance = createServicePlans({ repository, serviceSource: manualServiceSource });
    setService(instance);
    setPlans(instance.list(DEMO_ACTOR));
  }, []);

  const selectedPlan = plans.find((plan) => plan.id === selectedId);
  const editingPlan = plans.find((plan) => plan.id === editingId);
  const dealerCount = plans.filter((plan) => plan.origin === "dealer").length;
  const manufacturerCount = plans.filter((plan) => plan.origin === "manufacturer").length;
  const totalQuotedCents = plans.reduce((sum, plan) => sum + plan.quote.funding.totalCents, 0);

  function showDashboard() { setView("dashboard"); setNotice(""); }
  function showPlans() { setView("plans"); setNotice(""); }
  function startCreate() {
    if (!canCreateDealerPlan(DEMO_ACTOR)) return;
    setEditingId(null); setFormSession((value) => value + 1); setNotice(""); setView("form");
  }
  function openPlan(plan) { setSelectedId(plan.id); setView("detail"); setNotice(""); }
  function editPlan(plan) {
    if (!canEditPlan(DEMO_ACTOR, plan)) return;
    setEditingId(plan.id); setFormSession((value) => value + 1); setNotice(""); setView("form");
  }
  function savePlan(draft) {
    if (!service) throw new Error("Local plan storage is still loading.");
    const saved = service.saveDealerQuote(DEMO_ACTOR, draft, editingId);
    setPlans(service.list(DEMO_ACTOR)); setSelectedId(saved.id); setEditingId(null); setView("detail");
    setNotice("Quote saved locally in this browser. No contract or payment was created.");
  }

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brandIcon">D</span><div>Dashub <small>Service Plans</small></div></div>
      <div className="sideLabel">WORKSPACE</div>
      <nav aria-label="Main navigation">
        <button className={view === "dashboard" ? "navItem active" : "navItem"} onClick={showDashboard}><span>▦</span> Dashboard</button>
        <button className={view === "plans" || view === "detail" ? "navItem active" : "navItem"} onClick={showPlans}><span>▤</span> Plans</button>
        <button className={view === "form" ? "navItem active" : "navItem"} onClick={startCreate}><span>＋</span> Create plan</button>
      </nav>
      <div className="sidebarBottom"><span className="statusDot" /> BUILD-001 SANDBOX <small>Local quotes only · no live connections</small></div>
    </aside>
    <section className="content">
      <div className="topbar"><span>Dealer group workspace <b>/</b> Service Plans</span><span className="userBadge">SA</span></div>

      {view === "dashboard" && <>
        <header className="pageHeader"><div><p className="eyebrow">SERVICE PLANS · SANDBOX</p><h1>Plan workspace</h1><p className="sub">Build and review funded service plan quotes using local data.</p></div><button className="primaryButton" onClick={startCreate}>＋ Create plan</button></header>
        <section className="metricGrid"><Metric label="Dealer quotes" value={service ? dealerCount : "—"} note="Editable with dealer permissions" /><Metric label="Manufacturer examples" value={service ? manufacturerCount : "—"} note="Centrally locked" /><Metric label="Quoted plan value" value={service ? formatMoney(totalQuotedCents) : "—"} note="Sandbox value, not collected" /><Metric label="Live payments" value="0" note="Provider disconnected" /></section>
        <div className="mainGrid"><section className="panel"><div className="panelHeading"><div><h2>Recent plans</h2><p className="sub">Open a quote to review its service and collection schedule.</p></div><button className="textButton" onClick={showPlans}>View all →</button></div><PlanList plans={plans.slice(0, 5)} onOpen={openPlan} loading={!service} /></section>
          <section className="panel guidance"><span className="eyebrow">HOW A QUOTE IS BUILT</span><h2>Fund every service on time</h2><p className="sub">Service dates follow the earlier of the month or kilometre interval. The regular payment is sized against each service’s cumulative cost, with collections ending before the final service.</p><div className="guidanceRule"><b>01</b><span>Customer and vehicle</span></div><div className="guidanceRule"><b>02</b><span>Forecast and manual service pricing</span></div><div className="guidanceRule"><b>03</b><span>Payment schedule and quote review</span></div><button className="secondaryButton" onClick={startCreate}>Start a quote →</button></section></div>
      </>}

      {view === "plans" && <><header className="pageHeader"><div><p className="eyebrow">LOCAL PLAN REGISTER</p><h1>Plans</h1><p className="sub">Dealer quotes can be edited where permission allows. Manufacturer plans are locked.</p></div><button className="primaryButton" onClick={startCreate}>＋ Create plan</button></header><section className="panel"><PlanList plans={plans} onOpen={openPlan} loading={!service} /></section></>}

      {view === "detail" && selectedPlan && <><div className="backRow"><button className="backButton" onClick={showPlans}>← Plans</button><span className="pill">{selectedPlan.origin === "manufacturer" ? "Locked manufacturer plan" : "Dealer quote"}</span></div><header className="pageHeader"><div><p className="eyebrow">QUOTE {selectedPlan.id.slice(0, 8).toUpperCase()}</p><h1>Plan details</h1><p className="sub">Created {displayDate(selectedPlan.quote.quoteDate)} · {selectedPlan.origin === "dealer" ? "Dealer group wide" : "Central manufacturer economics"}</p></div>{canEditPlan(DEMO_ACTOR, selectedPlan) && <button className="primaryButton" onClick={() => editPlan(selectedPlan)}>Edit dealer plan</button>}</header>{notice && <div className="notice" role="status">{notice}</div>}<QuoteSummary quote={selectedPlan.quote} origin={selectedPlan.origin} showSchedule /><div className="sandboxNote">This is a sandbox quote. No customer agreement, charge, email, vehicle lookup or remote record has been created.</div></>}

      {view === "form" && <PlanForm key={formSession} initialDraft={editingPlan?.draft} editing={Boolean(editingId)} onCancel={showPlans} onSave={savePlan} />}
    </section>
  </main>;
}

function PlanList({ plans, onOpen, loading = false }) {
  if (loading) return <div className="emptyState">Loading local quotes…</div>;
  if (!plans.length) return <div className="emptyState">No local quotes yet. Create a plan to get started.</div>;
  return <div className="planList">{plans.map((plan) => <button className="planRow" key={plan.id} onClick={() => onOpen(plan)}><span className={`planIcon ${plan.origin}`}>{plan.origin === "manufacturer" ? "M" : "D"}</span><span className="planMain"><strong>{plan.quote.customer.firstName} {plan.quote.customer.lastName}</strong><small>{plan.quote.vehicle.year} {plan.quote.vehicle.make} {plan.quote.vehicle.model} · {plan.quote.numberOfServices} services</small></span><span className="planType">{plan.origin === "manufacturer" ? "Manufacturer · locked" : "Dealer · editable"}</span><strong className="planValue">{formatMoney(plan.quote.funding.totalCents)}</strong><span className="rowArrow">→</span></button>)}</div>;
}
