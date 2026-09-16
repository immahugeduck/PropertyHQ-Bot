import crypto from 'node:crypto';
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

// Quoted-reply markers email clients prepend when a tenant replies. When a
// webhook or MCP read hands us a full email body, everything from the first of
// these onward is the previous message quoted back, not the tenant's new words.
// Classifying the whole thing would score against stale text from earlier in
// the thread, so strip it before triage.
const QUOTE_MARKERS = [
  /^-{2,}\s*Original Message\s*-{2,}/im,
  /^On .+ wrote:\s*$/im,
  /^_{5,}\s*$/m,
  /^From:\s.+$/im,
  /^Sent from /im,
  /^>{1,}/m
];

/** Return only the tenant's newly written text, dropping quoted reply history. */
export function stripQuotedReply(text = '') {
  let earliest = text.length;
  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(text);
    if (match && match.index < earliest) earliest = match.index;
  }
  return text.slice(0, earliest).trim();
}

/**
 * Verify an Inkbox webhook signature.
 *
 * PROVISIONAL: Inkbox's exact webhook signing scheme must be confirmed against
 * one real delivery (header name + whether a timestamp is included) before this
 * is trusted in production, exactly as ARCHITECTURE.md notes for AgentPhone.
 * Default assumption: `X-Inkbox-Signature: sha256=<hex HMAC of the raw body>`.
 */
export function verifyInkboxSignature(rawBody, signature, secret) {
  if (!secret || !signature || !rawBody) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(Buffer.from(rawBody)).digest('hex')}`;
  const supplied = String(signature).trim();
  if (supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied, 'utf8'), Buffer.from(expected, 'utf8'));
}

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
  // The live Inkbox webhook nests the inbound message as an object at
  // data.message ({ content, conversation_id, direction, id, sender, media, ... }).
  // Other/simpler shapes pass the text directly as data.text/body/message.
  const msg = data.message && typeof data.message === 'object' ? data.message : null;
  const messageString = typeof data.message === 'string' ? data.message : '';

  const rawChannel = firstString(
    payload?.channel,
    data.channel,
    msg?.channel,
    data.type
  ).toLowerCase();
  const channel = SUPPORTED_CHANNELS.includes(rawChannel) ? rawChannel : (rawChannel || 'unknown');

  const rawBody = firstString(
    msg?.content,
    data.body,
    data.text,
    messageString,
    data.plain_body,
    data.snippet,
    payload?.body,
    payload?.text
  );
  // Email replies arrive with the previous message quoted underneath; iMessage/
  // SMS don't quote, so stripping is a safe no-op there.
  const body = stripQuotedReply(rawBody);

  const media = msg?.media ?? data.media;
  const attachmentCount = Array.isArray(data.attachments)
    ? data.attachments.length
    : Number(data.num_media ?? payload?.num_media ?? 0) || 0;
  const hasMedia =
    attachmentCount > 0 ||
    data.has_attachments === true ||
    (media != null && media !== '') ||
    Boolean(firstString(data.media_url, data.mediaUrl, payload?.media_url));

  return {
    channel,
    messageId: firstString(msg?.id, data.id, data.message_id, data.email_id, payload?.id, payload?.message_id) || null,
    conversationId:
      firstString(
        msg?.conversation_id,
        data.conversation_id,
        data.thread_id,
        payload?.conversation_id,
        payload?.thread_id,
        payload?.conversationId
      ) || null,
    from: firstString(msg?.sender, data.from, data.from_address, data.sender, data.handle, payload?.from) || null,
    subject: firstString(data.subject, payload?.subject) || null,
    message: body,
    hasMedia,
    direction: firstString(msg?.direction, data.direction, payload?.direction) || null,
    raw: payload
  };
}

// Reply when a tenant sends media (a photo) or an otherwise empty message with
// no words to classify. Silence is the wrong answer on a live channel, so ask
// for the one line of context the triage engine needs.
const NO_TEXT_REPLY =
  'Thanks for contacting First Call Maintenance. I can see your message but no description of the problem. Please send a short note of what is wrong and the property address/unit so I can help.';
const NO_TEXT_WITH_MEDIA_REPLY =
  'Thanks — I got your photo. Please add a short description of the problem and the property address/unit so I can route it correctly.';

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
 * Returns `{ inbound, triage, reply }`. On an unsupported channel `reply` is
 * null (nothing to send). When there is no message text the tenant still gets a
 * prompt reply (triage stays null) — going silent on a live channel is wrong.
 */
export function triageInboundMessage(payload, classify = classifyMaintenanceRequest) {
  const inbound = normalizeInboundMessage(payload);
  const asReply = (text, extra = {}) =>
    inbound.channel === 'email'
      ? { kind: 'email', subject: emptySubject(inbound), body: `Hi,\n\n${text}\n\n— ${SIGNATURE}`, ...extra }
      : { kind: 'chat', text, ...extra };

  if (!SUPPORTED_CHANNELS.includes(inbound.channel)) {
    return { inbound, triage: null, reply: null, reason: 'unsupported_channel' };
  }
  if (!inbound.message) {
    const text = inbound.hasMedia ? NO_TEXT_WITH_MEDIA_REPLY : NO_TEXT_REPLY;
    return { inbound, triage: null, reply: asReply(text), reason: inbound.hasMedia ? 'media_only' : 'empty_message' };
  }

  const triage = classify(inbound.message);
  const reply =
    inbound.channel === 'email'
      ? { kind: 'email', ...formatEmailReply(triage, inbound) }
      : { kind: 'chat', text: formatChatReply(triage) };

  return { inbound, triage, reply };
}

function emptySubject(inbound) {
  const base = firstString(inbound.subject) || 'Your maintenance request';
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}
