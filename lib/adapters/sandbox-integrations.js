// BUILD-002 provider ports. Every implementation is deliberately sandbox-only:
// no live vehicle, payment, or email service is contacted.
const vehicles = Object.freeze({
  "ABC123": { registration: "ABC123", make: "Toyota", model: "RAV4", year: "2023", vin: "JTMB1234567890123", variant: "GX 2.5 Hybrid", intervalMonths: "12", intervalKm: "15000" },
  "DP2026": { registration: "DP2026", make: "Mazda", model: "CX-5", year: "2024", vin: "JM0KF123456789012", variant: "GSX", intervalMonths: "12", intervalKm: "15000" },
  "EV1000": { registration: "EV1000", make: "Hyundai", model: "Ioniq 5", year: "2025", vin: "", variant: "72.6 kWh", intervalMonths: "12", intervalKm: "15000" },
});

const key = () => globalThis.crypto?.randomUUID?.() ?? `sandbox-${Date.now()}-${Math.random()}`;

export const sandboxIntegrations = Object.freeze({
  paymentProvider: Object.freeze({
    connected: false,
    mode: "sandbox",
    setupPaymentMethod({ customerName }) {
      return { provider: "sandbox", token: `pm_${key()}`, display: "Sandbox payment method •••• 4242", customerName, live: false };
    },
  }),
  vehicleLookup: Object.freeze({
    connected: false,
    mode: "sandbox",
    provider: "AutoCheck sandbox",
    lookupRegistration(registration) {
      const normalised = String(registration ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      return vehicles[normalised] ? { ...vehicles[normalised], source: "autocheck_sandbox" } : null;
    },
  }),
  emailSender: Object.freeze({
    connected: false,
    mode: "sandbox",
    deliver({ to, subject, documentName }) {
      return { id: `mail_${key()}`, to, subject, documentName, status: "sandbox_logged", deliveredAt: new Date().toISOString(), live: false };
    },
  }),
});
