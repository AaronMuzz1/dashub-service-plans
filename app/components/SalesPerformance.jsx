"use client";

import { useMemo, useState } from "react";
import { todayLocalDate } from "../../lib/domain/dates.js";
import { displayDate } from "./QuoteSummary.jsx";

const presets = [["current_month", "Current Month"], ["previous_month", "Previous Month"], ["quarter", "Quarter"], ["year", "Year"], ["custom", "Custom Date Range"]];
const metricLabels = {
  quotesIssued: "Quotes issued", plansSold: "Plans sold", directSales: "Direct sales", quoteConversionPercentage: "Quote conversion",
  outstandingQuotes: "Outstanding quotes", lostQuotes: "Lost quotes", quoteExpiry: "Quote expiry", followUpsDue: "Follow-ups due",
  followUpsCompleted: "Follow-ups completed", followUpsOverdue: "Follow-ups overdue", convertedFollowingFollowUp: "Converted after follow-up",
};

function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function Comparison({ title, rows }) {
  return <section className="panel comparisonPanel"><h2>{title}</h2>{rows.length ? <div className="comparisonList">{rows.map((row) => <div key={row.label}><span>{row.label}</span><strong>{row.value}</strong><i style={{ width: `${Math.max(5, row.value / Math.max(...rows.map((item) => item.value)) * 100)}%` }} /></div>)}</div> : <p className="emptyState">No activity in this period.</p>}</section>;
}

export default function SalesPerformance({ actor, workspace, service, onOpenPlan }) {
  const [filters, setFilters] = useState({ preset: "current_month", scope: "dealer_group", custom: { start: todayLocalDate().slice(0, 8) + "01", end: todayLocalDate() } });
  const [drill, setDrill] = useState("all");
  const report = useMemo(() => service.salesPerformance(actor, filters, todayLocalDate()), [service, actor, filters]);
  const advisors = workspace.users.filter((user) => ["advisor", "manager"].includes(user.role) && (actor.role === "dashub_admin" || user.dealerGroupId === actor.dealerGroupId));
  const company = workspace.companies.find((item) => item.id === actor.dealerGroupId);
  const branchOptions = (actor.role === "dashub_admin" ? workspace.companies : [company]).filter(Boolean).flatMap((item) => item.branches.map((branch) => ({ ...branch, companyName: item.name })));
  const rows = report.rows.filter((row) => drill === "all"
    || drill === "quotesIssued" && row.recordType === "Quote"
    || drill === "plansSold" && row.recordType === "Sale"
    || drill === "directSales" && row.directSale
    || drill === "quoteConversionPercentage" && row.recordType === "Quote"
    || drill === "outstandingQuotes" && row.recordType === "Quote" && row.status === "outstanding"
    || drill === "lostQuotes" && row.recordType === "Quote" && ["lost", "expired"].includes(row.status)
    || drill === "quoteExpiry" && row.recordType === "Quote" && row.status === "expired"
    || drill === "followUpsCompleted" && row.recordType === "Follow-up" && row.status === "completed"
    || drill === "followUpsDue" && row.recordType === "Follow-up" && row.status === "due"
    || drill === "followUpsOverdue" && row.recordType === "Follow-up" && row.status === "overdue"
    || drill === "convertedFollowingFollowUp" && row.recordType === "Sale" && row.followingFollowUp);
  function set(key, value) { setFilters((old) => ({ ...old, [key]: value })); }
  function exportExcel() { const result = service.salesExcel(actor, filters, todayLocalDate()); download(result.content, result.filename, result.mimeType); }
  return <><header className="pageHeader"><div><p className="eyebrow">DASHPLAN · SALES PERFORMANCE</p><h1>Sales Performance</h1><p className="sub">Quote, conversion, follow-up and sales activity. Sandbox records are clearly identified and no operational totals are fabricated.</p></div><button className="secondaryButton" onClick={exportExcel}>Export filtered Excel</button></header>
    <section className="panel performanceFilters"><div className="scopeToggle"><button className={filters.scope === "dealer_group" ? "active" : ""} onClick={() => set("scope", "dealer_group")}>Dealer Group</button><button className={filters.scope === "branch" ? "active" : ""} onClick={() => set("scope", "branch")}>Branch</button></div><label>Period<select value={filters.preset} onChange={(event) => set("preset", event.target.value)}>{presets.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>{filters.preset === "custom" && <><label>From<input type="date" value={filters.custom.start} onChange={(event) => set("custom", { ...filters.custom, start: event.target.value })} /></label><label>To<input type="date" value={filters.custom.end} onChange={(event) => set("custom", { ...filters.custom, end: event.target.value })} /></label></>}{actor.role === "dashub_admin" && <label>Dealer group<select value={filters.dealerGroupId ?? ""} onChange={(event) => setFilters((old) => ({ ...old, dealerGroupId: event.target.value, branchId: "", advisorId: "" }))}><option value="">All dealer groups</option>{workspace.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<label>Advisor<select value={filters.advisorId ?? ""} onChange={(event) => set("advisorId", event.target.value)}><option value="">All Advisors</option>{advisors.filter((user) => !filters.dealerGroupId || user.dealerGroupId === filters.dealerGroupId).map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select></label><label>Branch<select value={filters.branchId ?? ""} onChange={(event) => set("branchId", event.target.value)}><option value="">All branches</option>{branchOptions.filter((branch) => !filters.dealerGroupId || workspace.companies.find((item) => item.id === filters.dealerGroupId)?.branches.some((item) => item.id === branch.id)).map((branch) => <option value={branch.id} key={branch.id}>{actor.role === "dashub_admin" ? `${branch.companyName} · ${branch.name}` : branch.name}</option>)}</select></label><label>Plan type<select value={filters.planType ?? ""} onChange={(event) => set("planType", event.target.value)}><option value="">All plan types</option><option value="dealer">Dealer</option><option value="manufacturer">Manufacturer</option></select></label><label>Brand<input value={filters.brand ?? ""} onChange={(event) => set("brand", event.target.value)} placeholder="All brands" /></label><label>Model<input value={filters.model ?? ""} onChange={(event) => set("model", event.target.value)} placeholder="All models" /></label></section>
    <div className="performanceMetrics">{Object.entries(metricLabels).map(([key, label]) => <button key={key} className={`dashboardMetric${drill === key ? " active" : ""}`} onClick={() => setDrill(key)}><span>{label}</span><strong>{key === "quoteConversionPercentage" ? `${report.summary[key]}%` : report.summary[key]}</strong><small>{key in report.previousSummary ? `Previous equivalent: ${report.previousSummary[key]}` : `${displayDate(report.range.start)} – ${displayDate(report.range.end)}`}</small><i>→</i></button>)}</div>
    <section className="panel sectionGap"><div className="panelHeading"><div><h2>Advisor leaderboard</h2><p className="sub">Plans Sold and Quotes Issued rankings include eligible zero-activity Advisors and Managers. No dollar ranking or targets.</p></div><span className="pill">Dealer Group default</span></div><div className="tableScroll"><table><thead><tr><th>Sold rank</th><th>Advisor</th><th>Plans sold</th><th>Quote rank</th><th>Quotes issued</th><th>Assigned cohort</th><th>Converted</th><th>Conversion</th></tr></thead><tbody>{report.leaderboard.map((row) => <tr key={row.advisorId} className={row.advisorId === actor.id ? "ownRow" : ""}><td>#{row.soldRank}</td><td><strong>{row.name}</strong><small>{row.role}{row.advisorId === actor.id ? " · You" : ""}</small></td><td>{row.plansSold}</td><td>#{row.quoteRank}</td><td>{row.quotesIssued}</td><td>{row.assignedQuotes}</td><td>{row.convertedAssigned}</td><td>{row.conversionRate}%</td></tr>)}</tbody></table></div></section>
    <div className="comparisonGrid sectionGap"><Comparison title="Branch comparison" rows={report.breakdowns.branches} /><Comparison title="Vehicle brand comparison" rows={report.breakdowns.brands} /><Comparison title="Model drill-down" rows={report.breakdowns.models} /><Comparison title="Monthly quote and sales trend" rows={report.breakdowns.months} /><Comparison title="Lost quote reasons" rows={report.breakdowns.lostReasons} /></div>
    <section className="panel sectionGap"><div className="panelHeading"><div><h2>Underlying records</h2><p className="sub">{drill === "all" ? "Currently filtered quote, sale and follow-up history" : metricLabels[drill] ?? "Currently filtered records"}. Access remains within authorised tenant boundaries.</p></div>{drill !== "all" && <button className="textButton" onClick={() => setDrill("all")}>Show all</button>}</div><div className="tableScroll"><table><thead><tr><th>Type</th><th>Date</th><th>Quote</th><th>Customer</th><th>Vehicle</th><th>Status / outcome</th><th>Action</th></tr></thead><tbody>{rows.length ? rows.map((row, index) => <tr key={`${row.recordType}-${row.id}-${index}`}><td>{row.recordType}{row.directSale ? " · Direct" : ""}</td><td>{displayDate(row.date)}</td><td>{row.number}</td><td>{row.customer}</td><td>{row.brand} {row.model}</td><td>{row.followUpOutcome ?? row.status.replaceAll("_", " ")}</td><td><button className="textButton" onClick={() => onOpenPlan(row.id)}>View record</button></td></tr>) : <tr><td colSpan="7">No records match the current filters.</td></tr>}</tbody></table></div></section>
  </>;
}
