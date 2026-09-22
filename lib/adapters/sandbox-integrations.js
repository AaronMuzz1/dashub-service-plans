// These ports describe the future live adapters. The sandbox deliberately
// fails closed if a future workflow accidentally tries to call one.
export class IntegrationUnavailableError extends Error {
  constructor(name) { super(`${name} is not connected in BUILD-001.`); this.name = "IntegrationUnavailableError"; }
}

const unavailable = (name) => async () => { throw new IntegrationUnavailableError(name); };

export const sandboxIntegrations = Object.freeze({
  paymentProvider: Object.freeze({
    connected: false,
    createCollectionSchedule: unavailable("Payment provider"),
    collect: unavailable("Payment provider"),
    retry: unavailable("Payment provider"),
    refund: unavailable("Payment provider"),
  }),
  vehicleLookup: Object.freeze({ connected: false, lookupVin: unavailable("Vehicle lookup") }),
  emailSender: Object.freeze({ connected: false, send: unavailable("Email sender") }),
});
