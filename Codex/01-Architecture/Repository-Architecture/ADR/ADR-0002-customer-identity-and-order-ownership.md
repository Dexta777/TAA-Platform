# ADR-0002 — Customer Identity and Order Ownership

## Status

Accepted

## Context

TAA supports guest and authenticated checkout. Customer account data therefore needs a canonical
identity projection without turning transaction email addresses into permanent authorization.
Historical orders must remain stable when customers later edit profile or address data, and Stripe
customer linkage must remain a privileged server concern rather than a browser-writable profile
field.

The original schema contained both `profiles` and `customer_profiles`, duplicate order policies,
and email-derived access to orders, order items, and shipments. That ambiguity would allow a signed-in
user to see an unclaimed guest order solely because its historical email matched the current Auth
email.

## Decision

The canonical customer identity relationship is:

```text
auth.users
    ↓ one-to-one
customer_profiles
```

`customer_profiles.id` is the Auth user ID. The Auth trigger creates the profile and synchronizes
the authoritative Auth email, while customer-editable names and phone remain ordinary self-service
fields. `stripe_customer_id` is privileged server-managed linkage and is not directly writable by
authenticated browser clients.

Permanent Members Area order authorization is:

```text
orders.user_id = auth.uid()
```

Email remains historical transaction data. It may later contribute evidence to a separately
designed, verified guest-order claim workflow, but it is not ongoing authorization.

Guest orders remain `orders.user_id IS NULL` until that explicit workflow associates them with an
authenticated user. This decision neither claims existing guest orders nor creates an implicit
claim path.

Orders and order items retain their transactional snapshots independently of mutable customer
profiles and saved addresses. Stripe remains authoritative for payment state and sensitive payment
credentials; TAA stores only the existing bounded payment and fulfilment snapshots needed for the
order lifecycle.

## Reasoning

An immutable Auth user ID provides a stable authorization key, while email addresses can be changed,
reused, mistyped, or shared. Separating saved customer data from historical order snapshots prevents
later profile edits from rewriting the facts of a completed transaction. Keeping Stripe linkage
server-managed prevents browser users from attaching their account to an arbitrary Stripe customer.

## Alternatives Considered

### Keep Email as a Secondary Permanent Authorization Path

Rejected. Matching email is not proof that an authenticated user owns a historical guest order and
creates an IDOR/BOLA risk.

### Automatically Claim Existing Guest Orders by Email

Rejected for this slice. A claim requires an explicit, independently verified ownership workflow and
must not be inferred during schema cleanup.

### Normalize Historical Orders onto Current Profiles and Addresses

Rejected. It would couple completed transactions to mutable account records and weaken auditability.

### Allow Customers to Manage Stripe Customer IDs Directly

Rejected. Stripe customer linkage is trusted integration state and belongs to service-side checkout
and webhook paths.

## Consequences

### Benefits

- Account authorization uses a stable, explicit user ID.
- Matching email alone cannot expose guest orders, items, or shipments.
- Guest orders remain untouched until a dedicated claim design is approved.
- Profile and address edits cannot rewrite historical transaction snapshots.
- Browser clients cannot replace privileged Stripe linkage.

### Costs

- A future guest-order claim workflow must establish ownership and then set `orders.user_id`
  explicitly.
- Address default switching may require an atomic UI/RPC design if one request must clear the old
  default and set the new one.
- Account clients must treat Auth email and server-managed timestamps as read-only.

## Rectification Conditions

Reconsider this decision only if TAA adopts a stronger stable customer-identity authority that can
preserve explicit order ownership, guest isolation, Stripe authority, and immutable transaction
history.

## Related Documents

- [Reservation-Owned Checkout Finalization](ADR-0001-reservation-owned-checkout-finalization.md)
- [Repository Architecture](../README.md)
- [Accounts](../../../04-Product/Accounts.md)
- [Orders](../../../04-Product/Orders.md)

────────────────────────────────────────────

The Atelier Doctrine

"Every iteration approaches perfection without claiming it."

Authority:
High

Status:
Accepted

Rectification:
0
