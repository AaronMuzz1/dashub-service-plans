# Dashub Service Plans

BUILD-001 is a local, financially sandboxed Service Plans quote prototype. [Product rules](docs/product-rules.md) are the authoritative specification. The app uses the existing Dashub visual system and runs independently of Project Blackbook.

## Run locally

```bash
npm install
npm test
npm run dev
```

Open the URL printed by Next.js. `npm run build` checks the production bundle.

## Create Plan workflow

The six-step workflow captures required customer and vehicle details (VIN optional), current odometer, predicted annual kilometres, month and kilometre service intervals, plan length as number of services, manual service descriptions and GST-inclusive or exclusive prices, payment frequency and first payment date. It shows forecast service dates and odometer readings, a funded collection schedule, and a final quote summary. Weekly collections are the default; fortnightly and monthly are available.

Service due dates use the earlier of the cumulative month or kilometre threshold from the quote date. The funding engine prices one regular installment as the maximum amount needed at *any* cumulative service checkpoint. It caps the last payment at the exact plan value and counts collections only when scheduled strictly before the service date, since a date-only same-day collection cannot be assumed cleared. If the chosen first date cannot fund an earlier service, the quote is rejected. Calculations use integer cents, with GST rounding per service.

## Architecture and sandbox boundaries

- `lib/domain` contains date, money, forecast, quote and funding logic without React or persistence dependencies.
- `lib/application/service-plans.js` enforces dealer group and pricing/edit permissions when saving quotes. Manufacturer records are readable to authorised dealers but cannot be edited through the dealer workflow.
- `lib/adapters/manual-service-source.js` is the current proposal source. A service-table or PB adapter can implement `getProposals(context)` later; Service Plans has no PB dependency. Quote records snapshot selected service names, prices and due points.
- `lib/adapters/local-plan-repository.js` saves only to this browser's `localStorage`. First launch creates two clearly fictional example quotes, including one locked manufacturer plan.
- `lib/adapters/sandbox-integrations.js` exposes payment, vehicle lookup and email ports that fail closed until live adapters are injected. The plan repository port can later use remote persistence. No Stripe, AutoCheck, Supabase, email or financial service is called.

BUILD-001 saves **quotes only**. It does not activate contracts, collect or retry payments, process claims, calculate fees, send messages or operate the customer portal. Those flows require separate implementation and production adapters before any live use.
