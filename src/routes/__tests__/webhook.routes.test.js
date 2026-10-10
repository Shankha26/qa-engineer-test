process.env.NODE_ENV = 'test';
import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import crypto from 'crypto';
import app from '../../server.js';

const WEBHOOK_SECRET = 'test-webhook-secret-key';

function generateSignature(body) {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
}

test('Webhook API - Bug D: Rejects request with missing signature', async () => {
  const payload = { payment_id: '1', status: 'completed', event_id: `evt_missing_${Date.now()}` };

  const response = await request(app)
    .post('/api/webhooks/payment-status')
    .send(payload);

  assert.strictEqual(response.status, 401);
  assert.strictEqual(response.body.error, 'Webhook signature missing');
});

test('Webhook API - Bug D: Rejects request with invalid signature', async () => {
  const payload = { payment_id: '1', status: 'completed', event_id: `evt_invalid_${Date.now()}` };

  const response = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', 'invalid-fake-signature-12345')
    .send(payload);

  assert.strictEqual(response.status, 401);
  assert.strictEqual(response.body.error, 'Invalid signature');
});

test('Webhook API - Bug D: Accepts request with valid signature', async () => {
  const payload = { payment_id: '1', status: 'completed', event_id: `evt_valid_${Date.now()}` };
  const signature = generateSignature(payload);

  const response = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.success, true);
  assert.strictEqual(response.body.new_status, 'completed');
});

test('Webhook API - Bug E: Idempotency check prevents duplicate event processing', async () => {
  const eventId = `evt_idempotent_${Date.now()}`;
  const payload = { payment_id: '1', status: 'completed', event_id: eventId };
  const signature = generateSignature(payload);

  // First request
  const response1 = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(response1.status, 200);
  assert.strictEqual(response1.body.message, 'Webhook processed');

  // Second request with same event_id
  const response2 = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(response2.status, 200);
  assert.strictEqual(response2.body.message, 'Already processed');
});

test('Webhook API - Rejects request with missing required fields', async () => {
  const payload = { status: 'completed' };
  const signature = generateSignature(payload);

  const response = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.body.error, 'payment_id and status required');
});

test('Webhook API - Rejects webhook for non-existent payment', async () => {
  const payload = { payment_id: '999999', status: 'completed', event_id: `evt_missing_pay_${Date.now()}` };
  const signature = generateSignature(payload);

  const response = await request(app)
    .post('/api/webhooks/payment-status')
    .set('x-webhook-signature', signature)
    .send(payload);

  assert.strictEqual(response.status, 404);
  assert.strictEqual(response.body.error, 'Payment not found');
});

test('Webhook API - E-Invoice webhook processes status updates', async () => {
  // First create or submit an invoice via einvoice submit route or test setup
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'merchant@test.com', password: 'Test123!' });
  const token = loginRes.body.token;

  const invoiceId = `inv_test_${Date.now()}`;
  await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({ invoice_id: invoiceId, customer_siret: '12345678901234' });

  // Send tax authority webhook
  const response = await request(app)
    .post('/api/webhooks/e-invoice')
    .send({
      invoice_id: invoiceId,
      status: 'accepted',
      submission_id: 'SUB-12345',
      tax_authority_id: 'TAX-FR-99'
    });

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.success, true);
  assert.strictEqual(response.body.status, 'accepted');
});
