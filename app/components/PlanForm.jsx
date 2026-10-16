"use client";

import { useMemo, useState } from "react";
import { addDays, todayLocalDate } from "../../lib/domain/dates.js";
import { forecastServices } from "../../lib/domain/forecast.js";
import { buildQuote, defaultFirstPaymentDate } from "../../lib/domain/quote.js";
import { formatMoney, serviceGrossCents } from "../../lib/domain/money.js";
import { PAYMENT_FREQUENCIES } from "../../lib/domain/funding.js";
import { blankManualService } from "../../lib/adapters/manual-service-source.js";
import QuoteSummary, { displayDate } from "./QuoteSummary.jsx";

const STEPS = ["Customer", "Vehicle", "Usage & interval", "Plan & services", "Payment", "Review"];
const numberFormat = new Intl.NumberFormat("en-NZ");

export function newDraft() {
  const quoteDate = todayLocalDate();
  return {
    quoteDate,
    customer: { firstName: "", lastName: "", mobile: "", email: "", address: "" },
    vehicle: { registration: "", year: "", make: "", model: "", variant: "", vin: "" },
    lastCompletedService: { date: "", odometer: "", serviceTablePosition: null },
    currentOdometer: "", annualKm: "15000", intervalMonths: "12", intervalKm: "15000", intervalConfirmed: false, intervalAudit: [],
    numberOfServices: "3", services: [1, 2, 3].map(blankManualService), planSource: null,
    frequency: "weekly", firstPaymentDate: defaultFirstPaymentDate(quoteDate, "weekly"), firstPaymentDates: {}, paymentChangeConfirmed: false,
  };
}

function normaliseDraft(source) {
  const blank = newDraft();
  const draft = { ...blank, ...JSON.parse(JSON.stringify(source)), customer: { ...blank.customer, ...source.customer }, vehicle: { ...blank.vehicle, ...source.vehicle } };
  draft.lastCompletedService = { ...blank.lastCompletedService, ...(source.lastCompletedService ?? {}) };
  draft.intervalAudit ??= [];
  draft.firstPaymentDates ??= {};
  draft.services ??= [];
  return draft;
}

function calculateForecast(draft) {
  return forecastServices({
    startDate: draft.quoteDate, lastCompletedService: draft.lastCompletedService, currentOdometer: draft.currentOdometer,
    annualKm: draft.annualKm, intervalMonths: draft.intervalMonths, intervalKm: draft.intervalKm, numberOfServices: draft.numberOfServices,
  });
}

function Field({ label, hint, children, wide = false }) {
  return <label className={`field${wide ? " fieldWide" : ""}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export default function PlanForm({ initialDraft, initialStep = 0, editing, findCustomers, getPlanOptions, onLookupVehicle, onCancel, onSaveDraft, onIssueQuote, onProceedActivation }) {
  const [draft, setDraft] = useState(() => initialDraft ? normaliseDraft(initialDraft) : newDraft());
  const [step, setStep] = useState(Math.max(0, Math.min(5, initialStep)));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lookupState, setLookupState] = useState("");
  const forecastResult = useMemo(() => {
    try { return { points: calculateForecast(draft), error: "" }; }
    catch (cause) { return { points: null, error: cause.message }; }
  }, [draft.quoteDate, draft.lastCompletedService, draft.currentOdometer, draft.annualKm, draft.intervalMonths, draft.intervalKm, draft.numberOfServices]);
  const forecast = forecastResult.points;
  const quote = useMemo(() => { try { return buildQuote(draft); } catch { return null; } }, [draft]);
  const options = useMemo(() => getPlanOptions?.(draft) ?? [], [getPlanOptions, draft.vehicle.make, draft.vehicle.model]);
  const customerNeedle = `${draft.customer.firstName} ${draft.customer.lastName}`.trim().toLowerCase();
  const matches = useMemo(() => customerNeedle.length < 2 ? [] : findCustomers?.(customerNeedle) ?? [], [findCustomers, customerNeedle]);

  function clearMessages() { setError(""); setNotice(""); }
  function changeCustomer(key, value) { setDraft((old) => ({ ...old, customer: { ...old.customer, [key]: value } })); clearMessages(); }
  function changeVehicle(key, value) { setDraft((old) => ({ ...old, vehicle: { ...old.vehicle, [key]: value }, planSource: key === "make" || key === "model" ? null : old.planSource })); clearMessages(); }
  function changeLastCompletedService(key, value) { setDraft((old) => ({ ...old, lastCompletedService: { ...old.lastCompletedService, [key]: value } })); clearMessages(); }
  function changeRoot(key, value) {
    setDraft((old) => {
      if (key !== "numberOfServices") return { ...old, [key]: value, ...(key === "intervalMonths" || key === "intervalKm" ? { intervalConfirmed: false } : {}), ...(key === "firstPaymentDate" ? { paymentChangeConfirmed: false } : {}) };
      const count = Math.max(0, Math.min(24, Number(value) || 0));
      return { ...old, [key]: value, services: Array.from({ length: count }, (_, index) => old.services[index] ?? blankManualService(index + 1)) };
    });
    clearMessages();
  }
  function changeService(index, key, value) {
    setDraft((old) => ({ ...old, services: old.services.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) }));
    clearMessages();
  }
  function selectCustomer(match) {
    setDraft((old) => ({ ...old, customer: { ...match.customer, id: match.id } }));
    setNotice("Existing customer selected. No records were merged."); setError("");
  }
  function lookupVehicle() {
    try {
      const result = onLookupVehicle?.(draft.vehicle.registration);
      if (!result) { setLookupState("No AutoCheck sandbox match. Continue with manual entry."); return; }
      setDraft((old) => ({ ...old, vehicle: { ...old.vehicle, ...result }, intervalMonths: result.intervalMonths ?? old.intervalMonths,
        intervalKm: result.intervalKm ?? old.intervalKm, intervalConfirmed: false,
        intervalAudit: [...old.intervalAudit, { at: new Date().toISOString(), action: "prefilled", source: result.source, intervalMonths: result.intervalMonths, intervalKm: result.intervalKm }] }));
      setLookupState(`AutoCheck sandbox match found for ${result.registration}. Confirm the suggested interval before continuing.`);
    } catch (cause) { setError(cause.message); }
  }
  function confirmInterval() {
    setDraft((old) => ({ ...old, intervalConfirmed: true, intervalAudit: [...old.intervalAudit, { at: new Date().toISOString(), action: "advisor_confirmed", intervalMonths: old.intervalMonths, intervalKm: old.intervalKm }] }));
    setNotice("Service interval confirmed and added to the draft audit history.");
  }
  function selectOption(option) {
    if (option.id === "custom") {
      setDraft((old) => ({ ...old, planSource: { origin: "dealer", optionType: "custom", templateId: null, lockedPricing: false },
        services: Array.from({ length: Number(old.numberOfServices) || 0 }, (_, index) => old.services[index] ?? blankManualService(index + 1)) }));
      return;
    }
    setDraft((old) => ({ ...old,
      planSource: { origin: option.origin, optionType: option.optionType, templateId: option.id, manufacturerId: option.manufacturerId, lockedPricing: option.lockedPricing, name: option.name ?? `${option.brand} ${option.model}` },
      intervalMonths: String(option.intervalMonths), intervalKm: String(option.intervalKm), intervalConfirmed: false,
      numberOfServices: String(option.services.length), services: option.services.map((item, index) => ({ ...blankManualService(index + 1), ...item })),
      intervalAudit: [...old.intervalAudit, { at: new Date().toISOString(), action: "prefilled", source: option.id, intervalMonths: String(option.intervalMonths), intervalKm: String(option.intervalKm) }],
    }));
  }
  function selectFrequency(frequency) {
    setDraft((old) => ({ ...old, frequency, firstPaymentDate: old.firstPaymentDates[frequency] ?? defaultFirstPaymentDate(old.quoteDate, frequency), paymentChangeConfirmed: false }));
    clearMessages();
  }
  function setFirstPaymentDate(value) {
    setDraft((old) => ({ ...old, firstPaymentDate: value, firstPaymentDates: { ...old.firstPaymentDates, [old.frequency]: value }, paymentChangeConfirmed: false }));
    clearMessages();
  }

  function validateStep(target = step) {
    if (target === 0) {
      for (const [key, label] of [["firstName", "First name"], ["lastName", "Last name"], ["mobile", "Mobile"], ["email", "Email"], ["address", "Physical address"]]) if (!String(draft.customer[key] ?? "").trim()) throw new Error(`${label} is required.`);
      if (!/^\S+@\S+\.\S+$/.test(draft.customer.email)) throw new Error("Enter a valid email address.");
      if (draft.customer.mobile.replace(/\D/g, "").length < 7) throw new Error("Enter a valid mobile number.");
    }
    if (target === 1) {
      if (!draft.vehicle.registration.trim()) throw new Error("Registration is required for lookup or manual vehicle entry.");
      if (!draft.vehicle.make.trim() || !draft.vehicle.model.trim()) throw new Error("Enter the vehicle make and model.");
      const year = Number(draft.vehicle.year);
      if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear() + 2) throw new Error("Enter a valid vehicle year.");
    }
    if (target === 2) {
      if (!forecast) throw new Error(forecastResult.error || "Complete the usage and service interval details.");
      if (!draft.intervalConfirmed) throw new Error("Advisor confirmation of the service interval is required.");
    }
    if (target === 3) {
      if (!draft.planSource) throw new Error("Select an available plan option or Create Custom Plan.");
      if (!forecast || draft.services.length !== forecast.length) throw new Error("Complete usage and interval details first.");
      draft.services.forEach((item, index) => {
        if (!item.name.trim()) throw new Error(`Name service ${index + 1}.`);
        if (serviceGrossCents(item.price, item.taxMode) <= 0) throw new Error(`Price service ${index + 1} above zero.`);
      });
    }
    if (target >= 4) {
      const built = buildQuote(draft);
      if (built.paymentChange.requiresConfirmation && !draft.paymentChangeConfirmed) throw new Error("Confirm the changed instalment amount before proceeding.");
    }
  }
  function submit(event) {
    event.preventDefault();
    try {
      validateStep();
      if (step < STEPS.length - 1) { setStep(step + 1); clearMessages(); }
    } catch (cause) { setError(cause.message); setNotice(""); }
  }
  function saveDraft() {
    try { onSaveDraft?.(draft, step); setNotice(`Draft saved at step ${step + 1}.`); setError(""); }
    catch (cause) { setError(cause.message); setNotice(""); }
  }
  function issue() {
    try { validateStep(5); onIssueQuote?.(draft, step); }
    catch (cause) { setError(cause.message); setNotice(""); }
  }
  function proceed() {
    try { validateStep(5); onProceedActivation?.(draft, step); }
    catch (cause) { setError(cause.message); setNotice(""); }
  }

  return <><div className="backRow"><button className="backButton" onClick={onCancel}>← Plans</button><span className="pill">{editing ? "Saved draft" : "New Service Plan"}</span></div>
    <header className="pageHeader formHeader"><div><p className="eyebrow">CREATE SERVICE PLAN · STEP {step + 1} OF {STEPS.length}</p><h1>Create Service Plan</h1><p className="sub">A compact customer-ready workflow. Save the draft at any point.</p></div><button type="button" className="secondaryButton" onClick={saveDraft}>Save Draft</button></header>
    <div className="workflowLayout"><aside className="stepNav" aria-label="Create plan steps">{STEPS.map((name, index) => <button key={name} className={`stepNavItem${index === step ? " current" : ""}${index < step ? " completed" : ""}`} onClick={() => { if (index <= step) { setStep(index); clearMessages(); } }} type="button" disabled={index > step}><span>{index < step ? "✓" : index + 1}</span>{name}</button>)}</aside>
      <form className="panel formPanel" onSubmit={submit} noValidate>
        {step === 0 && <><div className="formIntro"><span className="eyebrow">01 / CUSTOMER</span><h2>Who is the Service Plan for?</h2><p className="sub">Start with the customer’s name. Matching dealer-group customers appear below; selecting one fills the fields without merging records.</p></div><div className="fieldGrid"><Field label="First name"><input value={draft.customer.firstName} onChange={(event) => changeCustomer("firstName", event.target.value)} autoComplete="given-name" /></Field><Field label="Last name"><input value={draft.customer.lastName} onChange={(event) => changeCustomer("lastName", event.target.value)} autoComplete="family-name" /></Field></div>{matches.length > 0 && <section className="matchPanel"><strong>Matching existing customers</strong>{matches.map((match) => <button type="button" key={match.id} onClick={() => selectCustomer(match)}><span>{match.customer.firstName} {match.customer.lastName}</span><small>{match.detail} · {match.lastVehicle}</small></button>)}</section>}<div className="fieldGrid sectionGap"><Field label="Mobile"><input type="tel" value={draft.customer.mobile} onChange={(event) => changeCustomer("mobile", event.target.value)} autoComplete="tel" /></Field><Field label="Email"><input type="email" value={draft.customer.email} onChange={(event) => changeCustomer("email", event.target.value)} autoComplete="email" /></Field><Field label="Physical address" wide><input value={draft.customer.address} onChange={(event) => changeCustomer("address", event.target.value)} autoComplete="street-address" /></Field></div></>}
        {step === 1 && <><div className="formIntro"><span className="eyebrow">02 / VEHICLE</span><h2>Identify the vehicle</h2><p className="sub">Registration comes first. AutoCheck is represented by a sandbox provider; manual entry remains available and VIN is optional.</p></div><div className="lookupRow"><Field label="Registration"><input value={draft.vehicle.registration} onChange={(event) => changeVehicle("registration", event.target.value.toUpperCase())} /></Field><button type="button" className="secondaryButton" onClick={lookupVehicle}>Look up in AutoCheck sandbox</button></div>{lookupState && <p className="helpBox">{lookupState}</p>}<div className="fieldGrid sectionGap"><Field label="Year"><input type="number" min="1900" max="2100" value={draft.vehicle.year} onChange={(event) => changeVehicle("year", event.target.value)} /></Field><Field label="Make"><input value={draft.vehicle.make} onChange={(event) => changeVehicle("make", event.target.value)} /></Field><Field label="Model"><input value={draft.vehicle.model} onChange={(event) => changeVehicle("model", event.target.value)} /></Field><Field label="Variant" hint="Where available"><input value={draft.vehicle.variant} onChange={(event) => changeVehicle("variant", event.target.value)} /></Field><Field label="VIN" hint="Optional if unavailable" wide><input value={draft.vehicle.vin} onChange={(event) => changeVehicle("vin", event.target.value)} /></Field></div></>}
        {step === 2 && <><div className="formIntro"><span className="eyebrow">03 / FORECAST</span><h2>Usage and service interval</h2><p className="sub">The last completed service anchors the manufacturer cycle. Each future service uses whichever confirmed time or kilometre threshold occurs first.</p></div><section className="formSection"><div className="formSectionHeading"><div><h3>Last service completed</h3><p className="sub">This is the fixed date and kilometre position for the next scheduled service.</p></div></div><div className="fieldGrid"><Field label="Last service date"><input type="date" max={draft.quoteDate} value={draft.lastCompletedService.date} onChange={(event) => changeLastCompletedService("date", event.target.value)} /></Field><Field label="Last service odometer · km"><input type="number" min="0" step="1" value={draft.lastCompletedService.odometer} onChange={(event) => changeLastCompletedService("odometer", event.target.value)} /></Field></div></section><section className="formSection"><div className="fieldGrid"><Field label="Current odometer · km"><input type="number" min="0" step="1" value={draft.currentOdometer} onChange={(event) => changeRoot("currentOdometer", event.target.value)} /></Field><Field label="Predicted annual km"><input type="number" min="1" step="1" value={draft.annualKm} onChange={(event) => changeRoot("annualKm", event.target.value)} /></Field><Field label="Service interval · months"><input type="number" min="1" step="1" value={draft.intervalMonths} onChange={(event) => changeRoot("intervalMonths", event.target.value)} /></Field><Field label="Service interval · km"><input type="number" min="1" step="1" value={draft.intervalKm} onChange={(event) => changeRoot("intervalKm", event.target.value)} /></Field><Field label="Number of services"><input type="number" min="1" max="24" step="1" value={draft.numberOfServices} onChange={(event) => changeRoot("numberOfServices", event.target.value)} /></Field></div><div className={`confirmationBar${draft.intervalConfirmed ? " confirmed" : ""}`}><span>{draft.intervalConfirmed ? "✓ Advisor confirmed" : "Advisor confirmation required"}: {draft.intervalMonths} months / {numberFormat.format(Number(draft.intervalKm) || 0)} km</span><button type="button" className="textButton" onClick={confirmInterval}>{draft.intervalConfirmed ? "Confirm again" : "Confirm interval"}</button></div></section>{forecast && <section className="forecastPreview" aria-label="Forecast preview"><div className="forecastPreviewHeading"><div><strong>Full service forecast</strong><span>{forecast.length} proposed services</span></div><small>Anchored to {numberFormat.format(Number(draft.lastCompletedService.odometer))} km on {displayDate(draft.lastCompletedService.date)}</small></div><div className="forecastList">{forecast.map((point) => <article className="forecastRow" key={point.number}><span className="serviceNumber">{String(point.number).padStart(2, "0")}</span><div><strong>Service {point.number}</strong><small>{numberFormat.format(point.scheduledKm)} km scheduled</small></div><div><span>{point.dueState === "upcoming" ? "Predicted" : "Due"} {displayDate(point.predictedDate)}</span><small>{point.trigger === "km" ? "Kilometre threshold" : "Time threshold"}</small></div><span className={`forecastState ${point.dueState}`}>{point.dueState === "due_now" ? "Due now" : point.dueState === "overdue" ? "Overdue" : "Upcoming"}</span></article>)}</div></section>}</>}
        {step === 3 && <><div className="formIntro"><span className="eyebrow">04 / PLAN & SERVICES</span><h2>Choose an available option</h2><p className="sub">Manufacturer pricing is locked. Dealer templates and a custom sequential plan are available where applicable.</p></div><div className="optionGrid">{options.map((option) => <button type="button" key={option.id} className={`optionCard${draft.planSource?.templateId === option.id || option.id === "custom" && draft.planSource?.optionType === "custom" ? " selected" : ""}`} onClick={() => selectOption(option)}><span>{option.origin === "manufacturer" ? "Authorised manufacturer" : option.id === "custom" ? "Custom" : "Dealer template"}</span><strong>{option.name ?? (option.id === "custom" ? "Create Custom Plan" : `${option.brand} ${option.model}`)}</strong><small>{option.lockedPricing ? "Locked pricing" : option.id === "custom" ? "Generate sequential service lines" : `${option.services.length} services`}</small></button>)}</div>{draft.planSource && <div className="serviceEditor sectionGap">{(forecast ?? []).map((point, index) => <section className="serviceCard" key={index}><div className="serviceCardTop"><div><span className="serviceNumber">{String(index + 1).padStart(2, "0")}</span><strong>Service {index + 1}</strong></div><span className="dueBadge">{displayDate(point.predictedDate)} · {numberFormat.format(point.predictedKm)} km</span></div><div className="fieldGrid"><Field label="Service name" wide><input value={draft.services[index]?.name ?? ""} onChange={(event) => changeService(index, "name", event.target.value)} disabled={draft.planSource.lockedPricing} /></Field><Field label="Detailed inclusions" hint="Optional — leave blank when not supplied" wide><input value={draft.services[index]?.description ?? ""} onChange={(event) => changeService(index, "description", event.target.value)} placeholder="Only enter inclusions actually provided in plan setup" disabled={draft.planSource.lockedPricing} /></Field><Field label="Price · NZD"><input type="number" min="0.01" step="0.01" value={draft.services[index]?.price ?? ""} onChange={(event) => changeService(index, "price", event.target.value)} disabled={draft.planSource.lockedPricing} /></Field><Field label="GST treatment"><select value={draft.services[index]?.taxMode ?? "inclusive"} onChange={(event) => changeService(index, "taxMode", event.target.value)} disabled={draft.planSource.lockedPricing}><option value="inclusive">GST inclusive</option><option value="exclusive">GST exclusive</option></select></Field></div>{draft.services[index]?.price && <small className="grossHint">Service Plan value including GST: {(() => { try { return formatMoney(serviceGrossCents(draft.services[index].price, draft.services[index].taxMode)); } catch { return "—"; } })()}</small>}</section>)}</div>}</>}
        {step === 4 && <><div className="formIntro"><span className="eyebrow">05 / PAYMENT</span><h2>Compare payment options</h2><p className="sub">Weekly is selected by default. Every option funds each predicted service and completes collection before the final service.</p></div>{quote && <div className="paymentOptionGrid">{Object.entries(quote.paymentOptions).map(([frequency, option]) => <button type="button" key={frequency} className={`paymentOption${draft.frequency === frequency ? " selected" : ""}`} onClick={() => selectFrequency(frequency)}><span>{option.label}</span><strong>{formatMoney(option.installmentCents)}</strong><small>{option.paymentCount} collections from {displayDate(option.firstPaymentDate)}</small></button>)}</div>}<div className="fieldGrid sectionGap"><Field label="Selected frequency"><select value={draft.frequency} onChange={(event) => selectFrequency(event.target.value)}>{Object.entries(PAYMENT_FREQUENCIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="First payment date" hint="Any future date is allowed; the schedule recalculates."><input type="date" min={addDays(draft.quoteDate, 1)} value={draft.firstPaymentDate} onChange={(event) => setFirstPaymentDate(event.target.value)} /></Field></div>{quote?.paymentChange.requiresConfirmation && <label className="amountChange"><input type="checkbox" checked={draft.paymentChangeConfirmed} onChange={(event) => setDraft((old) => ({ ...old, paymentChangeConfirmed: event.target.checked }))} /><span><strong>Instalment changed by {formatMoney(Math.abs(quote.paymentChange.amountDifferenceCents))}</strong> from the normal-cycle amount of {formatMoney(quote.paymentChange.standardInstallmentCents)} to {formatMoney(quote.paymentChange.quotedInstallmentCents)}. Confirm with the customer before proceeding.</span></label>}</>}
        {step === 5 && <><div className="formIntro"><span className="eyebrow">06 / CUSTOMER REVIEW</span><h2>Review the proposed Service Plan</h2><p className="sub">Use this screen with the customer. Internal checkpoint mathematics and dealer economics are intentionally excluded.</p></div>{quote ? <QuoteSummary quote={quote} origin={draft.planSource?.origin ?? "dealer"} customerFacing /> : <p className="helpBox">Return to the earlier steps to complete the Service Plan.</p>}</>}
        {notice && <div className="notice" role="status">{notice}</div>}{error && <div className="errorBox" role="alert">{error}</div>}
        <div className="formActions"><button type="button" className="secondaryButton" onClick={() => { if (step === 0) onCancel(); else { setStep(step - 1); clearMessages(); } }}>{step === 0 ? "Cancel" : "← Back"}</button><div className="headerActions"><button type="button" className="secondaryButton" onClick={saveDraft}>Save Draft</button>{step < 5 ? <button className="primaryButton" type="submit">Continue →</button> : <><button type="button" className="secondaryButton" onClick={issue}>Issue Quote</button><button type="button" className="primaryButton" onClick={proceed}>Proceed to Activation</button></>}</div></div>
      </form></div></>;
}
