process.env.NODE_ENV = 'test';
import { test } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app from '../../server.js';

test('Auth API - Bug C: Reject email without TLD', async () => {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'user@domain',
      password: 'Password123!',
      business_name: 'Test Business'
    });

  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.body.error, 'Invalid email format');
});

test('Auth API - Bug C: Accept valid email with TLD', async () => {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email: `valid.merchant_${Date.now()}@domain.com`,
      password: 'Password123!',
      business_name: 'Valid Merchant Co'
    });

  assert.strictEqual(response.status, 201);
  assert.ok(response.body.token);
  assert.strictEqual(response.body.user.email.includes('@domain.com'), true);
});

test('Auth API - Registration validation (short password)', async () => {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'valid@example.com',
      password: 'short',
      business_name: 'Test'
    });

  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.body.error, 'Password must be at least 8 characters');
});

test('Auth API - Registration validation (missing business name)', async () => {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'valid2@example.com',
      password: 'Password123!',
      business_name: '  '
    });

  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.body.error, 'Business name is required');
});

test('Auth API - Registration duplicate email rejection', async () => {
  const email = `dup_${Date.now()}@test.com`;
  
  // First registration
  await request(app)
    .post('/api/auth/register')
    .send({
      email,
      password: 'Password123!',
      business_name: 'Dup Merchant'
    });

  // Second registration with same email
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email,
      password: 'Password123!',
      business_name: 'Dup Merchant 2'
    });

  assert.strictEqual(response.status, 409);
  assert.strictEqual(response.body.error, 'Email already registered');
});

test('Auth API - Successful login returns JWT token', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'merchant@test.com',
      password: 'Test123!'
    });

  assert.strictEqual(response.status, 200);
  assert.ok(response.body.token);
  assert.strictEqual(response.body.user.email, 'merchant@test.com');
});

test('Auth API - Login failure with wrong password', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'merchant@test.com',
      password: 'WrongPassword!'
    });

  assert.strictEqual(response.status, 401);
  assert.strictEqual(response.body.error, 'Invalid credentials');
});
