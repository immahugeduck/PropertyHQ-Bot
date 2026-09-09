import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeInboundMessage,
  formatEmailReply,
  formatChatReply,
  triageInboundMessage,
  SUPPORTED_CHANNELS
} from '../src/inkbox.js';

test('email payload is normalized with subject and body', () => {
  const inbound = normalizeInboundMessage({
    channel: 'email',
    data: {
      id: 'email_1',
      thread_id: 'thread_1',
      from_address: 'tenant@example.com',
      subject: 'Kitchen sink',
      body: '  The kitchen faucet is dripping under the cabinet  '
    }
  });
  assert.equal(inbound.channel, 'email');
  assert.equal(inbound.messageId, 'email_1');
  assert.equal(inbound.conversationId, 'thread_1');
  assert.equal(inbound.subject, 'Kitchen sink');
  assert.equal(inbound.message, 'The kitchen faucet is dripping under the cabinet');
});

test('iMessage payload normalizes text into message', () => {
  const inbound = normalizeInboundMessage({
    channel: 'imessage',
    data: { conversation_id: 'c_9', handle: '+15555550123', text: 'no heat in unit 4' }
  });
  assert.equal(inbound.channel, 'imessage');
  assert.equal(inbound.conversationId, 'c_9');
  assert.equal(inbound.from, '+15555550123');
  assert.equal(inbound.message, 'no heat in unit 4');
});

test('email reply quotes the subject and signs off as First Call Maintenance', () => {
  const triage = { severity: 'PRIORITY', category: 'water_leak', response: 'I have this as a water/leak maintenance request.' };
  const { subject, body } = formatEmailReply(triage, { subject: 'Leaky faucet' });
  assert.equal(subject, '[Priority] Re: Leaky faucet');
  assert.match(body, /water\/leak maintenance request/);
  assert.match(body, /First Call Maintenance/);
});

test('email reply does not double-prefix an existing Re: subject', () => {
  const triage = { severity: 'ROUTINE', category: 'general_maintenance', response: 'Thanks for contacting maintenance.' };
  const { subject } = formatEmailReply(triage, { subject: 'Re: broken blind' });
  assert.equal(subject, 'Re: broken blind');
});

test('an emergency email reply adds a call-now note because email is async', () => {
  const triage = { severity: 'EMERGENCY', category: 'gas_or_co', response: 'This may be an immediate safety hazard.' };
  const { subject, body } = formatEmailReply(triage, { subject: 'gas smell' });
  assert.match(subject, /^\[EMERGENCY\] /);
  assert.match(body, /call 911/i);
});

test('triageInboundMessage classifies an emergency and formats an email reply', () => {
  const result = triageInboundMessage({
    channel: 'email',
    data: { subject: 'help', body: 'I smell gas in the apartment' }
  });
  assert.equal(result.triage.severity, 'EMERGENCY');
  assert.equal(result.reply.kind, 'email');
  assert.match(result.reply.body, /immediate safety hazard/i);
});

test('triageInboundMessage returns a chat reply for iMessage', () => {
  const result = triageInboundMessage({
    channel: 'imessage',
    data: { text: 'the ceiling is leaking water right now' }
  });
  assert.equal(result.reply.kind, 'chat');
  assert.equal(result.reply.text, formatChatReply(result.triage));
  assert.equal(result.triage.severity, 'EMERGENCY');
});

test('an empty message produces no reply and an empty_message reason', () => {
  const result = triageInboundMessage({ channel: 'email', data: { subject: 'photo only', body: '' } });
  assert.equal(result.reply, null);
  assert.equal(result.reason, 'empty_message');
});

test('an unsupported channel produces no reply', () => {
  const result = triageInboundMessage({ channel: 'fax', data: { body: 'leak' } });
  assert.equal(result.reply, null);
  assert.equal(result.reason, 'unsupported_channel');
});

test('SUPPORTED_CHANNELS covers email, imessage and sms', () => {
  assert.deepEqual([...SUPPORTED_CHANNELS], ['email', 'imessage', 'sms']);
});
