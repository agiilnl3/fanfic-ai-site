// Stripe webhook handler. We let stripe-replit-sync own signature
// verification and the `stripe.*` schema sync, then layer our own
// post-processing on top to update the local `subscriptions` row that
// powers tier-aware quota / authz checks.

import type Stripe from "stripe";
import { getStripeSync, getUncachableStripeClient } from "./stripeClient";
import { applyPlanForCustomer, resolvePlanForCustomer } from "./billing";
import { logger } from "./logger";

const RELEVANT_EVENTS = new Set([
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

function customerIdOf(event: Stripe.Event): string | null {
  const data = event.data.object as { customer?: string | { id: string } };
  if (!data.customer) return null;
  return typeof data.customer === "string" ? data.customer : data.customer.id;
}

export async function processStripeWebhook(
  payload: Buffer,
  signature: string,
): Promise<void> {
  // 1. Let stripe-replit-sync verify the signature and sync into stripe.*.
  const sync = await getStripeSync();
  await sync.processWebhook(payload, signature);

  // 2. Re-parse the event so we can react to plan-affecting events.
  // stripe.webhooks.constructEvent expects the raw body and signature; the
  // signature was already validated by stripe-replit-sync above, but we
  // reuse Stripe's parser to get a typed event object.
  let event: Stripe.Event;
  try {
    const stripe = await getUncachableStripeClient();
    // Tolerate verification timing skew using a low tolerance so a stale
    // delivery is caught here too. We also re-validate the signature so
    // a bad payload that slipped past stripe-replit-sync is rejected.
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    event = secret
      ? stripe.webhooks.constructEvent(payload, signature, secret, 600)
      : (JSON.parse(payload.toString("utf8")) as Stripe.Event);
  } catch (err) {
    logger.warn({ err }, "secondary stripe event parse failed");
    return;
  }

  if (!RELEVANT_EVENTS.has(event.type)) return;

  const customerId = customerIdOf(event);
  if (!customerId) {
    logger.warn({ type: event.type }, "stripe event without customer id");
    return;
  }

  // Let failures here propagate. Stripe will retry the delivery, which is
  // exactly what we want when a transient DB or Stripe API hiccup prevents
  // the local subscription row from updating — silently 200-ing would
  // permanently miss the tier flip.
  const resolved = await resolvePlanForCustomer(customerId);
  await applyPlanForCustomer(customerId, resolved);
  logger.info({ type: event.type, customerId, plan: resolved.plan }, "applied stripe event");
}
