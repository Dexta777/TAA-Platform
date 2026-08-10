# Checkout Sessions production blockers

## Inventory race after Session creation

The checkout validates current stock when it creates a Checkout Session, but it does not reserve
that stock. Inventory can therefore change before payment completes. The atomic finalizer correctly
refuses to oversell, but that means a successfully paid Checkout Session can still fail order
finalization.

This is a production blocker. Before cutover, choose and implement one of these recovery models:

1. Reserve inventory for a bounded period when the Session is created, then release it when the
   Session expires or checkout is abandoned.
2. Keep finalization-time stock validation and add a reliable automatic refund plus customer and
   operations notification path for paid checkouts that cannot be fulfilled.

## Klaviyo delivery after webhook replay

Klaviyo delivery is intentionally best effort and happens only after a newly finalized order. If
Klaviyo fails after the transaction commits, a replay sees the order as already finalized and does
not retry the event. This is not an order-integrity failure, but it requires a durable outbox or an
equivalent retry mechanism before Klaviyo delivery can be considered reliable.

## Public checkout endpoint abuse protection

`create-checkout-session` is intentionally public so guest checkout can create a Session. It uses
privileged server-side Supabase access internally after independently validating catalogue and
shipping data. Before meaningful production traffic, the public checkout endpoints require an
appropriate rate-limiting and abuse-protection layer.

The current permissive CORS policy must also be restricted to approved TAA production and staging
origins before production cutover. CORS is browser defence-in-depth only; it is not authentication
and does not prevent direct requests to a public Edge Function.
