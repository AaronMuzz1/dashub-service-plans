# Locked Service Plans rules

## Core
- Dashub is the contracting party and centrally administers customer payments.
- SP is independently licensable from Project Blackbook.
- Active SP subscription is required to sell or claim.
- Manufacturer/global plans are centrally locked; dealer plans are dealer-group wide.
- Advisors may create ad-hoc dealer plans. Template/pricing permissions are configurable.

## Plans
- Length is number of services.
- Forecast uses current odometer, predicted annual kilometres and manufacturer months/km interval, whichever occurs first.
- Contracted service prices are fixed once sold.
- GST inclusive or exclusive entry is supported.
- Customer details required: first name, last name, mobile, email, physical address.
- VIN is retrieved where available but is not mandatory if unavailable.

## Payments
- Weekly default; fortnightly/monthly optional; selectable first payment date.
- Payment engine must fund each service by predicted due point and finish collections before final service.
- Missed payments do not suspend the plan; provider retries are supported.
- Customer may top up to the remaining contractual amount and may pay out early without discount/penalty.
- Payment frequency fixed in V1. No payment holidays.
- Dashub Admin may change collection date/day on customer request.

## Claims
- Sequential services only.
- Claim requires odometer, RO, service date, completed confirmation and any dealer-collected shortfall.
- 30+ days before predicted due date is flagged Early Claim.
- Claim immediately marks entitlement CLAIMED and generates a unique PO.
- Dealer sends one invoice per service claim referencing PO.
- Invoice auto-match tolerance ±$0.05; unmatched items go to exception review.
- Weekly consolidated dealer payout with remittance.
- Dealership Manager may reverse claims; paid reversals remain as financial adjustments.

## Revisions and cancellation
- Plans can be extended/reforecast with customer consent and a new immutable contract revision.
- Cancellation refund uses cleared funds less claimed services and cancellation fee; setup fee is non-refundable after activation.
- Refund through payment provider where possible with manual fallback.
- Vehicle sale can cancel/refund, transfer plan to new owner, or transfer funds to a replacement vehicle/new plan.
- Proposed forfeiture: 12 months after next pending service due date, subject to legal review.

## Commercial
- Dashub setup fee charged immediately at activation.
- Dashub ongoing fee and payment-provider fee treatment configurable by program/dealer.
- Dashub is the only separate setup/admin fee.
- Commercial terms are snapshotted at activation.
- Manufacturer plans use centrally locked economics and common service payout values.

## Customer portal
- Shows total plan value but not individual service values or accumulated cash balance.
- Shows services, next predicted service, payment schedule/history, contract, top-up and payment-method update.
- Customer cannot change mileage/forecast.
- Branding/support routing is configurable.

## Distribution
- Global manufacturer plans are accessible to authorised SP dealers tied to the manufacturer account.
- Dealer plans are accessible across the dealer group's branches.
- Dealer templates may be restricted to selected selling branches.
- Sales attribution records dealer group, branch, advisor and quote creator.
