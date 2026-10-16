import { addDays, addMonths, parseDateOnly } from "./dates.js";

export const PAYMENT_FREQUENCIES = Object.freeze({ weekly: "Weekly", fortnightly: "Fortnightly", monthly: "Monthly" });

function paymentDate(firstPaymentDate, frequency, index) {
  if (frequency === "weekly") return addDays(firstPaymentDate, index * 7);
  if (frequency === "fortnightly") return addDays(firstPaymentDate, index * 14);
  if (frequency === "monthly") return addMonths(firstPaymentDate, index);
  throw new Error("Choose a payment frequency.");
}

/**
 * Find the lowest uniform installment that covers every cumulative entitlement.
 * The final installment is capped at the exact remaining contract value.
 * All candidate collections are strictly before the final predicted service.
 */
export function calculateFunding({ services, firstPaymentDate, frequency = "weekly" }) {
  parseDateOnly(firstPaymentDate);
  if (!Array.isArray(services) || services.length === 0) throw new Error("Add at least one service.");
  if (!PAYMENT_FREQUENCIES[frequency]) throw new Error("Choose a payment frequency.");
  let previousDate = "0000-00-00";
  let totalCents = 0;
  const milestones = services.map((service, index) => {
    parseDateOnly(service.predictedDate);
    if (service.predictedDate <= previousDate) throw new Error("Predicted service dates must be in order.");
    previousDate = service.predictedDate;
    if (!Number.isSafeInteger(service.grossCents) || service.grossCents <= 0) {
      throw new Error(`Service ${index + 1} needs a price greater than zero.`);
    }
    totalCents += service.grossCents;
    if (!Number.isSafeInteger(totalCents)) throw new Error("Plan total is out of range.");
    return { serviceNumber: index + 1, predictedDate: service.predictedDate, requiredCents: totalCents };
  });

  const finalServiceDate = milestones.at(-1).predictedDate;
  const candidateDates = [];
  for (let index = 0; index < 3000; index++) {
    const date = paymentDate(firstPaymentDate, frequency, index);
    if (date >= finalServiceDate) break;
    candidateDates.push(date);
  }
  if (!candidateDates.length) throw new Error("Choose a first payment date before the final service.");
  if (candidateDates.length === 3000) throw new Error("Plan term is too long to calculate.");

  const coverageTargets = milestones.map((milestone) => {
    // Date-only collection records have no settlement time. Count only payments
    // scheduled before a service, never a payment on the service date itself.
    const eligiblePayments = candidateDates.filter((date) => date < milestone.predictedDate).length;
    if (!eligiblePayments) throw new Error(`First payment is too late to fund service ${milestone.serviceNumber}.`);
    return { ...milestone, eligiblePayments, requiredInstallmentCents: Math.ceil(milestone.requiredCents / eligiblePayments) };
  });
  const installmentCents = Math.max(...coverageTargets.map((target) => target.requiredInstallmentCents));
  let collectedCents = 0;
  const payments = [];
  for (const date of candidateDates) {
    if (collectedCents === totalCents) break;
    const amountCents = Math.min(installmentCents, totalCents - collectedCents);
    collectedCents += amountCents;
    payments.push({ date, amountCents, cumulativeCents: collectedCents });
  }
  const coverage = coverageTargets.map((target) => {
    const fundedCents = payments.filter((payment) => payment.date < target.predictedDate).at(-1)?.cumulativeCents ?? 0;
    return { ...target, fundedCents, surplusCents: fundedCents - target.requiredCents };
  });
  if (collectedCents !== totalCents || coverage.some((target) => target.surplusCents < 0)) {
    throw new Error("A valid funding schedule could not be calculated.");
  }
  return {
    totalCents,
    installmentCents,
    paymentCount: payments.length,
    finalPaymentCents: payments.at(-1).amountCents,
    finalPaymentDate: payments.at(-1).date,
    payments,
    coverage,
  };
}
