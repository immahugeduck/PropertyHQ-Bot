import {
  readRawBody,
  parseFormBody,
  buildWebhookUrl,
  verifyTwilioSignature,
  smsTwiml,
  sendTwiml
} from '../../src/twilio.js';

export const config = {
  api: {
    bodyParser: false
  }
};

const FALLBACK_REPLY =
  'First Call Maintenance: We received your message, but our automated maintenance assistant is temporarily unavailable. If there is an immediate threat to life or property, call 911 or the appropriate utility emergency line. Otherwise, please try again shortly.';

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
    if (error.code === 'PAYLOAD_TOO_LARGE') {
      return res.status(413).json({ error: 'payload_too_large' });
    }
    throw error;
  }

  const params = parseFormBody(rawBody);
  const url = buildWebhookUrl(req);
  const signature = req.headers['x-twilio-signature'] ?? '';

  if (!verifyTwilioSignature(url, params, signature, authToken)) {
    return res.status(403).json({ error: 'invalid_signature' });
  }

  console.error('Twilio SMS fallback invoked', {
    messageSid: params.MessageSid ?? null,
    errorCode: params.ErrorCode ?? null
  });

  return sendTwiml(res, smsTwiml(FALLBACK_REPLY));
}
