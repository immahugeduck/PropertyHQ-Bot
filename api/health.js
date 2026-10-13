import { normalizePhoneNumber } from '../src/twilio.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  return res.status(200).json({
    status: 'ok',
    service: 'maintenance-triage-agent',
    phase: 1,
    twilioConfigured: Boolean(process.env.TWILIO_AUTH_TOKEN),
    twilioNumberSet: Boolean(String(process.env.TWILIO_NUMBER ?? '').trim()),
    twilioNumberValid: Boolean(normalizePhoneNumber(process.env.TWILIO_NUMBER)),
    agentPhoneWebhookConfigured: Boolean(process.env.AGENTPHONE_WEBHOOK_SECRET),
    inkboxWebhookConfigured: Boolean(process.env.INKBOX_WEBHOOK_SECRET)
  });
}
