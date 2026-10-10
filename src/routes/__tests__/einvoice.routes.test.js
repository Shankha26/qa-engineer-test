process.env.NODE_ENV = 'test';
import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app from '../../server.js';

async function getAuthToken() {
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'merchant@test.com',
      password: 'Test123!'
    });
  return loginRes.body.token;
}

test('E-Invoice API - Authentication required', async () => {
  const response = await request(app)
    .post('/api/einvoice/submit')
    .send({ invoice_id: 'inv_100', customer_siret: '12345678901234' });

  assert.strictEqual(response.status, 401);
  assert.strictEqual(response.body.error, 'Authentication required');
});

test('E-Invoice API - Submit valid invoice with 14-digit SIRET', async () => {
  const token = await getAuthToken();
  const invoiceId = `inv_submit_${Date.now()}`;

  const response = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: invoiceId,
      customer_siret: '12345678901234'
    });

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.success, true);
  assert.strictEqual(response.body.data.status, 'submitted');
  assert.ok(response.body.data.submission_id.startsWith('SUB-'));
});

test('E-Invoice API - Bug G: Reject duplicate submission for submitted invoice', async () => {
  const token = await getAuthToken();
  const invoiceId = `inv_dup_${Date.now()}`;

  // First submission
  const res1 = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: invoiceId,
      customer_siret: '12345678901234'
    });
  assert.strictEqual(res1.status, 200);

  // Second submission attempt
  const res2 = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: invoiceId,
      customer_siret: '12345678901234'
    });

  assert.strictEqual(res2.status, 409);
  assert.strictEqual(res2.body.error, 'Invoice already submitted to tax authority');
});

test('E-Invoice API - Reject submission with invalid SIRET format', async () => {
  const token = await getAuthToken();

  const response = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: `inv_invalid_siret_${Date.now()}`,
      customer_siret: '123' // Too short
    });

  assert.strictEqual(response.status, 400);
  assert.strictEqual(
    response.body.error,
    'Valid customer SIRET required for e-invoicing (14 digits)'
  );
});

test('E-Invoice API - Reject submission missing invoice_id', async () => {
  const token = await getAuthToken();

  const response = await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({ customer_siret: '12345678901234' });

  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.body.error, 'invoice_id required');
});

test('E-Invoice API - Check status of submitted invoice', async () => {
  const token = await getAuthToken();
  const invoiceId = `inv_status_${Date.now()}`;

  // Submit invoice
  await request(app)
    .post('/api/einvoice/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({
      invoice_id: invoiceId,
      customer_siret: '12345678901234'
    });

  // Query status
  const statusRes = await request(app)
    .get(`/api/einvoice/status/${invoiceId}`)
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(statusRes.status, 200);
  assert.strictEqual(statusRes.body.success, true);
  assert.strictEqual(statusRes.body.data.einvoice_status, 'submitted');
  assert.ok(statusRes.body.data.submission_id);
});

test('E-Invoice API - Check status returns 404 for non-existent invoice', async () => {
  const token = await getAuthToken();

  const response = await request(app)
    .get('/api/einvoice/status/missing_invoice_999')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(response.status, 404);
  assert.strictEqual(response.body.error, 'Invoice not found');
});
