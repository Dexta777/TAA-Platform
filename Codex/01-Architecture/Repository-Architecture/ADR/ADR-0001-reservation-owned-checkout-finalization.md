# ADR-0001 — Reservation-Owned Checkout Finalization

## Status

Accepted

## Context

A Checkout Session can become paid after catalogue availability was checked. Without a durable
reservation, another checkout or an operator adjustment can consume the same physical stock before
order finalization. Stripe can also deliver duplicated or out-of-order lifecycle events, and a
network failure can leave Session creation externally successful but locally unrecorded.

## Decision

Reservation-v1 checkout uses one attempt-owned inventory reservation across Checkout Session
replacement. PostgreSQL owns atomic reservation consumption, physical stock decrement, order and
order-item creation, discount redemption, and paid attempt state.

Stripe remains the authority for whether a Checkout Session is paid, processing, open, or expired.
The webhook and a private scheduled reconciler retrieve Stripe state before requesting a database
transition. Local time only makes work eligible for reconciliation; it never releases stock by
itself.

All multi-resource reservation-v1 transitions acquire locks in this order:

```text
checkout attempt
→ inventory reservation
→ checkout intents ordered by UUID
→ products ordered by UUID
→ product variants ordered by UUID
→ order records
```

Ambiguous external state retains the reservation. Paid states that cannot safely become an order
are persisted as PII-free lifecycle incidents and enter durable manual review rather than being
discarded or retried indefinitely by Stripe.

## Reasoning

The attempt is the stable owner shared by Session replacements. Locking it first serializes all
paths that could consume or release the same reservation. Keeping Stripe authority outside the
database prevents local deadlines from inventing external payment truth, while small service-only
database transitions preserve atomic business invariants.

## Alternatives Considered

### Finalization-Time Availability Check Only

This prevents negative inventory but can leave a paid transaction without an order.

### Automatically Release at the Local Deadline

This can release stock while a delayed payment or externally ambiguous Session remains payable.

### Consume Reservation Before Creating the Order

Separate commits introduce a new partial-failure state. Consumption and order creation therefore
remain one PostgreSQL transaction.

## Consequences

### Benefits

- Paid finalization consumes stock and creates the order exactly once.
- Session replacement retains one immutable cart and one reservation.
- Expiry, failure, payment, and reconciliation races serialize on one ownership root.
- Operationally broken paid states remain visible and recoverable.

### Costs

- The webhook and reconciler must validate Stripe and PostgreSQL identifiers rigorously.
- Ambiguous cases can hold stock until reconciliation or manual review completes.
- Operators need alerts and a runbook for lifecycle incidents.

## Rectification Conditions

Reconsider this decision if Stripe introduces a sufficiently strong first-party reservation and
order transaction that can preserve TAA's stock, discount, and audit invariants without split
authority.

## Related Documents

- [Repository Architecture](../README.md)
- [Checkout production blockers](../../../../../docs/checkout-production-blockers.md)

────────────────────────────────────────────

The Atelier Doctrine

"Every iteration approaches perfection without claiming it."

Authority:
High

Status:
Accepted

Rectification:
0
