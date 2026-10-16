"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "../../lib/domain/money.js";
import QuoteSummary, { displayDate } from "./QuoteSummary.jsx";

const CONTRACT_VERSION = "DP-CONTRACT-V1";

function SignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    context.lineWidth = 2;
    context.lineCap = "round";
    context.strokeStyle = "#122536";
  }, []);
  function point(event) {
    const box = canvasRef.current.getBoundingClientRect();
    return { x: (event.clientX - box.left) * canvasRef.current.width / box.width, y: (event.clientY - box.top) * canvasRef.current.height / box.height };
  }
  function start(event) { drawing.current = true; const p = point(event); const ctx = canvasRef.current.getContext("2d"); ctx.beginPath(); ctx.moveTo(p.x, p.y); event.currentTarget.setPointerCapture(event.pointerId); }
  function move(event) { if (!drawing.current) return; const p = point(event); const ctx = canvasRef.current.getContext("2d"); ctx.lineTo(p.x, p.y); ctx.stroke(); onChange(canvasRef.current.toDataURL("image/png")); }
  function stop() { drawing.current = false; onChange(canvasRef.current.toDataURL("image/png")); }
  function clear() { const canvas = canvasRef.current; canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height); onChange(""); }
  return <div className="signaturePad"><canvas ref={canvasRef} width="760" height="180" onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} aria-label="Customer signature pad" /><button type="button" className="textButton" onClick={clear}>Clear signature</button></div>;
}

export default function ActivationFlow({ plan, actor, onBack, onRecordSignature, onSetupPayment, onActivate, onViewPlan }) {
  const [stage, setStage] = useState(plan.status === "active" ? 3 : 0);
  const [method, setMethod] = useState(plan.activation?.signature?.method ?? "digital");
  const [signature, setSignature] = useState("");
  const [physicalConfirmed, setPhysicalConfirmed] = useState(Boolean(plan.activation?.signature?.confirmedHeldByDealer));
  const [error, setError] = useState("");
  const signatureComplete = Boolean(plan.activation?.signature);
  const paymentComplete = Boolean(plan.activation?.paymentMethod?.token);

  function saveSignature() {
    try {
      onRecordSignature({ method, evidence: method === "digital" ? signature : undefined, confirmedHeldByDealer: method === "physical" ? physicalConfirmed : undefined,
        contractVersion: CONTRACT_VERSION, customerName: `${plan.quote.customer.firstName} ${plan.quote.customer.lastName}` });
      setError(""); setStage(2);
    } catch (cause) { setError(cause.message); }
  }
  function setupPayment() {
    try { onSetupPayment(); setError(""); }
    catch (cause) { setError(cause.message); }
  }
  function activate() {
    try { onActivate(); setError(""); setStage(3); }
    catch (cause) { setError(cause.message); }
  }

  if (stage === 3 || plan.status === "active") return <section className="successScreen"><span className="successMark">✓</span><p className="eyebrow">ACTIVATION COMPLETE</p><h1>Congratulations, your Service Plan is live!</h1><p className="sub">The customer-facing setup is complete. Internally, the plan is {plan.operationalStatus === "live" ? "Live" : "Active — Awaiting First Payment"}.</p><div className="successDetails"><div><span>Vehicle</span><strong>{plan.quote.vehicle.registration} · {plan.quote.vehicle.make} {plan.quote.vehicle.model}</strong></div><div><span>Services</span><strong>{plan.quote.numberOfServices}</strong></div><div><span>Payment</span><strong>{plan.quote.paymentOptions[plan.quote.frequency].label} · {formatMoney(plan.quote.funding.installmentCents)}</strong></div><div><span>First payment</span><strong>{displayDate(plan.quote.firstPaymentDate)}</strong></div><div><span>Contract delivery</span><strong>{plan.contractDelivery?.length ? `${plan.contractDelivery.length} sandbox deliveries logged` : "Not logged"}</strong><small>No live email was sent in sandbox mode.</small></div></div><div className="headerActions successActions"><button className="primaryButton" onClick={onViewPlan}>View Plan</button><button className="secondaryButton" onClick={() => window.print()}>Print Summary</button><button className="secondaryButton" onClick={onBack}>Finish</button></div></section>;

  return <><div className="backRow"><button className="backButton" onClick={onBack}>← Plans</button><span className="pill">Activation · {stage + 1} of 3</span></div><header className="pageHeader"><div><p className="eyebrow">FINAL REVIEW → CONTRACT → PAYMENT METHOD → ACTIVATE</p><h1>Activate Service Plan</h1><p className="sub">Signature and payment-method setup are both required. Neither step activates the plan by itself.</p></div></header>
    <div className="activationSteps"><span className={stage === 0 ? "active" : "done"}>1 Review</span><span className={stage === 1 ? "active" : stage > 1 ? "done" : ""}>2 Contract signature</span><span className={stage === 2 ? "active" : ""}>3 Payment method</span></div>
    {stage === 0 && <section className="panel"><QuoteSummary quote={plan.quote} origin={plan.origin} /><div className="formActions"><button type="button" className="secondaryButton" onClick={onBack}>Cancel</button><button type="button" className="primaryButton" onClick={() => setStage(1)}>Customer is ready to sign →</button></div></section>}
    {stage === 1 && <section className="panel activationPanel"><div className="formIntro"><span className="eyebrow">CONTRACT {CONTRACT_VERSION}</span><h2>Customer signature</h2><p className="sub">Capture a direct on-device signature or record that the dealership holds the physically signed original.</p></div><div className="signatureChoices"><label className={method === "digital" ? "selected" : ""}><input type="radio" name="signatureMethod" value="digital" checked={method === "digital"} onChange={() => setMethod("digital")} /> Digital signature</label><label className={method === "physical" ? "selected" : ""}><input type="radio" name="signatureMethod" value="physical" checked={method === "physical"} onChange={() => setMethod("physical")} /> Physical signature</label></div>{method === "digital" ? <><p className="sub">Customer: draw your signature in the box below.</p><SignaturePad onChange={setSignature} /></> : <label className="amountChange"><input type="checkbox" checked={physicalConfirmed} onChange={(event) => setPhysicalConfirmed(event.target.checked)} /><span>I confirm the dealership holds the physically signed original of contract {CONTRACT_VERSION}. My Advisor identity and timestamp will be recorded.</span></label>}<div className="formActions"><button className="secondaryButton" onClick={() => setStage(0)}>← Review</button><button className="primaryButton" onClick={saveSignature}>{signatureComplete ? "Update signature evidence" : "Record signature"} →</button></div></section>}
    {stage === 2 && <section className="panel activationPanel"><div className="formIntro"><span className="eyebrow">SANDBOX PAYMENT PROVIDER</span><h2>Set up the payment method</h2><p className="sub">No real card number or CVC is requested, captured, or stored. The sandbox produces a token only.</p></div><div className={`setupStatus${signatureComplete ? " complete" : ""}`}><span>{signatureComplete ? "✓" : "○"}</span><div><strong>Contract signature</strong><small>{signatureComplete ? `${plan.activation.signature.method} evidence retained for ${plan.activation.signature.contractVersion}` : "Not complete"}</small></div></div><div className={`setupStatus${paymentComplete ? " complete" : ""}`}><span>{paymentComplete ? "✓" : "○"}</span><div><strong>Payment method</strong><small>{paymentComplete ? plan.activation.paymentMethod.display : "No method token yet"}</small></div>{!paymentComplete && <button className="secondaryButton" onClick={setupPayment}>Set up sandbox method</button>}</div><p className="helpBox">Any configured customer-funded setup fee will be attached to the first scheduled collection and its retries; it is not charged now.</p><div className="formActions"><button className="secondaryButton" onClick={() => setStage(1)}>← Signature</button><button className="primaryButton" disabled={!signatureComplete || !paymentComplete || !actor.permissions?.activatePlans && actor.role !== "dashub_admin"} onClick={activate}>Activate Plan</button></div></section>}
    {error && <div className="errorBox" role="alert">{error}</div>}
  </>;
}
