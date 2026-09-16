import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import imessageHandler from '../api/inkbox/imessage.js';

const SECRET = 'inkbox-test-secret';

function responseSpy() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; }
  };
}

function inkboxRequest(payload, { signature, sign = true } = {}) {
  const raw = Buffer.from(JSON.stringify(payload));
  const sig = signature ?? `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}`;
  return {
    method: 'POST',
    body: raw,
    headers: sign ? { 'x-inkbox-signature': sig, 'content-type': 'application/json' } : { 'content-type': 'application/json' }
  };
}

function withSecret(fn) {
  const prev = process.env.INKBOX_WEBHOOK_SECRET;
  process.env.INKBOX_WEBHOOK_SECRET = SECRET;
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env.INKBOX_WEBHOOK_SECRET;
    else process.env.INKBOX_WEBHOOK_SECRET = prev;
  });
}

test('a signed iMessage webhook returns a triage reply', () =>
  withSecret(async () => {
    const res = responseSpy();
    await imessageHandler(inkboxRequest({ data: { text: 'the ceiling is leaking water right now', conversation_id: 'im_1' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.received, true);
    assert.equal(res.body.severity, 'EMERGENCY');
    assert.match(res.body.reply, /water/i);
  }));

test('an unsigned/invalid signature is rejected with 401', () =>
  withSecret(async () => {
    const res = responseSpy();
    await imessageHandler(inkboxRequest({ data: { text: 'leak' } }, { signature: 'sha256=wrong' }), res);
    assert.equal(res.statusCode, 401);
  }));

test('a photo-only iMessage still gets a reply, not silence', () =>
  withSecret(async () => {
    const res = responseSpy();
    await imessageHandler(inkboxRequest({ data: { text: '', attachments: [{ filename: 'IMG.jpg' }] } }), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body.reply, /photo/i);
    assert.equal(res.body.reason, 'media_only');
  }));

test('the endpoint refuses to run unconfigured (no secret, no explicit opt-in)', async () => {
  const prevSecret = process.env.INKBOX_WEBHOOK_SECRET;
  const prevAllow = process.env.INKBOX_WEBHOOK_ALLOW_UNVERIFIED;
  delete process.env.INKBOX_WEBHOOK_SECRET;
  delete process.env.INKBOX_WEBHOOK_ALLOW_UNVERIFIED;
  try {
    const res = responseSpy();
    await imessageHandler(inkboxRequest({ data: { text: 'leak' } }, { sign: false }), res);
    assert.equal(res.statusCode, 503);
  } finally {
    if (prevSecret !== undefined) process.env.INKBOX_WEBHOOK_SECRET = prevSecret;
    if (prevAllow !== undefined) process.env.INKBOX_WEBHOOK_ALLOW_UNVERIFIED = prevAllow;
  }
});

test('a pre-parsed object body (Vercel-style) is handled, not 400', async () => {
  const prevSecret = process.env.INKBOX_WEBHOOK_SECRET;
  const prevAllow = process.env.INKBOX_WEBHOOK_ALLOW_UNVERIFIED;
  delete process.env.INKBOX_WEBHOOK_SECRET;
  process.env.INKBOX_WEBHOOK_ALLOW_UNVERIFIED = 'true';
  try {
    // Simulate Vercel having already parsed the JSON into req.body.
    const req = {
      method: 'POST',
      body: { data: { text: 'water pouring out under the water heater', conversation_id: 'im_2' } },
      headers: { 'content-type': 'application/json' }
    };
    const res = responseSpy();
    await imessageHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.severity, 'EMERGENCY');
    assert.match(res.body.reply, /water/i);
  } finally {
    if (prevSecret !== undefined) process.env.INKBOX_WEBHOOK_SECRET = prevSecret;
    if (prevAllow !== undefined) process.env.INKBOX_WEBHOOK_ALLOW_UNVERIFIED = prevAllow;
    else delete process.env.INKBOX_WEBHOOK_ALLOW_UNVERIFIED;
  }
});

test('a non-POST method is rejected with 405', () =>
  withSecret(async () => {
    const res = responseSpy();
    await imessageHandler({ method: 'GET', headers: {} }, res);
    assert.equal(res.statusCode, 405);
  }));
