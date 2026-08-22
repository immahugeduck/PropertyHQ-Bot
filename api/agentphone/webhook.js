import { verifyAgentPhoneSignature, normalizeAgentPhoneEvent } from '../../src/agentphone.js';
import { classifyMaintenanceRequest } from '../../src/triage.js';
import { auditEvent } from '../../src/audit.js';

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

export const config = {
  api: {
    bodyParser: false
  }
};

async function getRawBody(req) {
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

  const secret = process.env.AGENTPHONE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('AGENTPHONE_WEBHOOK_SECRET is not configured');
    return res.status(503).json({ error: 'webhook_not_configured' });
  }

  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (error) {
    if (error.code === 'PAYLOAD_TOO_LARGE') return res.status(413).json({ error: 'payload_too_large' });
    throw error;
  }
  if (!rawBody) return res.status(400).json({ error: 'raw_body_unavailable' });

  const signature = req.headers['x-webhook-signature'] ?? '';
  const timestamp = req.headers['x-webhook-timestamp'] ?? '';
  const verified = verifyAgentPhoneSignature(rawBody, signature, timestamp, secret);

  if (!verified) {
    auditEvent({ event: 'rejected', channel: 'unknown', conversationId: null, severity: null, category: null, verified: false });
    return res.status(401).json({ error: 'invalid_signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
  }

  const event = normalizeAgentPhoneEvent(payload);

  // AgentPhone can deliver multiple event types. Phase 1 only produces live
  // responses for agent.message; other signed events are acknowledged safely.
  if (event.event !== 'agent.message') {
    auditEvent({ ...event, severity: null, category: null, verified: true });
    return res.status(200).json({ received: true });
  }

  if (event.direction && event.direction !== 'inbound') {
    auditEvent({ ...event, severity: null, category: null, verified: true });
    return res.status(200).json({ received: true });
  }

  if (!event.message) {
    const response = 'I received your message, but I could not read the maintenance description. Please resend the problem in text or describe it again.';
    if (event.channel === 'voice') return res.status(200).json({ text: response });
    return res.status(200).json({
      response
    });
  }

  const triage = classifyMaintenanceRequest(event.message);
  auditEvent({ ...event, ...triage, verified: true });

  if (event.channel === 'voice') return res.status(200).json({ text: triage.response });

  return res.status(200).json({
    response: triage.response,
    conversationState: {
      triageSeverity: triage.severity,
      triageCategory: triage.category,
      phase: 'intake'
    }
  });
}
