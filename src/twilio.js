import crypto from 'node:crypto';

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

/**
 * Read the raw request body as a Buffer, enforcing a size cap.
 * Twilio serverless handlers disable Vercel's body parser so we can both
 * parse the form fields and (if ever needed) inspect the exact bytes.
 */
export async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);

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

/** Parse an application/x-www-form-urlencoded body into a plain object. */
export function parseFormBody(rawBody) {
  const params = {};
  const search = new URLSearchParams(rawBody ? rawBody.toString('utf8') : '');
  for (const [key, value] of search.entries()) params[key] = value;
  return params;
}

/**
 * Reconstruct the exact public URL Twilio signed.
 *
 * Twilio computes its signature over the full request URL. Behind Vercel's
 * proxy the scheme/host must come from forwarded headers. Set
 * TWILIO_WEBHOOK_BASE_URL (e.g. https://your-app.vercel.app) if the
 * reconstructed URL ever fails to match your configured webhook host
 * (custom domains, redirects, etc.).
 */
export function buildWebhookUrl(req) {
  const override = process.env.TWILIO_WEBHOOK_BASE_URL;
  if (override) return override.replace(/\/+$/, '') + req.url;

  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}${req.url}`;
}

/**
 * Validate an X-Twilio-Signature for a form-encoded POST.
 * Signature = base64(HMAC-SHA1(authToken, url + concat(sortedKey + value))).
 */
export function verifyTwilioSignature(url, params, signature, authToken) {
  if (!authToken || !signature || !url || !params) return false;

  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  const expected = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
  const supplied = String(signature).trim();

  const expectedBuf = Buffer.from(expected, 'utf8');
  const suppliedBuf = Buffer.from(supplied, 'utf8');
  if (expectedBuf.length !== suppliedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, suppliedBuf);
}

/** Escape a string for safe inclusion in TwiML (XML) text nodes/attributes. */
export function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Build a TwiML SMS/MMS reply. An empty message produces a silent ack. */
export function smsTwiml(message) {
  const header = '<?xml version="1.0" encoding="UTF-8"?>';
  if (!message) return `${header}<Response></Response>`;
  return `${header}<Response><Message>${escapeXml(message)}</Message></Response>`;
}

/** Build the initial voice TwiML that greets the caller and gathers speech. */
export function voiceGatherTwiml(prompt, { action = '/api/twilio/voice', reprompt } = {}) {
  const header = '<?xml version="1.0" encoding="UTF-8"?>';
  const fallback = reprompt
    ? `<Say voice="Polly.Joanna">${escapeXml(reprompt)}</Say>`
    : '';
  return (
    `${header}<Response>` +
    `<Gather input="speech" action="${escapeXml(action)}" method="POST" speechTimeout="auto" language="en-US">` +
    `<Say voice="Polly.Joanna">${escapeXml(prompt)}</Say>` +
    `</Gather>${fallback}` +
    `</Response>`
  );
}

/** Build a voice TwiML that speaks a final response and ends the call. */
export function voiceSayTwiml(message, { hangup = true } = {}) {
  const header = '<?xml version="1.0" encoding="UTF-8"?>';
  return (
    `${header}<Response>` +
    `<Say voice="Polly.Joanna">${escapeXml(message)}</Say>` +
    (hangup ? '<Hangup/>' : '') +
    `</Response>`
  );
}

/** Send a TwiML response with the correct content type. */
export function sendTwiml(res, twiml, status = 200) {
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  return res.status(status).send(twiml);
}

/**
 * Normalize a phone number typed in any common US format
 * ("(765) 555-0123", "765-555-0123", "+1 765 555 0123") to E.164.
 * Numbers already in international E.164 form pass through.
 * Returns null when the value is not a usable number.
 */
export function normalizePhoneNumber(value) {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (raw.startsWith('+') && /^[1-9]\d{7,14}$/.test(digits)) return `+${digits}`;
  return null;
}
