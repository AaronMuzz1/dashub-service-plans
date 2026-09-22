# Dashub Service Plans

BUILD-001 is a browser-local, financially sandboxed Service Plans operating prototype. [Product rules](docs/product-rules.md) remain the authoritative specification. It runs independently of Project Blackbook and uses the existing Dashub visual system.

## Run

```bash
npm install
npm test
npm run build
npm run dev
```

Open the local URL printed by Next.js. The app stores its sandbox workspace in this browser's `localStorage` under `dashub.service-plans.build-001.v2`. A fresh browser profile seeds three dealer groups, five branches, four selectable personas, dealer and locked manufacturer templates, and representative quote, funding, claim, invoice, payout, completion and expiry scenarios. Existing v1 local quotes are copied into the new workspace on first launch.

## Workflow

- Create Plan captures customer and vehicle details, current odometer, annual km, month/km intervals, service count, manually selected and GST-priced services, payment frequency and first date. It forecasts the earlier month/km due point and presents the quote and collection schedule.
- Funding uses integer cents and checks cumulative coverage at **every** predicted service. A same-day collection is not assumed cleared; collections end before the final service. Weekly is the default, with fortnightly and monthly options.
- An authorised user activates a dealer quote into a local contract with fixed service values, commercial terms and revision 1. The payment schedule and setup fee are snapshotted. Subscription access is checked at activation and claims.
- Plan Detail shows customer, vehicle, contract, entitlements, predicted due points, schedule, payment events, claims, revisions and audit. Sandbox controls record payment success, failure, successful retry and capped top-ups. A failed payment leaves the plan active.
- Claims enforce the next unclaimed entitlement, completed confirmation, RO, date, odometer and exact dealer-collected shortfall. A claim 30+ days early is flagged and logged, then immediately marked claimed with an SP PO. Dealer shortfalls reduce the remaining customer obligation.
- Inbound dealer invoice simulation accepts one invoice per PO. A value within ±$0.05 matches; other values enter the exception queue for Dashub Admin review. Matched invoices can be grouped into the next weekly branch payout with gross, Dashub/provider fees and net remittance lines. Marking paid only updates sandbox status.
- Dealership Managers can reverse claims in their dealer group, and Dashub Admin can reverse any claim. Reversal requires a reason, restores the entitlement and funding, voids the PO and any invoice while retaining their history, and records complete before/after snapshots. A scheduled payout loses its claim line but retains a voided remittance copy. A completed payout remains immutable; a negative dealer adjustment is carried into the next weekly payout, with partial offsets supported.
- Finance has drilldowns for collections, future dates, failures/retries, obligations, claims, invoices, payable items, payouts, fees, refunds, forfeiture and proposed expiry review. Dashub Admin can inspect dealer groups, branches, subscriptions, module access and user permissions. Dealer templates hold service sequences and default prices; manufacturer templates remain locked.

## Boundaries

`lib/domain` holds quote, forecast, funding, ledger, claims, invoice, payout and finance calculations without React or persistence. `lib/application/service-plans.js` applies access rules and coordinates repository writes. `lib/adapters/manual-service-source.js` is the current service proposal source; a future service-table/PB adapter can implement the same port without introducing a PB dependency. `local-plan-repository.js` is the workspace persistence adapter. `sandbox-integrations.js` keeps payment, lookup and email ports disconnected.

All customers and transactions here are fictional. No Stripe, AutoCheck, Supabase, inbound email, banking or real payment service is connected. In particular, a sandbox “paid”, “refund” or reversal adjustment status does not move funds. Manufacturer administration, customer portal, live settlement, consent-driven plan extensions and vehicle transfers require subsequent work before production use.
