import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyAgentPhoneSignature, normalizeAgentPhoneEvent } from '../src/agentphone.js';

test('valid HMAC signature verifies', () => {
  const body = Buffer.from('{"event":"agent.message"}');
  const secret = 'test-secret';
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyAgentPhoneSignature(body, signature, secret), true);
});

test('invalid HMAC signature is rejected', () => {
  const body = Buffer.from('{"event":"agent.message"}');
  assert.equal(verifyAgentPhoneSignature(body, 'deadbeef', 'test-secret'), false);
});

test('AgentPhone event is normalized', () => {
  const event = normalizeAgentPhoneEvent({
    event: 'agent.message',
    channel: 'sms',
    conversationId: 'conv_1',
    data: { message: '  leaking faucet  ', fromNumber: '+15550000000' }
  });
  assert.equal(event.message, 'leaking faucet');
  assert.equal(event.channel, 'sms');
  assert.equal(event.conversationId, 'conv_1');
});
