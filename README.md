# Dashub DashPlan

BUILD-002 is a browser-local, financially sandboxed DashPlan prototype. Dashub is the master brand; DashPlan is the module; Service Plan is the customer product. [Product rules](docs/product-rules.md) are the authoritative specification.

## Run

```bash
npm install
npm test
npm run build
npm run dev -- --port 3210
```

Open `http://localhost:3210`. Sandbox state is stored under `dashub.dashplan.build-002.v1`; custom BUILD-001 records are copied forward on first launch. Seeded people, companies, quotes and transactions are fictional and labelled sandbox data.

## Included in BUILD-002

- Six-step Create Service Plan wizard with partial Save Draft/resume, customer matching, AutoCheck sandbox lookup/manual fallback, confirmed anchored forecasting and option-first manufacturer/dealer/custom plan selection.
- Weekly, fortnightly and monthly amounts shown together, future first-date recalculation and changed-instalment confirmation. The existing checkpoint funding engine still covers every predicted service and ends collection before the final service.
- Deliberate quote issue, configurable validity, unique numbering, expiry/lost/superseded history, shared dealer-group access, attribution, ownership and follow-up management.
- Real dependency-free PDF download/print with configured dealer text branding and no internal service allocation or fee data.
- Review → digital/physical signature → sandbox payment token → activation, with Awaiting First Payment → Live transition and two-recipient sandbox contract delivery log.
- Separate Sales Performance page with role-aware leaderboards, assignment-cohort conversion, branch/group/date/dimension filters, drillable records, previous-period figures and Excel-compatible XML export.
- Existing forecast, funding, claims, invoices, payouts, reversals, adjustments, cancellations, finance and role-aware dashboards remain available.

## Architecture and boundaries

`lib/domain` contains framework-free forecast, funding, operations, quote lifecycle, follow-up and performance logic. `lib/application/service-plans.js` enforces tenant/role boundaries and coordinates repository writes. `lib/documents` creates quote PDFs and Excel exports. Provider ports in `lib/adapters/sandbox-integrations.js` implement only AutoCheck-style sandbox lookup, payment-token setup and delivery logs.

No live Stripe/payment provider, AutoCheck, email, banking, Supabase or production service is connected. Card numbers and CVC are never requested or stored. Dashub/provider fee deduction is intentionally parked: configured commercial fields do not reduce customer service value, claims or dealer entitlements.
