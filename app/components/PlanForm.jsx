"use client";

import { useMemo, useState } from "react";
import { addDays, todayLocalDate } from "../../lib/domain/dates.js";
import { forecastServices } from "../../lib/domain/forecast.js";
import { buildQuote } from "../../lib/domain/quote.js";
import { formatMoney, serviceGrossCents } from "../../lib/domain/money.js";
import { PAYMENT_FREQUENCIES } from "../../lib/domain/funding.js";
import { blankManualService } from "../../lib/adapters/manual-service-source.js";
import QuoteSummary, { displayDate } from "./QuoteSummary.jsx";

const STEPS = ["Customer", "Vehicle", "Usage & interval", "Services", "Payment", "Review"];
const numberFormat = new Intl.NumberFormat("en-NZ");

export function newDraft() {
  const quoteDate = todayLocalDate();
  return {
    quoteDate,
    customer: { firstName: "", lastName: "", mobile: "", email: "", address: "" },
    vehicle: { year: "", make: "", model: "", registration: "", vin: "" },
    currentOdometer: "", annualKm: "15000", intervalMonths: "12", intervalKm: "15000",
    numberOfServices: "3", services: [1, 2, 3].map(blankManualService),
    frequency: "weekly", firstPaymentDate: addDays(quoteDate, 7),
  };
}

function Field({ label, hint, children, wide = false }) {
  return <label className={`field${wide ? " fieldWide" : ""}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export default function PlanForm({ initialDraft, editing, onCancel, onSave }) {
  const [draft, setDraft] = useState(() => initialDraft ? JSON.parse(JSON.stringify(initialDraft)) : newDraft());
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const forecast = useMemo(() => {
    try { return forecastServices({ startDate: draft.quoteDate, currentOdometer: draft.currentOdometer, annualKm: draft.annualKm, intervalMonths: draft.intervalMonths, intervalKm: draft.intervalKm, numberOfServices: draft.numberOfServices }); }
    catch { return null; }
  }, [draft.quoteDate, draft.currentOdometer, draft.annualKm, draft.intervalMonths, draft.intervalKm, draft.numberOfServices]);
  const quote = useMemo(() => { try { return buildQuote(draft); } catch { return null; } }, [draft]);

  function changeCustomer(key, value) { setDraft((old) => ({ ...old, customer: { ...old.customer, [key]: value } })); setError(""); }
  function changeVehicle(key, value) { setDraft((old) => ({ ...old, vehicle: { ...old.vehicle, [key]: value } })); setError(""); }
  function changeRoot(key, value) {
    setDraft((old) => {
      if (key !== "numberOfServices") return { ...old, [key]: value };
      const count = Math.max(0, Math.min(24, Number(value) || 0));
      return { ...old, [key]: value, services: Array.from({ length: count }, (_, index) => old.services[index] ?? blankManualService(index + 1)) };
    });
    setError("");
  }
  function changeService(index, key, value) {
    setDraft((old) => ({ ...old, services: old.services.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) }));
    setError("");
  }
  function validateStep() {
    if (step === 0) {
      const customer = draft.customer;
      for (const [key, label] of [["firstName", "First name"], ["lastName", "Last name"], ["mobile", "Mobile"], ["email", "Email"], ["address", "Physical address"]]) {
        if (!String(customer[key] ?? "").trim()) throw new Error(`${label} is required.`);
      }
      if (!/^\S+@\S+\.\S+$/.test(customer.email)) throw new Error("Enter a valid email address.");
      if (customer.mobile.replace(/\D/g, "").length < 7) throw new Error("Enter a valid mobile number.");
    }
    if (step === 1) {
      if (!draft.vehicle.make.trim() || !draft.vehicle.model.trim()) throw new Error("Enter the vehicle make and model.");
      const year = Number(draft.vehicle.year);
      if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear() + 2) throw new Error("Enter a valid vehicle year.");
    }
    if (step === 2 && !forecast) throw new Error("Enter a valid odometer, annual kilometres, interval and service count.");
    if (step === 3) {
      if (!forecast || draft.services.length !== forecast.length) throw new Error("Complete usage and interval details first.");
      draft.services.forEach((item, index) => {
        if (!item.name.trim()) throw new Error(`Name service ${index + 1}.`);
        if (serviceGrossCents(item.price, item.taxMode) <= 0) throw new Error(`Price service ${index + 1} above zero.`);
      });
    }
    if (step === 4) buildQuote(draft);
  }
  function submit(event) {
    event.preventDefault();
    try {
      if (step < STEPS.length - 1) { validateStep(); setStep(step + 1); setError(""); }
      else { buildQuote(draft); onSave(draft); }
    } catch (cause) { setError(cause.message); }
  }

  return <><div className="backRow"><button className="backButton" onClick={onCancel}>← Plans</button><span className="pill">{editing ? "Editing dealer quote" : "New dealer quote"}</span></div>
    <header className="pageHeader formHeader"><div><p className="eyebrow">CREATE PLAN · STEP {step + 1} OF {STEPS.length}</p><h1>{editing ? "Edit dealer plan" : "Create plan"}</h1><p className="sub">Capture the contract inputs, then review a fully funded quote.</p></div></header>
    <div className="workflowLayout"><aside className="stepNav" aria-label="Create plan steps">{STEPS.map((name, index) => <button key={name} className={`stepNavItem${index === step ? " current" : ""}${index < step ? " completed" : ""}`} onClick={() => { if (index < step) { setStep(index); setError(""); } }} type="button" disabled={index > step}><span>{index < step ? "✓" : index + 1}</span>{name}</button>)}</aside>
      <form className="panel formPanel" onSubmit={submit} noValidate>
        {step === 0 && <><div className="formIntro"><span className="eyebrow">01 / CUSTOMER</span><h2>Customer details</h2><p className="sub">These details identify the quote holder. All fields are required.</p></div><div className="fieldGrid"><Field label="First name"><input value={draft.customer.firstName} onChange={(event) => changeCustomer("firstName", event.target.value)} autoComplete="given-name" /></Field><Field label="Last name"><input value={draft.customer.lastName} onChange={(event) => changeCustomer("lastName", event.target.value)} autoComplete="family-name" /></Field><Field label="Mobile"><input type="tel" value={draft.customer.mobile} onChange={(event) => changeCustomer("mobile", event.target.value)} autoComplete="tel" /></Field><Field label="Email"><input type="email" value={draft.customer.email} onChange={(event) => changeCustomer("email", event.target.value)} autoComplete="email" /></Field><Field label="Physical address" wide><input value={draft.customer.address} onChange={(event) => changeCustomer("address", event.target.value)} autoComplete="street-address" /></Field></div></>}
        {step === 1 && <><div className="formIntro"><span className="eyebrow">02 / VEHICLE</span><h2>Vehicle details</h2><p className="sub">VIN is optional when unavailable. Vehicle lookup is not connected in this sandbox.</p></div><div className="fieldGrid"><Field label="Year"><input type="number" min="1900" max="2100" value={draft.vehicle.year} onChange={(event) => changeVehicle("year", event.target.value)} /></Field><Field label="Make"><input value={draft.vehicle.make} onChange={(event) => changeVehicle("make", event.target.value)} /></Field><Field label="Model"><input value={draft.vehicle.model} onChange={(event) => changeVehicle("model", event.target.value)} /></Field><Field label="Registration" hint="Optional"><input value={draft.vehicle.registration} onChange={(event) => changeVehicle("registration", event.target.value)} /></Field><Field label="VIN" hint="Optional if unavailable" wide><input value={draft.vehicle.vin} onChange={(event) => changeVehicle("vin", event.target.value)} /></Field></div></>}
        {step === 2 && <><div className="formIntro"><span className="eyebrow">03 / FORECAST</span><h2>Usage and service interval</h2><p className="sub">Each service is due at the earlier of its month or kilometre threshold, measured from {displayDate(draft.quoteDate)}.</p></div><div className="fieldGrid"><Field label="Current odometer · km"><input type="number" min="0" step="1" value={draft.currentOdometer} onChange={(event) => changeRoot("currentOdometer", event.target.value)} /></Field><Field label="Predicted annual km"><input type="number" min="1" step="1" value={draft.annualKm} onChange={(event) => changeRoot("annualKm", event.target.value)} /></Field><Field label="Service interval · months"><input type="number" min="1" step="1" value={draft.intervalMonths} onChange={(event) => changeRoot("intervalMonths", event.target.value)} /></Field><Field label="Service interval · km"><input type="number" min="1" step="1" value={draft.intervalKm} onChange={(event) => changeRoot("intervalKm", event.target.value)} /></Field><Field label="Number of services" hint="The plan length is the number of services."><input type="number" min="1" max="24" step="1" value={draft.numberOfServices} onChange={(event) => changeRoot("numberOfServices", event.target.value)} /></Field></div>{forecast && <div className="forecastStrip"><strong>Forecast preview</strong><span>First service {displayDate(forecast[0].predictedDate)} at {numberFormat.format(forecast[0].predictedKm)} km</span><span>Final service {displayDate(forecast.at(-1).predictedDate)} at {numberFormat.format(forecast.at(-1).predictedKm)} km</span></div>}</>}
        {step === 3 && <><div className="formIntro"><span className="eyebrow">04 / SERVICES</span><h2>Select and price services</h2><p className="sub">Create each service manually. Prices are fixed in the quote snapshot. Service-table suggestions can be added through the proposal source later.</p></div><div className="serviceEditor">{(forecast ?? []).map((point, index) => <section className="serviceCard" key={index}><div className="serviceCardTop"><div><span className="serviceNumber">{String(index + 1).padStart(2, "0")}</span><strong>Service {index + 1}</strong></div><span className="dueBadge">{displayDate(point.predictedDate)} · {numberFormat.format(point.predictedKm)} km</span></div><div className="fieldGrid"><Field label="Service name" wide><input value={draft.services[index]?.name ?? ""} onChange={(event) => changeService(index, "name", event.target.value)} /></Field><Field label="Description" wide><input value={draft.services[index]?.description ?? ""} onChange={(event) => changeService(index, "description", event.target.value)} placeholder="Included work" /></Field><Field label="Price · NZD"><input type="number" min="0.01" step="0.01" value={draft.services[index]?.price ?? ""} onChange={(event) => changeService(index, "price", event.target.value)} /></Field><Field label="GST treatment"><select value={draft.services[index]?.taxMode ?? "inclusive"} onChange={(event) => changeService(index, "taxMode", event.target.value)}><option value="inclusive">GST inclusive</option><option value="exclusive">GST exclusive</option></select></Field></div>{draft.services[index]?.price && <small className="grossHint">Contract price including GST: {(() => { try { return formatMoney(serviceGrossCents(draft.services[index].price, draft.services[index].taxMode)); } catch { return "—"; } })()}</small>}</section>)}</div></>}
        {step === 4 && <><div className="formIntro"><span className="eyebrow">05 / FUNDING</span><h2>Payment settings</h2><p className="sub">Choose the collection frequency and first date. The engine checks every service’s required funding and ends collections before the last service.</p></div><div className="fieldGrid"><Field label="Payment frequency"><select value={draft.frequency} onChange={(event) => changeRoot("frequency", event.target.value)}>{Object.entries(PAYMENT_FREQUENCIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="First payment date"><input type="date" min={draft.quoteDate} value={draft.firstPaymentDate} onChange={(event) => changeRoot("firstPaymentDate", event.target.value)} /></Field></div>{quote ? <div className="fundingPreview"><div><span>Regular payment</span><strong>{formatMoney(quote.funding.installmentCents)}</strong><small>{quote.funding.paymentCount} collections · final payment {formatMoney(quote.funding.finalPaymentCents)}</small></div><div><span>Final collection</span><strong>{displayDate(quote.funding.finalPaymentDate)}</strong><small>Final service {displayDate(quote.services.at(-1).predictedDate)}</small></div></div> : <p className="helpBox">Complete the payment settings to calculate a funding schedule.</p>}</>}
        {step === 5 && <><div className="formIntro"><span className="eyebrow">06 / REVIEW</span><h2>Quote summary</h2><p className="sub">Review service values, due points and collection coverage before saving this local quote.</p></div>{quote ? <QuoteSummary quote={quote} origin="dealer" showSchedule /> : <p className="helpBox">Return to the earlier steps to complete the quote.</p>}</>}
        {error && <div className="errorBox" role="alert">{error}</div>}
        <div className="formActions"><button type="button" className="secondaryButton" onClick={() => { if (step === 0) onCancel(); else { setStep(step - 1); setError(""); } }}>{step === 0 ? "Cancel" : "← Back"}</button><button className="primaryButton" type="submit">{step === 5 ? "Save local quote" : "Continue →"}</button></div>
      </form></div></>;
}
