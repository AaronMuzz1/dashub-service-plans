# Locked DashPlan product rules

## Naming and scope

- Dashub is the master brand, DashPlan is the module, and a Service Plan is the customer product.
- Customer and operational language uses Create Service Plan, Service Plan Quote, Service Plan contract and Claim a Service. Internal database names do not need cosmetic renaming.
- DashPlan is independently licensable from Project Blackbook. An active DashPlan subscription is required to sell or claim.
- Manufacturer programs are centrally authorised and pricing-locked. Dealer plans and templates are dealer-group scoped and may be branch-restricted. Advisor permissions control custom plan creation and dealer pricing.

## Create Service Plan

- Creation is a compact six-step workflow with a fixed desktop step sidebar and independently scrollable main content.
- Save Draft is available at every step. A draft preserves partial values and the current step, is shared inside the authorised dealer group, and never counts as an issued quote.
- Customer entry starts with first and last name. Matching dealer-group customers appear beneath the form with distinguishing contact and vehicle details. Selecting a match populates the form; ignoring it creates a separate customer and never automatically merges records.
- Vehicle entry starts with registration. Vehicle lookup uses an AutoCheck provider port; BUILD-002 supplies a clearly labelled sandbox lookup and manual fallback. Make, model, year, VIN and variant are prefilled where available. VIN remains optional.
- Service interval inputs are last completed service date/odometer, current odometer, predicted annual kilometres, interval kilometres/months and service count. Provider or template suggestions require explicit Advisor confirmation and retain audit history.
- Forecasts remain anchored to the last completed service position. Every future service advances the fixed manufacturer time/km cycle and is predicted at whichever threshold occurs first. Overdue/due-now states and the full forecast remain visible.
- After vehicle and interval details, the Advisor sees applicable authorised manufacturer plans, dealer templates and Create Custom Plan. The system must not require an abstract technical plan type first.
- Manufacturer plan pricing and supplied descriptions are locked at the service layer. A custom plan generates sequential service lines for the chosen count. Detailed inclusions appear in customer documents only when they were explicitly supplied; the system never invents inclusions.

## Payments and funding

- Weekly is selected by default. Weekly, fortnightly and monthly calculated amounts appear together.
- The first payment defaults to the next normal cycle after activation intent: seven days for weekly, fourteen days for fortnightly and one calendar month for monthly.
- An Advisor may select any future first-payment date without a hard deferral limit. The complete schedule recalculates. If the regular instalment changes, the old amount, new amount and difference are shown and explicit confirmation is required before issue or activation.
- The funding engine uses integer cents, covers cumulative service value at every predicted service, never assumes a same-day collection has cleared, and completes collections before the final predicted service.
- Payment frequency remains fixed after activation in V1. There are no payment holidays. Dashub Admin may change a collection date/day on customer request in a later operational workflow.
- Missed payments do not cancel or suspend entitlements; provider retries are supported. Customers may top up or pay the remaining contractual amount early without a discount or penalty.

## Drafts and issued quotes

- An issued quote exists only after an explicit Issue Quote action. Quote emailing is not part of BUILD-002; Advisors download a real PDF and use dealership email.
- An issued quote has a unique quote number, issue/expiry dates, immutable pricing, creator, quoting Advisor, current owner and attribution/audit history.
- Default validity is 30 days. Dealer-group validity is configurable for dealer plans; manufacturer-program validity is configurable centrally. Advisors cannot override it per quote.
- Expiry automatically closes an outstanding quote as Lost with reason Quote Expired. Issued quote history is retained permanently.
- Manual Lost reasons are Customer declined, Price, Purchased elsewhere, Vehicle sold/traded, No longer required, Unable to contact and Other.
- A material edit creates a new quote number and validity period. The prior issued quote becomes Superseded and is not counted as Lost. Historical issued snapshots are never overwritten.
- A valid issued quote honours its quoted pricing after template changes. An expired quote must be refreshed and reissued before activation.
- A sale may proceed directly from Review without issuing a quote. It is attributed as a direct Service Plan sale and is excluded from quote-conversion denominators.
- Drafts and quotes are shared inside the authorised dealer group. Records preserve original creator, current editor, quoting Advisor, current owner, selling Advisor, assignment history and full audit history.
- Plans is organised as Drafts, Quotes, Active Plans, Completed and Lost / Cancelled, with tenant-scoped search and filters.

## Customer review and quote PDF

- Final Review is customer-facing and contains customer/vehicle, services, supplied inclusions, predicted service points, total value and all three payment options.
- Internal funding checkpoint maths, service allocation values, Dashub fees and dealer economics do not appear on customer review or quote PDF.
- The downloadable/printable PDF contains configured dealer identity/contact details (with a clean text fallback), customer/vehicle, services and predicted points, supplied inclusions, total Service Plan value, three payment options, quote number and dates, and the footer “Service Plan administered by Dashub”. No invented dealer asset is used.

## Activation and contract delivery

- The sequence is Final Review → customer signature → payment-method setup → Activate Plan.
- Digital signature evidence is captured directly on device and retained with the signed contract version. For physical signing, the Advisor confirms that the dealership holds the signed original; Advisor identity, timestamp and contract version are recorded.
- Signature alone and payment setup alone never activate a plan. Both are mandatory at the service layer.
- Payment setup uses a provider port. BUILD-002 creates only a sandbox token and never requests, captures or stores a real card number or CVC. Live Stripe is not connected.
- Successful activation creates internal status Active — Awaiting First Payment. A cleared first scheduled payment changes it to Live. Failure keeps it awaiting first payment with retry history. No separate “Live” email is sent.
- If a customer-funded setup fee is configured, it is attached to the first scheduled collection and its retries; it is not charged at activation.
- Activation logs delivery of the completed contract to the customer email and dealer-group Service Plans administration email through an email provider port. BUILD-002 retains a sandbox delivery log and never claims a live email was sent.
- The success screen says “Congratulations, your Service Plan is live!” for the customer, while clearly showing internal Awaiting First Payment where relevant. It includes vehicle, service count, payment amount/frequency, first date, delivery status, View Plan, Print Summary and Finish.

## Commercial fees (parked)

- BUILD-001 rules that charged the setup fee immediately and deducted ongoing/provider fees from dealer payouts are superseded.
- Dealer-entered or authorised service values determine the customer Service Plan value. Customer payments fund those values, and claims/refunds reconcile against those values.
- Dashub/provider commercial configuration fields may be retained for future extensibility, but BUILD-002 does not deduct, gross up, recover or alter dealer entitlements for those fees. Dashub may charge dealers separately outside the Service Plan after a future commercial decision.

## Quote follow-up

- Issued quotes default to the issuing Advisor for ownership and conversion responsibility. Any authorised dealer-group Advisor may view/action follow-ups and take ownership; Managers may reassign. Every change is audited.
- Dealer-group defaults are first follow-up after 7 days, second after 14 days and final follow-up approaching expiry. Timing is configurable, and an Advisor may override the next date.
- Outcomes are Contacted, No Answer, Customer Considering, Follow-up Required and Declined. Every action records notes, Advisor, timestamp, outcome and next date.
- Due/overdue items appear in role-aware attention data. Duplicate action IDs are rejected. Follow-ups stop when a quote is Sold, Lost, Expired or Superseded.

## Attribution and Sales Performance

- Quotes Issued credit the issuing Advisor. Plans Sold credit the Advisor who completes activation. Conversion credit belongs to the selling Advisor, while original quote attribution remains unchanged.
- At activation, an issued quote is automatically assigned to the selling/converting Advisor when necessary; no manual transfer is required.
- The assignment-cohort denominator is each distinct issued quote’s single current/conversion owner for the selected issue cohort. The numerator is assigned quotes converted by that Advisor. Outstanding quotes stay in the denominator, later conversions update the cohort, reassignments never double-count, direct sales are excluded and rates are capped at 100%.
- Sales Performance is a separate navigation page, not part of the Advisor Dashboard.
- Advisor view includes own performance/history and leaderboards ranked by Plans Sold and Quotes Issued. All eligible sales Advisors and Managers, including zero-activity users, appear. There is no dollar ranking and no target feature.
- Dealer Group is the default scope; Branch is optional. Periods are Current Month (default), Previous Month, Quarter, Year and Custom Range.
- Manager/Dealer Admin reporting includes issued/sold/direct/outstanding/lost/expired/conversion metrics, due/completed/overdue follow-ups, conversions after follow-up, Advisor and branch comparisons, brand/model drilldowns, monthly trends, previous-equivalent comparison and lost reasons.
- Filters include Advisor, branch, brand, model, plan type and date. Summary records drill into underlying authorised records. Dashub Admin may report across authorised tenants.
- Excel export reflects the current filters and contains appropriate Advisor, dealer group/branch, vehicle, quote, sale, conversion and follow-up dimensions.

## Claims, settlement and cancellation

- Services are claimed sequentially. A claim requires odometer, RO, service date, completion confirmation and any exact dealer-collected shortfall. Claims 30+ days before prediction are flagged Early Claim.
- Claim immediately marks the entitlement claimed and creates a unique Service Plan PO. One dealer invoice is allowed per claim/PO; ±$0.05 auto-matches and other values enter exception review.
- Weekly dealer payouts retain gross service entitlements. Paid reversals remain immutable financial adjustments; unpaid reversals void their PO/invoice/payout line while preserving history.
- Contract revisions are immutable and require customer consent. Cancellation uses cleared Service Plan funds less claimed services and any cancellation fee. Setup-fee treatment remains separate from service entitlement.
- Vehicle sale can cancel/refund, transfer ownership or move funds into a replacement vehicle/new plan in a future workflow. Proposed forfeiture at 12 months after the next pending service due date remains subject to legal review and is not automatic.

## Security, performance and integrations

- Tenant boundaries and role permissions are enforced in application/domain services, not only by hiding controls.
- Form state stays local to the wizard so typing does not rerender the full workspace.
- Empty states are explicit. Seed data is labelled sandbox data; no fake operational totals are presented.
- BUILD-002 does not deploy, send live email, connect live payment/AutoCheck services, merge the draft PR or alter production data.
