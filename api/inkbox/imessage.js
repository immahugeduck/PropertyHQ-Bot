import {
  triageInboundMessage,
  verifyInkboxSignature
} from '../../src/inkbox.js';
import { auditEvent } from '../../src/audit.js';

// Inkbox iMessage webhook receiver for the First Call Maintenance comms agent.
//
// Inkbox can POST an inbound iMessage to this endpoint. We verify it, run the
// shared deterministic triage engine, and return the reply text so Inkbox can
// deliver it (or so the agent can send it with inkbox_imessage_send).
//
// PROVISIONAL until validated against one real Inkbox delivery:
//   - the signature header name/scheme (see verifyInkboxSignature)
//   - the exact inbound field names (normalizeInboundMessage maps defensively)
//   - how Inkbox consumes the response (sync reply body vs. async send)
// Safe by default: without INKBOX_WEBHOOK_SECRET the endpoint refuses to run
// unless INKBOX_WEBHOOK_ALLOW_UNVERIFIED=true is set explicitly for testing.

export const config = { api: { bodyParser: false } };

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body !== undefined) return null;

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_WEBHOOK_BODY_BYTES) {
      const error = new Error('payload_too_large');
      error.code = 'PAYLOAD_TOO_LARGE';
      throw error;
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const secret = process.env.INKBOX_WEBHOOK_SECRET;
  const allowUnverified = process.env.INKBOX_WEBHOOK_ALLOW_UNVERIFIED === 'true';
  if (!secret && !allowUnverified) {
    console.error('INKBOX_WEBHOOK_SECRET is not configured');
    return res.status(503).json({ error: 'inkbox_webhook_not_configured' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    if (error.code === 'PAYLOAD_TOO_LARGE') return res.status(413).json({ error: 'payload_too_large' });
    throw error;
  }
  if (!rawBody) return res.status(400).json({ error: 'raw_body_unavailable' });

  if (secret) {
    const signature = req.headers['x-inkbox-signature'] ?? '';
    if (!verifyInkboxSignature(rawBody, signature, secret)) {
      auditEvent({ event: 'inkbox.imessage', channel: 'imessage', conversationId: null, severity: null, category: null, verified: false });
      return res.status(401).json({ error: 'invalid_signature' });
    }
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  // iMessage webhook: force the channel so triage formats a chat reply even if
  // the payload doesn't label it.
  if (payload && typeof payload === 'object' && !payload.channel) payload.channel = 'imessage';

  const { inbound, triage, reply, reason } = triageInboundMessage(payload);

  auditEvent({
    event: 'inkbox.imessage',
    channel: inbound.channel,
    conversationId: inbound.conversationId,
    severity: triage?.severity ?? null,
    category: triage?.category ?? null,
    verified: Boolean(secret)
  });

  return res.status(200).json({
    received: true,
    reply: reply ? reply.text : null,
    severity: triage?.severity ?? null,
    category: triage?.category ?? null,
    reason: reason ?? null
  });
}
