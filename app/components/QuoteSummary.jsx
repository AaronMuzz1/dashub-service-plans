import { formatMoney } from "../../lib/domain/money.js";

const numberFormat = new Intl.NumberFormat("en-NZ");
export function displayDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export function Metric({ label, value, note }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

export default function QuoteSummary({ quote, origin }) {
  return <div className="summaryStack">
    <div className="summaryHero">
      <div><span className="eyebrow">{origin === "manufacturer" ? "Authorised manufacturer Service Plan" : "Dealer Service Plan"}</span><h2>{quote.customer.firstName} {quote.customer.lastName}</h2><p>{quote.vehicle.year} {quote.vehicle.make} {quote.vehicle.model}{quote.vehicle.variant ? ` ${quote.vehicle.variant}` : ""}{quote.vehicle.registration ? ` · ${quote.vehicle.registration}` : ""}</p></div>
      <div className="summaryTotal"><span>Total Service Plan value · GST incl.</span><strong>{formatMoney(quote.funding.totalCents)}</strong></div>
    </div>
    <div className="summaryMetrics">
      {Object.values(quote.paymentOptions).map((option) => <Metric key={option.frequency} label={option.label} value={formatMoney(option.installmentCents)} note={`From ${displayDate(option.firstPaymentDate)} · ${option.paymentCount} collections`} />)}
    </div>
    <section className="panel insetPanel"><div className="panelHeading"><div><h3>Included services and predicted service points</h3><p className="sub">Predictions are based on the confirmed service interval and expected vehicle usage.</p></div><span className="pill">{quote.numberOfServices} services</span></div>
      <div className="tableScroll"><table><thead><tr><th>Service</th><th>Predicted due</th><th>Scheduled odometer</th><th>Inclusions supplied</th></tr></thead><tbody>{quote.services.map((service, index) => <tr key={index}><td><strong>{service.name}</strong><small>{service.trigger === "km" ? "Kilometre threshold" : "Time threshold"}{service.dueState === "overdue" ? " · Overdue" : service.dueState === "due_now" ? " · Due now" : ""}</small></td><td>{displayDate(service.predictedDate)}</td><td>{numberFormat.format(service.scheduledKm ?? service.predictedKm)} km</td><td>{service.description || "No detailed inclusions supplied"}</td></tr>)}</tbody></table></div>
    </section>
    <p className="customerReviewNote">The selected payment frequency is <strong>{quote.paymentOptions[quote.frequency].label}</strong> at <strong>{formatMoney(quote.funding.installmentCents)}</strong> from {displayDate(quote.firstPaymentDate)}. The final instalment may be lower.</p>
  </div>;
}
