import {
  readRawBody,
  parseFormBody,
  buildWebhookUrl,
  verifyTwilioSignature,
  smsTwiml,
  sendTwiml
} from '../../src/twilio.js';
import { classifyMaintenanceRequest } from '../../src/triage.js';
import { classifyKeyword } from '../../src/keywords.js';
import { auditEvent } from '../../src/audit.js';

export const config = {
  api: {
    bodyParser: false
  }
};

const NO_MESSAGE_REPLY =
  'Thanks for contacting First Call Maintenance. Please reply with a short description of the maintenance problem, the property address/unit, and a photo if it helps.';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error('TWILIO_AUTH_TOKEN is not configured');
    return res.status(503).json({ error: 'twilio_not_configured' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    if (error.code === 'PAYLOAD_TOO_LARGE') return res.status(413).json({ error: 'payload_too_large' });
    throw error;
  }

  const params = parseFormBody(rawBody);
  const url = buildWebhookUrl(req);
  const signature = req.headers['x-twilio-signature'] ?? '';

  if (!verifyTwilioSignature(url, params, signature, authToken)) {
    auditEvent({ event: 'twilio.message', channel: 'sms', conversationId: null, severity: null, category: null, verified: false });
    return res.status(403).json({ error: 'invalid_signature' });
  }

  const message = String(params.Body ?? '').trim();
  const conversationId = params.MessageSid ?? null;
  const numMedia = Number(params.NumMedia ?? 0) || 0;

  // STOP/START/HELP are answered by Twilio itself; never triage them and
  // never send a second reply.
  const keyword = classifyKeyword(message, params.OptOutType);
  if (keyword) {
    auditEvent({ event: 'twilio.keyword', channel: 'sms', conversationId, severity: null, category: keyword, verified: true });
    return sendTwiml(res, smsTwiml(''));
  }

  if (!message) {
    auditEvent({ event: 'twilio.message', channel: 'sms', conversationId, severity: null, category: null, verified: true });
    // MMS with no text still gets a helpful prompt for a description.
    return sendTwiml(res, smsTwiml(NO_MESSAGE_REPLY));
  }

  const triage = classifyMaintenanceRequest(message);
  auditEvent({
    event: 'twilio.message',
    channel: 'sms',
    conversationId,
    severity: triage.severity,
    category: triage.category,
    verified: true
  });

  let reply = triage.response;
  if (numMedia > 0 && triage.severity === 'ROUTINE') {
    reply = `${reply} Thanks for the photo${numMedia > 1 ? 's' : ''}.`;
  }

  return sendTwiml(res, smsTwiml(reply));
}
