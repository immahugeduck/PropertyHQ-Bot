import { classifyMaintenanceRequest } from './triage.js';

// Inkbox adapter for the First Call Maintenance communications agent.
//
// Unlike the Twilio and AgentPhone paths, Inkbox is NOT a signed HTTP webhook
// into this app. The agent runs as an Inkbox identity (agent handle
// `tenant-coms-agent`, display name "Agent-Coms") and is driven through the
// Inkbox MCP tools. On each invocation the agent reads inbound email/iMessage,
// classifies every message with the same deterministic triage engine the phone
// paths use, and replies on the channel the message arrived on.
//
// This module is the pure, testable core of that loop:
//   1. normalizeInboundMessage() — flatten an Inkbox email / iMessage / SMS
//      payload into the provider-independent shape the triage engine consumes.
//   2. formatEmailReply() / formatChatReply() — turn a triage result into the
//      text the agent sends back, in First Call Maintenance's voice.
//   3. triageInboundMessage() — compose the two: normalize, classify, format.
//
// Trust boundary: the MCP connection itself is the authenticated channel, so
// there is no per-message HMAC to verify (that is what the Twilio/AgentPhone
// signature checks are for). Message *content* is still untrusted, sender-
// authored text. It is only ever run through the deterministic regex triage
// engine and echoed into templated reply text, never executed or used to build
// a request, so there is no injection surface here.

// Channels this identity can actually use today. SMS/voice require a phone
// number assigned to the Inkbox identity; email + iMessage work out of the box.
export const SUPPORTED_CHANNELS = Object.freeze(['email', 'imessage', 'sms']);

const SEVERITY_SUBJECT_TAG = Object.freeze({
  EMERGENCY: '[EMERGENCY] ',
  URGENT: '[URGENT] ',
  PRIORITY: '[Priority] ',
  ROUTINE: ''
});

const SIGNATURE = 'First Call Maintenance';

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * Normalize an inbound Inkbox message into the shape the triage engine expects.
 *
 * Inkbox delivers subtly different payloads for email, iMessage and SMS, so
 * (like normalizeAgentPhoneEvent) this reads a range of likely field names and
 * falls back safely. For email the triage-relevant text is the body; the
 * subject is carried separately so replies can quote it.
 */
export function normalizeInboundMessage(payload = {}) {
  const data = payload?.data ?? payload ?? {};
  const rawChannel = firstString(payload?.channel, data.channel, data.type).toLowerCase();
  const channel = SUPPORTED_CHANNELS.includes(rawChannel) ? rawChannel : (rawChannel || 'unknown');

  const body = firstString(
    data.body,
    data.text,
    data.message,
    data.plain_body,
    data.snippet,
    payload?.body,
    payload?.text,
    payload?.message
  );

  return {
    channel,
    messageId: firstString(data.id, data.message_id, data.email_id, payload?.id, payload?.message_id) || null,
    conversationId:
      firstString(
        data.conversation_id,
        data.thread_id,
        payload?.conversation_id,
        payload?.thread_id,
        payload?.conversationId
      ) || null,
    from: firstString(data.from, data.from_address, data.sender, data.handle, payload?.from) || null,
    subject: firstString(data.subject, payload?.subject) || null,
    message: body,
    direction: firstString(data.direction, payload?.direction) || null,
    raw: payload
  };
}

/** Build the subject + body of an email reply from a triage result. */
export function formatEmailReply(triage, inbound = {}) {
  const tag = SEVERITY_SUBJECT_TAG[triage.severity] ?? '';
  const base = firstString(inbound.subject) || 'Your maintenance request';
  const subject = tag + (/^re:/i.test(base) ? base : `Re: ${base}`);

  const lines = ['Hi,', '', triage.response];
  if (triage.severity === 'EMERGENCY') {
    lines.push(
      '',
      'Email is not monitored in real time. If this is an active emergency, call 911 or the appropriate utility/emergency line now rather than waiting on this reply.'
    );
  }
  lines.push('', `— ${SIGNATURE}`);

  return { subject, body: lines.join('\n') };
}

/** Build a short chat reply (iMessage/SMS) from a triage result. */
export function formatChatReply(triage) {
  return triage.response;
}

/**
 * Full agent step for one inbound Inkbox message: normalize, classify, and
 * produce the reply payload for the channel it arrived on. `classify` is
 * injectable for tests but defaults to the shared deterministic engine.
 *
 * Returns `{ inbound, triage, reply }`. `reply` is null when there is no usable
 * message text or the channel is unsupported; the caller (the MCP-driven agent
 * loop) decides how to acknowledge those cases.
 */
export function triageInboundMessage(payload, classify = classifyMaintenanceRequest) {
  const inbound = normalizeInboundMessage(payload);

  if (!SUPPORTED_CHANNELS.includes(inbound.channel)) {
    return { inbound, triage: null, reply: null, reason: 'unsupported_channel' };
  }
  if (!inbound.message) {
    return { inbound, triage: null, reply: null, reason: 'empty_message' };
  }

  const triage = classify(inbound.message);
  const reply =
    inbound.channel === 'email'
      ? { kind: 'email', ...formatEmailReply(triage, inbound) }
      : { kind: 'chat', text: formatChatReply(triage) };

  return { inbound, triage, reply };
}
