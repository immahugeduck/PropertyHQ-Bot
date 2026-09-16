import crypto from 'node:crypto';
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
//
// NOTE: Vercel binds environment variables at deploy time, so changing
// INKBOX_WEBHOOK_* in the dashboard only takes effect after a redeploy of the
// branch. Also ensure the deployment is not behind Vercel Authentication (SSO),
// or Inkbox's POST is blocked before it ever reaches this function.

// NOTE: `config.api.bodyParser` is a Next.js hint; Vercel's plain Node function
// runtime ignores it and pre-parses a JSON request into `req.body` as an object.
// So we accept BOTH a pre-parsed object body and a raw stream/string/Buffer.
export const config = { api: { bodyParser: false } };

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

async function readRawStream(req) {
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

// Return { rawText, payload } where payload is set only when the body was
// already parsed for us. rawText is what we log and (when a secret is set) sign.
async function readBody(req) {
  const b = req.body;
  if (Buffer.isBuffer(b)) return { rawText: b.toString('utf8'), payload: undefined };
  if (typeof b === 'string') return { rawText: b, payload: undefined };
  if (b && typeof b === 'object') {
    let rawText = '';
    try { rawText = JSON.stringify(b); } catch { rawText = ''; }
    return { rawText, payload: b };
  }
  const buf = await readRawStream(req);
  return { rawText: buf.toString('utf8'), payload: undefined };
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

  let rawText, payload;
  try {
    ({ rawText, payload } = await readBody(req));
  } catch (error) {
    if (error.code === 'PAYLOAD_TOO_LARGE') return res.status(413).json({ error: 'payload_too_large' });
    throw error;
  }

  // Capture mode: TEMPORARY. Logs the exact headers + body Inkbox posts so the
  // signature scheme and field mapping can be locked, then turned off. Fires
  // when INKBOX_WEBHOOK_DEBUG=true OR while running unverified (test mode). Do
  // not leave on in production — it writes message content to the logs.
  if (process.env.INKBOX_WEBHOOK_DEBUG === 'true' || allowUnverified) {
    const expectedIfSecret = secret
      ? `sha256=${crypto.createHmac('sha256', secret).update(Buffer.from(rawText, 'utf8')).digest('hex')}`
      : null;
    console.log(JSON.stringify({
      type: 'inkbox_webhook_capture',
      method: req.method,
      preParsed: payload !== undefined,
      headers: req.headers,
      bodyText: rawText,
      ourExpectedSignature: expectedIfSecret
    }));
  }

  if (secret) {
    const signature = req.headers['x-inkbox-signature'] ?? '';
    // Signed over the raw bytes as received. If the body was pre-parsed, rawText
    // is a re-serialization and may not byte-match Inkbox's HMAC — capture mode
    // above records the real bytes so the scheme can be confirmed.
    if (!verifyInkboxSignature(Buffer.from(rawText, 'utf8'), signature, secret)) {
      auditEvent({ event: 'inkbox.imessage', channel: 'imessage', conversationId: null, severity: null, category: null, verified: false });
      return res.status(401).json({ error: 'invalid_signature' });
    }
  }

  if (payload === undefined) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      return res.status(400).json({ error: 'invalid_json' });
    }
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
