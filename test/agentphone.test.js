import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyAgentPhoneSignature, normalizeAgentPhoneEvent } from '../src/agentphone.js';

test('valid HMAC signature verifies', () => {
  const body = Buffer.from('{"event":"agent.message"}');
  const secret = 'test-secret';
  const timestamp = '1700000000';
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
  assert.equal(verifyAgentPhoneSignature(body, signature, timestamp, secret, 1700000000000), true);
});

test('invalid HMAC signature is rejected', () => {
  const body = Buffer.from('{"event":"agent.message"}');
  assert.equal(verifyAgentPhoneSignature(body, 'sha256=deadbeef', '1700000000', 'test-secret', 1700000000000), false);
});

test('an expired delivery is rejected even when its signature is valid', () => {
  const body = Buffer.from('{"event":"agent.message"}');
  const secret = 'test-secret';
  const timestamp = '1700000000';
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
  assert.equal(verifyAgentPhoneSignature(body, signature, timestamp, secret, 1700000301000), false);
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

test('voice transcripts and message direction are normalized', () => {
  const event = normalizeAgentPhoneEvent({
    event: 'agent.message',
    channel: 'voice',
    data: { transcript: 'I smell propane', direction: 'inbound', numberId: 'num_1' }
  });
  assert.equal(event.message, 'I smell propane');
  assert.equal(event.direction, 'inbound');
  assert.equal(event.numberId, 'num_1');
});
