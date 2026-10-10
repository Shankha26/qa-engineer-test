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

test('Table Orders API - Create valid table order', async () => {
  const tableNumber = Math.floor(Math.random() * 1000) + 100;
  const response = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNumber,
      customer_name: 'Alice',
      items: [
        { name: 'Pizza', price: 12.5, quantity: 2 },
        { name: 'Soda', price: 2.5, quantity: 2 }
      ]
    });

  assert.strictEqual(response.status, 201);
  assert.strictEqual(response.body.success, true);
  assert.strictEqual(response.body.data.total, 30.0);
  assert.strictEqual(response.body.data.status, 'pending');
});

test('Table Orders API - Bug F: Rejects duplicate pending order for same table', async () => {
  const tableNumber = Math.floor(Math.random() * 1000) + 200;

  // First order
  const res1 = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNumber,
      customer_name: 'Bob',
      items: [{ name: 'Burger', price: 10, quantity: 1 }]
    });
  assert.strictEqual(res1.status, 201);

  // Second order for same table while pending
  const res2 = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNumber,
      customer_name: 'Charlie',
      items: [{ name: 'Fries', price: 5, quantity: 1 }]
    });

  assert.strictEqual(res2.status, 409);
  assert.strictEqual(res2.body.error, 'Table already has a pending order');
});

test('Table Orders API - Allows new order after updating previous order status', async () => {
  const token = await getAuthToken();
  const tableNumber = Math.floor(Math.random() * 1000) + 300;

  // Create order
  const createRes = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNumber,
      customer_name: 'Dave',
      items: [{ name: 'Pasta', price: 15, quantity: 1 }]
    });
  const orderId = createRes.body.data.id;

  // Update order status to served
  const patchRes = await request(app)
    .patch(`/api/table-orders/${orderId}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'served' });
  assert.strictEqual(patchRes.status, 200);

  // Now create new order for same table
  const newOrderRes = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: tableNumber,
      customer_name: 'Eve',
      items: [{ name: 'Gelato', price: 6, quantity: 1 }]
    });

  assert.strictEqual(newOrderRes.status, 201);
});

test('Table Orders API - Rejects order with empty items array', async () => {
  const response = await request(app)
    .post('/api/table-orders')
    .send({
      merchant_id: '1',
      table_number: 10,
      items: []
    });

  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.body.error, 'Order must have at least one item');
});

test('Table Orders API - Rejects order missing required fields', async () => {
  const response = await request(app)
    .post('/api/table-orders')
    .send({
      table_number: 10
    });

  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.body.error, 'merchant_id, table_number, and items array required');
});

test('Table Orders API - List orders for authenticated merchant', async () => {
  const token = await getAuthToken();
  const response = await request(app)
    .get('/api/table-orders')
    .set('Authorization', `Bearer ${token}`);

  assert.strictEqual(response.status, 200);
  assert.strictEqual(response.body.success, true);
  assert.ok(Array.isArray(response.body.data));
});

test('Table Orders API - Rejects status update with invalid status', async () => {
  const token = await getAuthToken();
  const response = await request(app)
    .patch('/api/table-orders/1/status')
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'invalid_status_xyz' });

  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.body.error, 'Valid status required');
});
