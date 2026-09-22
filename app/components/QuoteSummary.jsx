"use client";

import { useState } from "react";
import { formatMoney } from "../../lib/domain/money.js";
import { PAYMENT_FREQUENCIES } from "../../lib/domain/funding.js";

const numberFormat = new Intl.NumberFormat("en-NZ");
export function displayDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export function Metric({ label, value, note }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

export default function QuoteSummary({ quote, origin, showSchedule = false }) {
  const [expanded, setExpanded] = useState(false);
  const payments = quote.funding.payments;
  const compact = payments.length > 13 && !expanded;
  const visiblePayments = compact
    ? [...payments.slice(0, 12).map((payment, index) => ({ payment, number: index + 1 })), { payment: payments.at(-1), number: payments.length }]
    : payments.map((payment, index) => ({ payment, number: index + 1 }));
  return <div className="summaryStack">
    <div className="summaryHero">
      <div><span className="eyebrow">{origin === "manufacturer" ? "Manufacturer plan" : "Dealer plan"} · sandbox quote</span><h2>{quote.customer.firstName} {quote.customer.lastName}</h2><p>{quote.vehicle.year} {quote.vehicle.make} {quote.vehicle.model}{quote.vehicle.registration ? ` · ${quote.vehicle.registration}` : ""}</p></div>
      <div className="summaryTotal"><span>Total plan value · GST incl.</span><strong>{formatMoney(quote.funding.totalCents)}</strong></div>
    </div>
    <div className="summaryMetrics">
      <Metric label={`${PAYMENT_FREQUENCIES[quote.frequency]} collection`} value={formatMoney(quote.funding.installmentCents)} note="Regular amount; final payment may be lower" />
      <Metric label="Collections" value={quote.funding.paymentCount} note={`${displayDate(quote.firstPaymentDate)} to ${displayDate(quote.funding.finalPaymentDate)}`} />
      <Metric label="Final collection" value={formatMoney(quote.funding.finalPaymentCents)} note="Before the final predicted service" />
    </div>
    <section className="panel insetPanel"><div className="panelHeading"><div><h3>Services and funding checkpoints</h3><p className="sub">Each service is covered by collections received at its predicted point.</p></div><span className="pill positive">All funded</span></div>
      <div className="tableScroll"><table><thead><tr><th>Service</th><th>Predicted due</th><th>Odometer</th><th>Price</th><th>Required by due</th><th>Funded by due</th></tr></thead><tbody>{quote.services.map((service, index) => <tr key={index}><td><strong>{service.name}</strong><small>{service.trigger === "km" ? "Km threshold" : "Month interval"}</small></td><td>{displayDate(service.predictedDate)}</td><td>{numberFormat.format(service.predictedKm)} km</td><td>{formatMoney(service.grossCents)}</td><td>{formatMoney(quote.funding.coverage[index].requiredCents)}</td><td className="positiveText">{formatMoney(quote.funding.coverage[index].fundedCents)}</td></tr>)}</tbody></table></div>
    </section>
    {showSchedule && <section className="panel insetPanel"><div className="panelHeading"><div><h3>Collection schedule</h3><p className="sub">Calculated quote only. No payments have been requested or taken.</p></div><span className="pill">{quote.funding.paymentCount} payments</span></div><div className="scheduleScroll"><table><thead><tr><th>#</th><th>Date</th><th>Amount</th><th>Cumulative</th></tr></thead><tbody>{visiblePayments.map(({ payment, number }) => <tr key={payment.date}><td>{number}</td><td>{displayDate(payment.date)}</td><td>{formatMoney(payment.amountCents)}</td><td>{formatMoney(payment.cumulativeCents)}</td></tr>)}</tbody></table></div>{compact && <p className="scheduleOmitted">{payments.length - visiblePayments.length} intermediate payments omitted from this preview.</p>}{payments.length > 13 && <button type="button" className="textButton" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show fewer payments ↑" : "Show full schedule ↓"}</button>}</section>}
  </div>;
}
