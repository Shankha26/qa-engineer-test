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

test('Payment API - Authentication required', async () => {
  const response = await request(app).get('/api/payments');
  assert.strictEqual(response.status, 401);
  assert.strictEqual(response.body.error, 'Authentication required');
});

test('Payment API - Bug A: GET /api/payments returns amount as number', async () => {
  const token = await getAuthToken();
  const response = await request(app)
    .get('/api/payments')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.success, true);
  assert.ok(Array.isArray(response.body.data));
  assert.ok(response.body.data.length > 0);

  const firstPayment = response.body.data[0];
  assert.strictEqual(typeof firstPayment.amount, 'number');
  assert.strictEqual(firstPayment.amount, 25.5);
});

test('Payment API - Bug A: GET /api/payments/:id returns amount as number', async () => {
  const token = await getAuthToken();
  const response = await request(app)
    .get('/api/payments/1')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.success, true);
  assert.strictEqual(typeof response.body.data.amount, 'number');
  assert.strictEqual(response.body.data.amount, 25.5);
});

test('Payment API - GET /api/payments/:id returns 404 for missing payment', async () => {
  const token = await getAuthToken();
  const response = await request(app)
    .get('/api/payments/non-existent-999')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(response.status, 404);
  assert.strictEqual(response.body.error, 'Payment not found');
});

test('Payment API - Bug B: POST /api/payments rejects amount > €50,000', async () => {
  const token = await getAuthToken();
  const response = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 999999,
      currency: 'EUR',
      customer_email: 'customer@test.com'
    });

  assert.strictEqual(response.status, 400);
  assert.ok(response.body.error.includes('maximum'));
});

test('Payment API - POST /api/payments rejects zero or negative amount', async () => {
  const token = await getAuthToken();

  const zeroResponse = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 0,
      currency: 'EUR',
      customer_email: 'customer@test.com'
    });
  assert.strictEqual(zeroResponse.status, 400);

  const negativeResponse = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: -50,
      currency: 'EUR',
      customer_email: 'customer@test.com'
    });
  assert.strictEqual(negativeResponse.status, 400);
});

test('Payment API - POST /api/payments rejects unsupported currency', async () => {
  const token = await getAuthToken();
  const response = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 100,
      currency: 'XYZ',
      customer_email: 'customer@test.com'
    });

  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.body.error, 'Valid currency is required (EUR, USD, GBP)');
});

test('Payment API - POST /api/payments creates valid payment', async () => {
  const token = await getAuthToken();
  const response = await request(app)
    .post('/api/payments')
    .set('Authorization', `Bearer ${token}`)
    .send({
      amount: 150.75,
      currency: 'EUR',
      customer_email: 'validcustomer@test.com'
    });

  assert.strictEqual(response.status, 201);
  assert.strictEqual(response.body.success, true);
  assert.strictEqual(typeof response.body.data.amount, 'number');
  assert.strictEqual(response.body.data.amount, 150.75);
  assert.strictEqual(response.body.data.status, 'pending');
});
