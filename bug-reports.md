# EU Pay QA Assessment: Bug Reports

This document contains detailed bug reports for all 7 intentional bugs identified in the EU Pay QA Engineer test codebase across Payment Processing, Authentication, Webhook Ingestion, Table Orders, and E-Invoicing components.

---

## Bug A: Payment Amount Data Type Inconsistency

**Location:** `src/routes/payment.routes.js` (Lines 16, 52)  
**Severity:** Medium  
**Component:** Payment API  

### How to Reproduce
1. Start the API server: `npm start`
2. Authenticate to obtain a JWT token:
   ```bash
   curl -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"merchant@test.com","password":"Test123!"}'
   ```
3. Retrieve merchant payments using the JWT token:
   ```bash
   curl http://localhost:3000/api/payments \
     -H "Authorization: Bearer <TOKEN>"
   ```
4. Observe the JSON response structure for `amount`.

### Expected Behavior
The `amount` field in `GET /api/payments` and `GET /api/payments/:id` should be returned as a numeric float/number (e.g., `25.5`) in compliance with standard financial REST API contracts.

### Actual Behavior
The `amount` property is formatted and returned as a string literal (e.g., `"25.5"`).

### Impact
In web and mobile frontends (such as Flutter or React/Next.js dashboards), string-formatted numerical amounts lead to type mismatch errors, invalid mathematical operations (e.g. `"25.5" + 10` evaluates to `"25.510"` instead of `35.5`), NaN output during currency aggregation, and schema validation failures in downstream analytical services.

### Root Cause
In `src/routes/payment.routes.js`, lines 16 and 52 explicitly call `.toString()` on the `p.amount` and `payment.amount` numeric properties before attaching them to the response object.

### Suggested Fix
Remove `.toString()` and return the value as a numeric float:
```javascript
amount: parseFloat(p.amount)
```

---

## Bug B: Missing Maximum Payment Amount Limit Validation

**Location:** `src/routes/payment.routes.js` (Lines 70–73)  
**Severity:** High  
**Component:** Payment API  

### How to Reproduce
1. Start the server and login as a merchant to obtain a valid JWT token.
2. Send a `POST` request to create a payment with an extreme, unrealistic transaction amount:
   ```bash
   curl -X POST http://localhost:3000/api/payments \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"amount": 999999999, "currency": "EUR", "customer_email": "test@test.com"}'
   ```
3. Observe the response.

### Expected Behavior
The payment API should validate transaction thresholds and reject any payment exceeding established business risk limits (e.g., €50,000 per transaction limit) with HTTP `400 Bad Request` and an explicit error message.

### Actual Behavior
The API accepts payments of any arbitrary amount (e.g., €999,999,999), creates the record with status `pending`, and returns HTTP `201 Created`.

### Impact
Lack of maximum limit validation exposes the payment gateway to serious risk, including illegal money laundering attempts, accidental hyper-inflated transactions, credit card authorization failures at bank processors, and financial loss or compliance violations.

### Root Cause
In `src/routes/payment.routes.js`, the POST route handler validates `amount <= 0` and `isNaN(amount)` but lacks an upper bound check (`amount > MAX_AMOUNT`).

### Suggested Fix
Introduce a maximum threshold validation rule (e.g., €50,000):
```javascript
const MAX_AMOUNT = 50000;
if (amount > MAX_AMOUNT) {
  return res.status(400).json({ error: `Payment amount exceeds maximum limit of €${MAX_AMOUNT.toLocaleString()}` });
}
```

---

## Bug C: Permissive Auth Email Validation Allowing Missing TLD

**Location:** `src/routes/auth.routes.js` (Lines 10–14)  
**Severity:** Medium  
**Component:** Auth API  

### How to Reproduce
1. Send a registration request with an email address missing a top-level domain (TLD):
   ```bash
   curl -X POST http://localhost:3000/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{"email":"user@domain","password":"Password123!","business_name":"Test Business"}'
   ```
2. Observe the HTTP response code and payload.

### Expected Behavior
The registration endpoint should validate that email addresses conform to RFC 5322 standards and contain a valid domain extension / TLD (e.g. `user@domain.com`). Invalid inputs should be rejected with HTTP `400 Bad Request`.

### Actual Behavior
The API validates `user@domain` as valid and creates a new merchant user account, returning HTTP `201 Created`.

### Impact
Invalid email addresses pollute the user database, break transactional email workflows (such as verification emails, invoices, and password resets), and increase bounce rates that damage domain sender reputation.

### Root Cause
In `src/routes/auth.routes.js`, the `validateEmail` function uses regex `/^[^\s@]+@[^\s@]+$/`, which checks for the `@` character surrounded by non-whitespace characters, but fails to mandate a domain dot (`.`) and TLD extension.

### Suggested Fix
Update the regular expression to enforce a domain dot and TLD extension:
```javascript
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
```

---

## Bug D: Missing Webhook HMAC Signature Verification

**Location:** `src/routes/webhook.routes.js` (Lines 18–33)  
**Severity:** Critical  
**Component:** Webhook API  

### How to Reproduce
1. Submit a payment status update webhook request with a fake or missing `x-webhook-signature` header:
   ```bash
   curl -X POST http://localhost:3000/api/webhooks/payment-status \
     -H "Content-Type: application/json" \
     -H "x-webhook-signature: arbitrary_fake_signature" \
     -d '{"payment_id":"2","status":"completed","event_id":"evt_forged_001"}'
   ```
2. Observe the HTTP status code and response payload.

### Expected Behavior
The endpoint should inspect the `x-webhook-signature` header, compute the expected HMAC-SHA256 digest using `WEBHOOK_SECRET` and the raw request payload, and reject spoofed requests with HTTP `401 Unauthorized`.

### Actual Behavior
The server processes the webhook without checking the signature, updating payment `2` status to `completed` and returning HTTP `200 OK`.

### Impact
Critical Security Vulnerability (Webhook Spoofing / Forgery). Unauthenticated external attackers can inject fake webhook notifications into the API, marking unpaid orders or fraudulent payments as `completed` without transferring any money.

### Root Cause
In `src/routes/webhook.routes.js`, the HMAC signature validation logic was commented out, allowing any request to bypass authorization.

### Suggested Fix
Enforce header presence and verify HMAC-SHA256 signature against `WEBHOOK_SECRET`:
```javascript
if (!signature) {
  return res.status(401).json({ error: 'Webhook signature missing' });
}

const expectedSignature = crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(JSON.stringify(req.body))
  .digest('hex');

if (signature !== expectedSignature) {
  return res.status(401).json({ error: 'Invalid signature' });
}
```

---

## Bug E: Missing Webhook Event Idempotency Tracking

**Location:** `src/routes/webhook.routes.js` (Lines 38–45, Line 56)  
**Severity:** High  
**Component:** Webhook API  

### How to Reproduce
1. Generate a valid HMAC signature for a payment status webhook payload containing an `event_id` (e.g. `evt_1001`).
2. Send the webhook request to `POST /api/webhooks/payment-status`. Receive HTTP `200 OK` ("Webhook processed").
3. Send the exact same webhook request with identical `event_id` a second time:
   ```bash
   curl -X POST http://localhost:3000/api/webhooks/payment-status \
     -H "Content-Type: application/json" \
     -H "x-webhook-signature: <VALID_HMAC>" \
     -d '{"payment_id":"1","status":"completed","event_id":"evt_1001"}'
   ```
4. Observe the response.

### Expected Behavior
Webhook endpoints must be idempotent. When an `event_id` that has already been processed is received, the API should return an idempotent HTTP `200 OK` response (e.g., `{"success": true, "message": "Already processed"}`) without re-processing state updates or modifying database timestamps.

### Actual Behavior
The API re-processes the event, updates the payment record's `webhook_received_at` timestamp again, and returns a fresh "Webhook processed" message.

### Impact
Payment gateways (Powens, Stripe, Bridge) frequently retry webhook deliveries due to network glitches or delayed ACKs. Non-idempotent webhook processing causes duplicate event notifications, race conditions, erroneous state updates, and corrupted audit logs.

### Root Cause
In `src/routes/webhook.routes.js`, the lookup in `db.processed_webhooks` and subsequent insertion into `db.processed_webhooks` were commented out.

### Suggested Fix
Check `db.processed_webhooks` before handling updates and append processed `event_id` entries:
```javascript
if (!db.processed_webhooks) db.processed_webhooks = [];

if (event_id && db.processed_webhooks.includes(event_id)) {
  return res.status(200).json({ success: true, message: 'Already processed' });
}

// After updating payment:
if (event_id) {
  db.processed_webhooks.push(event_id);
}
```

---

## Bug F: Missing Duplicate Table Order Prevention

**Location:** `src/routes/table-order.routes.js` (Lines 44–56)  
**Severity:** Medium  
**Component:** Table Orders API  

### How to Reproduce
1. Submit a table order for `merchant_id: "1"` and `table_number: 5`:
   ```bash
   curl -X POST http://localhost:3000/api/table-orders \
     -H "Content-Type: application/json" \
     -d '{"merchant_id":"1","table_number":5,"customer_name":"Guest","items":[{"name":"Coffee","price":3.5,"quantity":1}]}'
   ```
2. Submit a second table order for the exact same `merchant_id: "1"` and `table_number: 5` while the first order is still `pending`.
3. Observe the response.

### Expected Behavior
A table cannot have multiple active `pending` orders simultaneously. Creating a new order for a table that already has an unresolved pending order should be blocked with HTTP `409 Conflict`.

### Actual Behavior
The API creates a second pending order for Table 5, returning HTTP `201 Created` with a new `id`.

### Impact
Allows concurrent or duplicate table orders in hospitality / restaurant point-of-sale systems. Kitchen staff receive duplicate food tickets, tables get double-billed, and inventory counts become desynchronized.

### Root Cause
In `src/routes/table-order.routes.js`, duplicate order validation checking existing `db.table_orders` for `status === 'pending'` on the same merchant and table was commented out.

### Suggested Fix
Add duplicate check for active pending orders on the target table:
```javascript
const existingOrder = (db.table_orders || []).find(
  o => o.merchant_id === merchant_id && 
       o.table_number === table_number && 
       o.status === 'pending'
);
if (existingOrder) {
  return res.status(409).json({ error: 'Table already has a pending order' });
}
```

---

## Bug G: Missing Duplicate E-Invoice Submission Check

**Location:** `src/routes/einvoice.routes.js` (Lines 50–59)  
**Severity:** Medium  
**Component:** E-Invoicing API  

### How to Reproduce
1. Authenticate as a merchant and submit an invoice to the tax authority via `POST /api/einvoice/submit`:
   ```bash
   curl -X POST http://localhost:3000/api/einvoice/submit \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"invoice_id":"inv_test_001","customer_siret":"12345678901234"}'
   ```
   Returns HTTP `200 OK` with `status: "submitted"`.
2. Resubmit the exact same `invoice_id` (`inv_test_001`) a second time.
3. Observe the HTTP response.

### Expected Behavior
Once an invoice has been submitted or accepted by the tax authority (Seqino PDP / French DGFiP), re-submitting it must be rejected with HTTP `409 Conflict` to preserve tax immutability.

### Actual Behavior
The API allows re-submitting the invoice, overrides the previous `submission_id` with a newly generated UUID, updates `submitted_at`, and returns HTTP `200 OK`.

### Impact
Submitting duplicate e-invoices to government tax portals violates tax authority regulations, incurs redundant API processing fees, causes audit failures, and leads to tax filing discrepancies.

### Root Cause
In `src/routes/einvoice.routes.js`, validation checking if `invoice.einvoice_status` is already `'submitted'` or `'accepted'` was commented out.

### Suggested Fix
Check `invoice.einvoice_status` before processing submission:
```javascript
if (invoice.einvoice_status === 'submitted' || invoice.einvoice_status === 'accepted') {
  return res.status(409).json({ 
    error: 'Invoice already submitted to tax authority' 
  });
}
```
