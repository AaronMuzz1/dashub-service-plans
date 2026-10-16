"use client";

import { useState } from "react";
import { canReverseClaim } from "../../lib/domain/permissions.js";
import { formatMoney } from "../../lib/domain/money.js";
import { displayDate } from "./QuoteSummary.jsx";

export function ClaimReversalPanel({ plan, actor, service, onAction }) {
  const [selectedId, setSelectedId] = useState("");
  const [reason, setReason] = useState("");
  const eligible = plan.claims?.filter((claim) => !claim.reversedAt) ?? [];
  const selected = eligible.find((claim) => claim.id === selectedId);
  const canReverse = canReverseClaim(actor, plan);
  if (!plan.claims?.length) return null;
  return <section className="panel sectionGap">
    <h2>Claim reversals</h2>
    <p className="sub">Original claims, POs, invoices and completed payouts remain in the audit record. A paid reversal creates a dealer offset for a future weekly payout.</p>
    {canReverse && eligible.length > 0 && <form className="inlineForm" onSubmit={(event) => {
      event.preventDefault();
      const result = onAction(() => service.reverseClaim(actor, plan.id, selectedId, reason),
        (value) => value.adjustment ? `Claim reversed. ${value.adjustment.id} is available for a future dealer payout.` : "Claim reversed; entitlement and funding restored.");
      if (result) { setSelectedId(""); setReason(""); }
    }}>
      <label>Claim to reverse<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} required>
        <option value="">Select claim</option>{eligible.map((claim) => <option key={claim.id} value={claim.id}>Service {claim.serviceNumber} · {claim.poNumber} · {claim.financialStatus}</option>)}
      </select></label>
      <label>Reversal reason<input value={reason} onChange={(event) => setReason(event.target.value)} required placeholder="Reason for reversal" /></label>
      <button className="secondaryButton dangerText" disabled={!selected || !reason.trim()}>Reverse claim in sandbox</button>
      {selected?.financialStatus === "paid" && <small>Paid payout will remain unchanged; its net line becomes a dealer adjustment.</small>}
    </form>}
    <div className="simpleRecords">{plan.claims.filter((claim) => claim.reversedAt).map((claim) => <div key={claim.id}>
      <strong>Void {claim.poNumber} · service {claim.serviceNumber}</strong>
      <span>{displayDate(claim.reversedAt.slice(0, 10))} by {claim.reversedBy} · {claim.reversalReason}</span>
      <span>Original invoice {claim.invoice?.number ?? "none"}{claim.invoice ? " (void)" : ""} · original payout {claim.priorPayoutId ?? claim.payoutId ?? "none"} · adjustment {claim.adjustmentId ?? "none"} · locked value {formatMoney(claim.expectedCents)}</span>
    </div>)}</div>
    {canReverse && !eligible.length && <p className="sub">All recorded claims are already reversed.</p>}
  </section>;
}

export function PayoutAdjustmentRegister({ adjustments, payouts, onOpenPlan }) {
  const voided = payouts.flatMap((payout) => (payout.voidedLines ?? []).map((line) => ({ payout, line })));
  if (!adjustments.length && !voided.length) return null;
  return <section className="panel sectionGap"><h2>Reversal adjustments and voided payout lines</h2>
    <div className="tableScroll"><table><thead><tr><th>Record</th><th>Original payout / PO</th><th>Dealer / branch</th><th>Amount</th><th>Subsequent offsets</th></tr></thead><tbody>
      {adjustments.map((item) => <tr key={item.id}><td><button className="textButton" onClick={() => onOpenPlan(item.planId)}>{item.id}</button><small>{item.reason}</small></td><td>{item.originalPayoutId}<small>{item.originalPoNumber}</small></td><td>{item.dealerGroupId} · {item.branchId}</td><td>{formatMoney(item.amountCents)}</td><td>{item.offsets.length ? item.offsets.map((offset) => `${offset.payoutId}: ${formatMoney(-offset.amountCents)} (${offset.status})`).join("; ") : "Available for next weekly payout"}</td></tr>)}
      {voided.map(({ payout, line }) => <tr key={`${payout.id}/${line.claimId}`}><td><button className="textButton" onClick={() => onOpenPlan(line.planId)}>Voided scheduled line</button><small>{line.reason}</small></td><td>{payout.id}<small>{line.poNumber}</small></td><td>{payout.dealerGroupId} · {payout.branchId}</td><td>{formatMoney(line.netCents)}</td><td>Removed from pending payout; original line retained here.</td></tr>)}
    </tbody></table></div>
  </section>;
}
