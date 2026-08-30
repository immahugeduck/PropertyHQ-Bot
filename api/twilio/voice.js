import {
  readRawBody,
  parseFormBody,
  buildWebhookUrl,
  verifyTwilioSignature,
  voiceGatherTwiml,
  voiceSayTwiml,
  sendTwiml
} from '../../src/twilio.js';
import { classifyMaintenanceRequest } from '../../src/triage.js';
import { auditEvent } from '../../src/audit.js';

export const config = {
  api: {
    bodyParser: false
  }
};

const GREETING =
  'Thank you for calling First Call Maintenance. After the tone, briefly describe the maintenance problem, including the property address or unit.';
const REPROMPT =
  'Sorry, I did not catch that. Please call back and describe the maintenance problem after the tone.';

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
    auditEvent({ event: 'twilio.voice', channel: 'voice', conversationId: null, severity: null, category: null, verified: false });
    return res.status(403).json({ error: 'invalid_signature' });
  }

  const conversationId = params.CallSid ?? null;
  const speech = String(params.SpeechResult ?? '').trim();

  // First leg of the call: greet the caller and gather their spoken request.
  if (!speech) {
    auditEvent({ event: 'twilio.voice', channel: 'voice', conversationId, severity: null, category: null, verified: true });
    return sendTwiml(res, voiceGatherTwiml(GREETING, { reprompt: REPROMPT }));
  }

  // Second leg: Twilio has transcribed the caller's speech. Triage it.
  const triage = classifyMaintenanceRequest(speech);
  auditEvent({
    event: 'twilio.voice',
    channel: 'voice',
    conversationId,
    severity: triage.severity,
    category: triage.category,
    verified: true
  });

  const closing =
    triage.severity === 'EMERGENCY'
      ? triage.response
      : `${triage.response} A member of the maintenance team will follow up. Goodbye.`;

  return sendTwiml(res, voiceSayTwiml(closing));
}
