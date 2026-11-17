/**
 * Verifies the Stripe webhook → "invoice paid" pipeline with a correctly signed test event.
 * Needs a server running with STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET set (any test values work,
 * no call to Stripe's API is made). Usage:
 *   STRIPE_WEBHOOK_SECRET=whsec_xxx API_URL=http://localhost:4000 npm run test:stripe -w server
 */
import Stripe from 'stripe';

const BASE = process.env.API_URL ?? 'http://localhost:4000';
const secret = process.env.STRIPE_WEBHOOK_SECRET;
if (!secret) throw new Error('Set STRIPE_WEBHOOK_SECRET to the same value the server uses');

let cookie = '';
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0]!;
  return { status: res.status, data: await res.json() };
}

const run = Date.now().toString(36);
await api('POST', '/auth/register', { agencyName: `Stripe ${run}`, name: 'S', email: `stripe-${run}@e2e.test`, password: 'password123' });
const client = await api('POST', '/clients', { name: 'Payer' });
const inv = await api('POST', '/invoices', { clientId: client.data.id, items: [{ description: 'Work', quantity: 1, unitAmount: 5000 }] });
await api('POST', `/invoices/${inv.data.id}/send`);

const stripe = new Stripe('sk_test_unused');
const payload = JSON.stringify({
  id: `evt_${run}`,
  object: 'event',
  type: 'checkout.session.completed',
  data: { object: { id: `cs_test_${run}`, object: 'checkout.session', payment_status: 'paid', payment_intent: `pi_${run}`, metadata: { invoiceId: inv.data.id } } },
});

const bad = await fetch(`${BASE}/api/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=forged' }, body: payload });
console.log(bad.status === 400 ? '✓ forged signature rejected' : `✗ forged signature not rejected (${bad.status})`);

const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
const ok = await fetch(`${BASE}/api/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });
console.log(ok.status === 200 ? '✓ signed webhook accepted' : `✗ webhook failed (${ok.status}) ${await ok.text()}`);

const after = await api('GET', `/invoices/${inv.data.id}`);
console.log(after.data.status === 'PAID' ? '✓ invoice marked PAID by webhook' : `✗ invoice status ${after.data.status}`);

const replay = await fetch(`${BASE}/api/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });
console.log(replay.status === 200 ? '✓ duplicate delivery handled idempotently' : `✗ replay failed (${replay.status})`);

const checkout = await api('POST', `/invoices/${inv.data.id}/checkout`);
console.log(checkout.status === 400 ? `✓ paid invoice cannot be re-paid: "${checkout.data.error}"` : `✗ unexpected checkout ${checkout.status}`);
process.exit(after.data.status === 'PAID' && bad.status === 400 ? 0 : 1);
