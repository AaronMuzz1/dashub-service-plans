"use client";

import { useState } from "react";
import { CLAIM_FINANCIAL_STATUS, getEntitlements, getPlanFinancials } from "../../lib/domain/operations.js";
import { canClaimPlan, isDashubAdmin } from "../../lib/domain/permissions.js";
import { formatMoney, parseMoneyToCents } from "../../lib/domain/money.js";
import { daysBetween, todayLocalDate } from "../../lib/domain/dates.js";
import { displayDate } from "./QuoteSummary.jsx";

const customerName = (plan) => `${plan.quote.customer.firstName} ${plan.quote.customer.lastName}`;

export function ClaimsArea({ plans, workspace, actor, service, onAction, onOpenPlan, initialPlanId }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(initialPlanId ?? null);
  const [odometer, setOdometer] = useState("");
  const [roNumber, setRoNumber] = useState("");
  const [serviceDate, setServiceDate] = useState(todayLocalDate());
  const [completed, setCompleted] = useState(false);
  const [shortfallInput, setShortfallInput] = useState(() => {
    const initial = plans.find((plan) => plan.id === initialPlanId);
    return initial ? (getPlanFinancials(initial).nextServiceShortfallCents / 100).toFixed(2) : "";
  });
  const eligible = plans.filter((plan) => canClaimPlan(actor, plan, workspace) && getEntitlements(plan).some((item) => item.status === "pending"));
  const filtered = eligible.filter((plan) => `${customerName(plan)} ${plan.quote.vehicle.registration}`.toLowerCase().includes(search.toLowerCase()));
  const selected = eligible.find((plan) => plan.id === selectedId);
  const next = selected && getEntitlements(selected).find((item) => item.status === "pending");
  const financial = selected && getPlanFinancials(selected);
  const shortfall = financial?.nextServiceShortfallCents ?? 0;
  const earlyClaim = next && serviceDate && daysBetween(serviceDate, next.predictedDate) >= 30;
  function choose(plan) {
    setSelectedId(plan.id); setOdometer(""); setRoNumber(""); setServiceDate(todayLocalDate()); setCompleted(false);
    setShortfallInput((getPlanFinancials(plan).nextServiceShortfallCents / 100).toFixed(2));
  }
  function submit(event) {
    event.preventDefault();
    const updated = onAction(() => service.claim(actor, selected.id, {
      serviceNumber: next.number, currentOdometer: odometer, roNumber, serviceDate, completed,
      dealerCollectedShortfallCents: parseMoneyToCents(shortfallInput || "0"),
    }), (updated) => `Service ${next.number} claimed. SP PO ${updated.claims.at(-1).poNumber}${updated.claims.at(-1).earlyClaim ? " · Early Claim logged" : ""}.`);
    if (updated) {
      setOdometer(""); setRoNumber(""); setCompleted(false);
      setShortfallInput((getPlanFinancials(updated).nextServiceShortfallCents / 100).toFixed(2));
    }
  }
  return <><header className="pageHeader"><div><p className="eyebrow">SEQUENTIAL ENTITLEMENT</p><h1>Service claims</h1><p className="sub">Search an active plan by registration or customer, then claim its next unclaimed service.</p></div></header>
    <div className="queueGrid"><section className="panel"><label className="field">Search registration or customer<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Registration or name" /></label><div className="queueList">{filtered.map((plan) => <button key={plan.id} className={`queueItem${selectedId === plan.id ? " selected" : ""}`} onClick={() => choose(plan)}><strong>{plan.quote.vehicle.registration || "No registration"} · {customerName(plan)}</strong><span>{plan.scenario ?? "Active plan"} · {plan.quote.vehicle.make} {plan.quote.vehicle.model}</span></button>)}{!filtered.length && <p className="sub">No active, claimable plan matches the search.</p>}</div></section>
      <section className="panel">{selected && next ? <><div className="panelHeading"><div><h2>Next service: {next.name}</h2><p className="sub">{customerName(selected)} · {selected.quote.vehicle.registration}</p></div><button className="textButton" onClick={() => onOpenPlan(selected.id)}>Plan detail →</button></div><div className="compactStats"><div><span>Locked dealer value</span><strong>{formatMoney(next.grossCents)}</strong></div><div><span>Predicted due</span><strong>{displayDate(next.predictedDate)}</strong><small>{new Intl.NumberFormat("en-NZ").format(next.predictedKm)} km</small></div><div><span>Funding available</span><strong>{formatMoney(financial.cashAvailableCents)}</strong></div><div><span>Customer shortfall</span><strong>{formatMoney(shortfall)}</strong></div></div><form className="fieldGrid claimForm" onSubmit={submit}><label className="field">Current odometer · km<input type="number" min="0" step="1" value={odometer} onChange={(event) => setOdometer(event.target.value)} /></label><label className="field">RO number<input value={roNumber} onChange={(event) => setRoNumber(event.target.value)} /></label><label className="field">Service date<input type="date" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} /></label><label className="field">Dealer-collected shortfall · NZD<input type="number" min="0" step="0.01" value={shortfallInput} onChange={(event) => setShortfallInput(event.target.value)} /><small>Must equal the shortfall shown above; credited against the remaining contract.</small></label><label className="checkField"><input type="checkbox" checked={completed} onChange={(event) => setCompleted(event.target.checked)} /> Confirm service was completed</label><div className="fieldWide">{earlyClaim && <p className="earlyNotice"><span className="warningBadge">Early Claim</span> This service is 30+ days ahead of its predicted due date. It will be logged and may proceed.</p>}<p className="sub">A claim 30+ days before the predicted due date is flagged Early Claim and can proceed.</p><button className="primaryButton" type="submit">Complete claim and generate SP PO</button></div></form></> : <div className="emptyState">Select an active plan to review the next entitlement and claim requirements.</div>}</section></div></>;
}

export function InvoicesArea({ plans, actor, service, onAction, onOpenPlan }) {
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const rows = plans.flatMap((plan) => (plan.claims ?? []).map((claim) => ({ plan, claim })));
  const visible = rows.filter(({ claim }) => filter === "all" || claim.financialStatus === filter);
  const current = rows.find(({ plan, claim }) => `${plan.id}/${claim.id}` === selected);
  const canInvoice = isDashubAdmin(actor) || actor.permissions?.manageInvoices;
  function select(plan, claim) { setSelected(`${plan.id}/${claim.id}`); setInvoiceNumber(""); setAmount((claim.expectedCents / 100).toFixed(2)); setReason(""); }
  return <><header className="pageHeader"><div><p className="eyebrow">PO AND DEALER INVOICE</p><h1>Invoices</h1><p className="sub">Claims remain awaiting invoice until one is received. Matching tolerance is ±$0.05.</p></div></header><div className="filterRow">{[["all", "All"], ...Object.entries(CLAIM_FINANCIAL_STATUS)].map(([value, label]) => <button key={value} className={`filterButton${filter === value ? " active" : ""}`} onClick={() => setFilter(value)}>{label} ({value === "all" ? rows.length : rows.filter(({ claim }) => claim.financialStatus === value).length})</button>)}</div>
    <div className="queueGrid"><section className="panel"><div className="queueList">{visible.map(({ plan, claim }) => <button className={`queueItem${selected === `${plan.id}/${claim.id}` ? " selected" : ""}`} key={claim.id} onClick={() => select(plan, claim)}><strong>{claim.poNumber} · {formatMoney(claim.expectedCents)}</strong><span>{customerName(plan)} · {claim.roNumber} · {CLAIM_FINANCIAL_STATUS[claim.financialStatus]}</span></button>)}{!visible.length && <p className="sub">No claims in this status.</p>}</div></section><section className="panel">{current ? <><div className="panelHeading"><div><h2>{current.claim.poNumber}</h2><p className="sub">{customerName(current.plan)} · {current.claim.roNumber} · service {displayDate(current.claim.serviceDate)}</p></div><button className="textButton" onClick={() => onOpenPlan(current.plan.id)}>Plan detail →</button></div><div className="compactStats"><div><span>Expected dealer value</span><strong>{formatMoney(current.claim.expectedCents)}</strong></div><div><span>Invoice status</span><strong className="smallStat">{CLAIM_FINANCIAL_STATUS[current.claim.financialStatus]}</strong></div></div>{current.claim.invoice && <p className="sub">Invoice {current.claim.invoice.number}{current.claim.invoice.status === "void" && " · VOID"} · {formatMoney(current.claim.invoice.amountCents)} · received {displayDate(current.claim.invoice.receivedAt.slice(0, 10))}</p>}{canInvoice && current.claim.financialStatus === "awaiting_dealer_invoice" && <form className="inlineForm" onSubmit={(event) => { event.preventDefault(); onAction(() => service.receiveInvoice(actor, current.plan.id, current.claim.id, { invoiceNumber, amountCents: parseMoneyToCents(amount) }), "Inbound dealer invoice simulated and matched or queued for exception review."); }}><label>Invoice number<input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} /></label><label>Invoice amount · NZD<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><button className="primaryButton">Simulate inbound invoice</button></form>}{isDashubAdmin(actor) && current.claim.financialStatus === "exception" && <form className="inlineForm" onSubmit={(event) => { event.preventDefault(); onAction(() => service.resolveInvoice(actor, current.plan.id, current.claim.id, reason), "Invoice exception approved with an audit record."); }}><label>Exception review reason<input value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="secondaryButton">Approve exception</button></form>}</> : <div className="emptyState">Select a claim to simulate its dealer invoice or inspect its financial status.</div>}</section></div></>;
}

export function PayoutsArea({ plans, payouts, actor, service, onAction, onOpenPlan, workspace }) {
  const matched = plans.flatMap((plan) => (plan.claims ?? []).filter((claim) => claim.financialStatus === "invoice_matched"));
  const [selectedId, setSelectedId] = useState(null);
  const selected = payouts.find((item) => item.id === selectedId) ?? payouts[0];
  const company = (payout) => workspace.companies.find((item) => item.id === payout.dealerGroupId);
  const branch = (payout) => company(payout)?.branches.find((item) => item.id === payout.branchId)?.name ?? payout.branchId;
  return <><header className="pageHeader"><div><p className="eyebrow">WEEKLY CONSOLIDATION</p><h1>Dealer payouts</h1><p className="sub">Grouped by dealership branch. All schedule and paid actions are sandbox ledger changes only.</p></div>{isDashubAdmin(actor) && <button className="primaryButton" disabled={!matched.length} onClick={() => onAction(() => service.schedulePayouts(actor), "Matched invoices scheduled for the next weekly payout.")}>Schedule {matched.length} matched claim{matched.length === 1 ? "" : "s"}</button>}</header><div className="queueGrid"><section className="panel"><h2>Payout batches</h2><div className="queueList">{payouts.map((payout) => <button key={payout.id} className={`queueItem${selected?.id === payout.id ? " selected" : ""}`} onClick={() => setSelectedId(payout.id)}><strong>{company(payout)?.name} · {branch(payout)}</strong><span>{payout.id} · {displayDate(payout.weekEnding)} · {payout.status} · {formatMoney(payout.netCents)}</span></button>)}{!payouts.length && <p className="sub">No payout batches yet.</p>}</div></section><section className="panel">{selected ? <><div className="panelHeading"><div><h2>{company(selected)?.name} · {branch(selected)}</h2><p className="sub">{selected.id} · week ending {displayDate(selected.weekEnding)} · {selected.status}</p></div>{isDashubAdmin(actor) && selected.status === "scheduled" && <button className="secondaryButton" onClick={() => onAction(() => service.markPayoutPaid(actor, selected.id), "Sandbox payout marked paid; no money moved.")}>Mark paid in sandbox</button>}</div><div className="compactStats"><div><span>Gross</span><strong>{formatMoney(selected.grossCents)}</strong></div><div><span>Relevant fees</span><strong>{formatMoney(selected.feesCents)}</strong></div><div><span>Dealer adjustments</span><strong>{formatMoney(selected.adjustmentCents ?? 0)}</strong></div><div><span>Net payout</span><strong>{formatMoney(selected.netCents)}</strong></div></div><div className="tableScroll"><table><thead><tr><th>Claim</th><th>RO</th><th>Dealer invoice</th><th>SP PO</th><th>Gross</th><th>Dashub fee</th><th>Provider fee</th><th>Net</th></tr></thead><tbody>{selected.lines.map((line) => <tr key={line.claimId}><td><button className="textButton" onClick={() => onOpenPlan(line.planId)}>{line.claimId.slice(0, 8)}</button></td><td>{line.roNumber}</td><td>{line.invoiceNumber}</td><td>{line.poNumber}</td><td>{formatMoney(line.grossCents)}</td><td>{formatMoney(line.dashubFeeCents)}</td><td>{formatMoney(line.providerFeeCents)}</td><td>{formatMoney(line.netCents)}</td></tr>)}</tbody></table></div></> : <div className="emptyState">Select a payout batch to see its remittance lines.</div>}</section></div></>;
}
