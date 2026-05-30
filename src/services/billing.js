// src/services/billing.js
//
// Stripe subscription billing. Subscription model: $100/mo with a first-month
// 50% coupon (→ $50). Subscription status is mirrored onto the users table from
// Stripe webhooks (the source of truth — not the post-checkout redirect).
//
// Degrades gracefully: if STRIPE_SECRET_KEY is unset, isEnabled() is false and
// the gate fails OPEN (app stays usable pre-launch).

import Stripe from 'stripe';
import { query } from './db.js';

const KEY = process.env.STRIPE_SECRET_KEY;
const stripe = KEY ? new Stripe(KEY) : null;
const APP_URL = process.env.APP_URL || 'https://kempzonline.com';
const ACTIVE = ['active', 'trialing'];

export function isEnabled() {
  return !!stripe;
}
export function isSubscribed(user) {
  return !!user && ACTIVE.includes(user.subscription_status);
}

export async function getOrCreateCustomer(user) {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name || undefined,
    metadata: { userId: String(user.id) },
  });
  await query(`UPDATE users SET stripe_customer_id = $1, updated_at = now() WHERE id = $2`, [customer.id, user.id]);
  return customer.id;
}

export async function createCheckoutSession(user) {
  if (!process.env.STRIPE_PRICE_ID) throw new Error('STRIPE_PRICE_ID not set');
  const customer = await getOrCreateCustomer(user);
  const params = {
    mode: 'subscription',
    customer,
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    client_reference_id: String(user.id),
    success_url: `${APP_URL}/app/dashboard.html?sub=success`,
    cancel_url: `${APP_URL}/app/settings.html?panel=billing&sub=cancel`,
  };
  if (process.env.STRIPE_COUPON_ID) params.discounts = [{ coupon: process.env.STRIPE_COUPON_ID }];
  const session = await stripe.checkout.sessions.create(params);
  return session.url;
}

export async function createPortalSession(user) {
  const customer = await getOrCreateCustomer(user);
  const session = await stripe.billingPortal.sessions.create({
    customer,
    return_url: `${APP_URL}/app/settings.html?panel=billing`,
  });
  return session.url;
}

// ---- webhook ----
export function constructEvent(rawBody, sig) {
  return stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
}

function periodEnd(sub) {
  return sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
}
function planOf(sub) {
  try {
    return sub.items.data[0].price.id;
  } catch {
    return null;
  }
}

async function applyByUserId(userId, sub) {
  await query(
    `UPDATE users SET stripe_subscription_id = $1, subscription_status = $2, current_period_end = $3,
        plan = $4, stripe_customer_id = COALESCE(stripe_customer_id, $5), updated_at = now()
      WHERE id = $6`,
    [sub.id, sub.status, periodEnd(sub), planOf(sub), sub.customer, userId],
  );
}
async function applyByCustomer(sub) {
  await query(
    `UPDATE users SET stripe_subscription_id = $1, subscription_status = $2, current_period_end = $3,
        plan = $4, updated_at = now()
      WHERE stripe_customer_id = $5`,
    [sub.id, sub.status, periodEnd(sub), planOf(sub), sub.customer],
  );
}

export async function handleWebhookEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        if (session.client_reference_id) await applyByUserId(session.client_reference_id, sub);
        else await applyByCustomer(sub);
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      await applyByCustomer(event.data.object);
      break;
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const inv = event.data.object;
      if (inv.subscription) {
        const sub = await stripe.subscriptions.retrieve(inv.subscription);
        await applyByCustomer(sub);
      }
      break;
    }
    default:
      break;
  }
}
