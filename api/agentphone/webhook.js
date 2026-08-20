import { verifyAgentPhoneSignature, normalizeAgentPhoneEvent } from '../../src/agentphone.js';
import { classifyMaintenanceRequest } from '../../src/triage.js';
import { auditEvent } from '../../src/audit.js';

function getRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  // Vercel may parse JSON before the handler. Re-serialization is retained as a
  // development fallback, but production verification should use exact raw bytes.
  return Buffer.from(JSON.stringify(req.body ?? {}));
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

  const rawBody = getRawBody(req);
  const signature = req.headers['x-webhook-signature'] ?? '';
  const verified = verifyAgentPhoneSignature(rawBody, signature, secret);

  if (!verified) {
    auditEvent({ event: 'rejected', channel: 'unknown', conversationId: null, severity: null, category: null, verified: false });
    return res.status(401).json({ error: 'invalid_signature' });
  }

  let payload;
  try {
    payload = typeof req.body === 'object' && !Buffer.isBuffer(req.body)
      ? req.body
      : JSON.parse(rawBody.toString('utf8'));
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

  if (!event.message) {
    return res.status(200).json({
      response: 'I received your message, but I could not read the maintenance description. Please resend the problem in text or describe it again.'
    });
  }

  const triage = classifyMaintenanceRequest(event.message);
  auditEvent({ ...event, ...triage, verified: true });

  return res.status(200).json({
    response: triage.response,
    conversationState: {
      triageSeverity: triage.severity,
      triageCategory: triage.category,
      phase: 'intake'
    }
  });
}
