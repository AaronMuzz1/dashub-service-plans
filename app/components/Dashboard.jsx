import { buildDashboardOverview } from "../../lib/domain/dashboard.js";
import { todayLocalDate } from "../../lib/domain/dates.js";
import { formatMoney } from "../../lib/domain/money.js";
import { displayDate } from "./QuoteSummary.jsx";

function DashboardMetric({ metric, onNavigate }) {
  const content = <><span>{metric.label}</span><strong>{metric.format === "money" ? formatMoney(metric.value) : metric.value}</strong><small>{metric.note}</small>{metric.target && <i aria-hidden="true">→</i>}</>;
  return metric.target
    ? <button type="button" className="dashboardMetric" onClick={() => onNavigate(metric.target)}>{content}</button>
    : <article className="dashboardMetric">{content}</article>;
}

function PrimaryActions({ actions, onNavigate }) {
  if (!actions.length) return null;
  return <section className="dashboardActions" aria-label="Primary actions">{actions.map((action) => <button type="button" className="dashboardAction" key={action.id} onClick={() => onNavigate(action.target)}><span className="dashboardActionIcon" aria-hidden="true">{action.icon}</span><span><strong>{action.label}</strong><small>{action.detail}</small></span><i aria-hidden="true">→</i></button>)}</section>;
}

function NeedsAttention({ items, onNavigate }) {
  return <section className="panel attentionPanel"><div className="panelHeading"><div><p className="eyebrow">OPERATIONS</p><h2>Needs Attention</h2><p className="sub">Items that may need action or review.</p></div></div>
    {items.length ? <div className="attentionList">{items.map((item) => <button type="button" className={`attentionItem ${item.tone}`} key={item.id} onClick={() => onNavigate(item.target)}><span className="attentionMarker" aria-hidden="true" /><span className="attentionBody"><strong>{item.title}</strong><small>{item.detail}{item.date ? ` · ${displayDate(item.date)}` : ""}{item.amountCents ? ` · ${formatMoney(item.amountCents)} projected shortfall` : ""}</small></span><span className="attentionCount">{item.count}</span><span className="rowArrow" aria-hidden="true">→</span></button>)}</div>
      : <div className="attentionEmpty"><span aria-hidden="true">✓</span><div><strong>Nothing needs attention</strong><small>No current exceptions for this role.</small></div></div>}
  </section>;
}

function RecentPlans({ plans, onOpenPlan, onViewAll }) {
  return <section className="panel recentPlansPanel"><div className="panelHeading"><div><h2>Recent Plans</h2><p className="sub">Most recently updated plans in your scope.</p></div><button type="button" className="textButton" onClick={onViewAll}>View all →</button></div>
    {plans.length ? <div className="dashboardPlanList">{plans.map((plan) => <button type="button" className="dashboardPlanRow" key={plan.id} onClick={() => onOpenPlan(plan.id)}><span className={`planIcon ${plan.origin}`}>{plan.origin === "manufacturer" ? "M" : "D"}</span><span className="dashboardPlanMain"><strong>{plan.customerName}</strong><span>{plan.vehicleLabel}</span><small><b>{plan.status}</b> · {plan.originLabel} · {plan.serviceCount} service{plan.serviceCount === 1 ? "" : "s"}</small></span><strong className="dashboardPlanValue">{formatMoney(plan.totalCents)}</strong><span className="rowArrow" aria-hidden="true">→</span></button>)}</div>
      : <div className="emptyState">No plans are available in this view.</div>}
  </section>;
}

export default function Dashboard({ actor, plans, payouts, onNavigate, onOpenPlan }) {
  const model = buildDashboardOverview({ actor, plans, payouts, today: todayLocalDate() });
  return <div className={`dashboard dashboard-${model.role}`} data-dashboard-role={model.role}>
    <header className="pageHeader dashboardHeader"><div><p className="eyebrow">SERVICE PLANS</p><h1>Dashboard</h1><p className="sub">{model.description}</p></div></header>
    <PrimaryActions actions={model.actions} onNavigate={onNavigate} />
    <div className="dashboardMetricSections">{model.metricGroups.map((group) => <section className="dashboardMetricSection" key={group.id} aria-labelledby={`dashboard-${group.id}`}><h2 id={`dashboard-${group.id}`}>{group.label}</h2><div className="dashboardMetricGrid">{group.metrics.map((metric) => <DashboardMetric key={metric.id} metric={metric} onNavigate={onNavigate} />)}</div></section>)}</div>
    <div className="dashboardMainGrid"><NeedsAttention items={model.attention} onNavigate={onNavigate} /><RecentPlans plans={model.recentPlans} onOpenPlan={onOpenPlan} onViewAll={() => onNavigate({ view: "plans" })} /></div>
  </div>;
}
