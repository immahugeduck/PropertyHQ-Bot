import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import handler from '../api/agentphone/webhook.js';

function responseSpy() {
  return {
    statusCode: null,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('webhook verifies the original bytes before returning a triage response', async () => {
  const secret = 'test-webhook-secret';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = Buffer.from('{"event":"agent.message","data":{"message":"The toilet is overflowing"}}');
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
  const previousSecret = process.env.AGENTPHONE_WEBHOOK_SECRET;
  process.env.AGENTPHONE_WEBHOOK_SECRET = secret;
  try {
    const res = responseSpy();
    await handler({ method: 'POST', body: rawBody, headers: { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.conversationState.triageSeverity, 'URGENT');
  } finally {
    if (previousSecret === undefined) delete process.env.AGENTPHONE_WEBHOOK_SECRET;
    else process.env.AGENTPHONE_WEBHOOK_SECRET = previousSecret;
  }
});

test('voice transcripts receive AgentPhone\'s expected text response', async () => {
  const secret = 'test-webhook-secret';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = Buffer.from('{"event":"agent.message","channel":"voice","data":{"transcript":"I smell propane","direction":"inbound"}}');
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
  const previousSecret = process.env.AGENTPHONE_WEBHOOK_SECRET;
  process.env.AGENTPHONE_WEBHOOK_SECRET = secret;
  try {
    const res = responseSpy();
    await handler({ method: 'POST', body: rawBody, headers: { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp } }, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body.text, /immediate safety hazard/i);
  } finally {
    if (previousSecret === undefined) delete process.env.AGENTPHONE_WEBHOOK_SECRET;
    else process.env.AGENTPHONE_WEBHOOK_SECRET = previousSecret;
  }
});
