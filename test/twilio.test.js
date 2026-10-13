import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  verifyTwilioSignature,
  parseFormBody,
  buildWebhookUrl,
  escapeXml,
  smsTwiml,
  normalizePhoneNumber
} from '../src/twilio.js';
import smsHandler from '../api/twilio/sms.js';
import voiceHandler from '../api/twilio/voice.js';
import publicConfigHandler from '../api/twilio/public-config.js';
import { classifyKeyword } from '../src/keywords.js';

const AUTH_TOKEN = 'test-auth-token';

function twilioSignature(url, params, authToken = AUTH_TOKEN) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

function responseSpy() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; }
  };
}

function twilioRequest(url, params, { signature } = {}) {
  const rawBody = new URLSearchParams(params).toString();
  const parsed = new URL(url);
  return {
    method: 'POST',
    body: Buffer.from(rawBody),
    url: parsed.pathname,
    headers: {
      host: parsed.host,
      'x-forwarded-proto': parsed.protocol.replace(':', ''),
      'x-twilio-signature': signature ?? twilioSignature(url, params),
      'content-type': 'application/x-www-form-urlencoded'
    }
  };
}

test('a correctly signed Twilio request verifies', () => {
  const url = 'https://example.vercel.app/api/twilio/sms';
  const params = { From: '+17655551234', To: '+17657700925', Body: 'The kitchen faucet is leaking' };
  const signature = twilioSignature(url, params);
  assert.equal(verifyTwilioSignature(url, params, signature, AUTH_TOKEN), true);
});

test('a tampered Twilio request is rejected', () => {
  const url = 'https://example.vercel.app/api/twilio/sms';
  const params = { From: '+17655551234', Body: 'leak' };
  const signature = twilioSignature(url, params);
  const tampered = { ...params, Body: 'no leak' };
  assert.equal(verifyTwilioSignature(url, tampered, signature, AUTH_TOKEN), false);
});

test('signature over the wrong URL is rejected', () => {
  const params = { Body: 'leak' };
  const signature = twilioSignature('https://evil.example/api/twilio/sms', params);
  assert.equal(verifyTwilioSignature('https://example.vercel.app/api/twilio/sms', params, signature, AUTH_TOKEN), false);
});

test('parseFormBody decodes url-encoded fields', () => {
  const params = parseFormBody(Buffer.from('Body=I+smell+gas&From=%2B17655551234'));
  assert.equal(params.Body, 'I smell gas');
  assert.equal(params.From, '+17655551234');
});

test('buildWebhookUrl reconstructs the forwarded https URL', () => {
  const url = buildWebhookUrl({ url: '/api/twilio/sms', headers: { host: 'a.vercel.app', 'x-forwarded-proto': 'https' } });
  assert.equal(url, 'https://a.vercel.app/api/twilio/sms');
});

test('buildWebhookUrl honors TWILIO_WEBHOOK_BASE_URL override', () => {
  const prev = process.env.TWILIO_WEBHOOK_BASE_URL;
  process.env.TWILIO_WEBHOOK_BASE_URL = 'https://override.example/';
  try {
    assert.equal(buildWebhookUrl({ url: '/api/twilio/voice', headers: {} }), 'https://override.example/api/twilio/voice');
  } finally {
    if (prev === undefined) delete process.env.TWILIO_WEBHOOK_BASE_URL;
    else process.env.TWILIO_WEBHOOK_BASE_URL = prev;
  }
});

test('smsTwiml escapes XML-sensitive characters', () => {
  const twiml = smsTwiml('Tom & Jerry <fixed> "now"');
  assert.match(twiml, /Tom &amp; Jerry &lt;fixed&gt; &quot;now&quot;/);
  assert.match(twiml, /^<\?xml/);
});

test('escapeXml handles all sensitive characters', () => {
  assert.equal(escapeXml(`&<>"'`), '&amp;&lt;&gt;&quot;&apos;');
});

test('SMS handler returns signed triage TwiML for an emergency', async () => {
  const url = 'https://example.vercel.app/api/twilio/sms';
  const params = { From: '+17655551234', To: '+17657700925', Body: 'I smell gas in the apartment', MessageSid: 'SM1', NumMedia: '0' };
  const prev = process.env.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  try {
    const res = responseSpy();
    await smsHandler(twilioRequest(url, params), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'text/xml; charset=utf-8');
    assert.match(res.body, /<Message>/);
    assert.match(res.body, /immediate safety hazard/i);
  } finally {
    if (prev === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = prev;
  }
});

test('SMS handler rejects an invalid signature with 403', async () => {
  const url = 'https://example.vercel.app/api/twilio/sms';
  const params = { Body: 'leak', MessageSid: 'SM2' };
  const prev = process.env.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  try {
    const res = responseSpy();
    await smsHandler(twilioRequest(url, params, { signature: 'wrong' }), res);
    assert.equal(res.statusCode, 403);
  } finally {
    if (prev === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = prev;
  }
});

test('SMS handler returns 503 when the auth token is not configured', async () => {
  const url = 'https://example.vercel.app/api/twilio/sms';
  const params = { Body: 'leak' };
  const prev = process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_AUTH_TOKEN;
  try {
    const res = responseSpy();
    await smsHandler(twilioRequest(url, params), res);
    assert.equal(res.statusCode, 503);
  } finally {
    if (prev !== undefined) process.env.TWILIO_AUTH_TOKEN = prev;
  }
});

test('voice handler greets and gathers speech on the first leg', async () => {
  const url = 'https://example.vercel.app/api/twilio/voice';
  const params = { CallSid: 'CA1', From: '+17655551234', To: '+17657700925' };
  const prev = process.env.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  try {
    const res = responseSpy();
    await voiceHandler(twilioRequest(url, params), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<Gather[^>]+input="speech"/);
    assert.match(res.body, /First Call Maintenance/);
  } finally {
    if (prev === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = prev;
  }
});

test('voice handler triages a transcribed emergency and hangs up', async () => {
  const url = 'https://example.vercel.app/api/twilio/voice';
  const params = { CallSid: 'CA2', SpeechResult: 'there is a fire in the kitchen', From: '+17655551234' };
  const prev = process.env.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  try {
    const res = responseSpy();
    await voiceHandler(twilioRequest(url, params), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<Say/);
    assert.match(res.body, /call 911/i);
    assert.match(res.body, /<Hangup\/>/);
  } finally {
    if (prev === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = prev;
  }
});

test('classifyKeyword matches whole-message keywords only, ignoring case', () => {
  assert.equal(classifyKeyword('START'), 'START');
  assert.equal(classifyKeyword('  help '), 'HELP');
  assert.equal(classifyKeyword('Stop'), 'STOP');
  assert.equal(classifyKeyword('unsubscribe'), 'STOP');
  assert.equal(classifyKeyword('info'), 'HELP');
  assert.equal(classifyKeyword('help my sink is leaking'), null);
  assert.equal(classifyKeyword('please stop the dripping faucet'), null);
});

test('classifyKeyword trusts Twilio OptOutType when present', () => {
  assert.equal(classifyKeyword('SIGNUP', 'START'), 'START');
  assert.equal(classifyKeyword('ayuda', 'help'), 'HELP');
});

for (const body of ['START', 'help', 'STOP']) {
  test(`SMS handler sends no reply and skips triage for keyword ${body}`, async () => {
    const url = 'https://example.vercel.app/api/twilio/sms';
    const params = { From: '+17655551234', To: '+17657700925', Body: body, MessageSid: `SMK${body}`, NumMedia: '0' };
    const prev = process.env.TWILIO_AUTH_TOKEN;
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
    try {
      const res = responseSpy();
      await smsHandler(twilioRequest(url, params), res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['content-type'], 'text/xml; charset=utf-8');
      assert.match(res.body, /<Response><\/Response>$/);
      assert.doesNotMatch(res.body, /<Message>/);
    } finally {
      if (prev === undefined) delete process.env.TWILIO_AUTH_TOKEN;
      else process.env.TWILIO_AUTH_TOKEN = prev;
    }
  });
}

test('SMS handler still triages a request that starts with a keyword', async () => {
  const url = 'https://example.vercel.app/api/twilio/sms';
  const params = { From: '+17655551234', Body: 'help I smell gas', MessageSid: 'SMK9', NumMedia: '0' };
  const prev = process.env.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  try {
    const res = responseSpy();
    await smsHandler(twilioRequest(url, params), res);
    assert.match(res.body, /immediate safety hazard/i);
  } finally {
    if (prev === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = prev;
  }
});

test('normalizePhoneNumber accepts common US formats', () => {
  for (const input of ['+17655550123', '(765) 555-0123', '765-555-0123', '765.555.0123', '7655550123', '1 765 555 0123', ' +1 (765) 555-0123 ']) {
    assert.equal(normalizePhoneNumber(input), '+17655550123', input);
  }
  assert.equal(normalizePhoneNumber('+447911123456'), '+447911123456');
  for (const input of ['', undefined, '555-0123', 'not a number', '+0123']) {
    assert.equal(normalizePhoneNumber(input), null, String(input));
  }
});

test('public config serves a human-formatted TWILIO_NUMBER as E.164', () => {
  const prev = process.env.TWILIO_NUMBER;
  process.env.TWILIO_NUMBER = '(765) 555-0123';
  try {
    const res = responseSpy();
    publicConfigHandler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { smsNumber: '+17655550123' });
  } finally {
    if (prev === undefined) delete process.env.TWILIO_NUMBER;
    else process.env.TWILIO_NUMBER = prev;
  }
});

test('public config returns 503 when TWILIO_NUMBER is missing', () => {
  const prev = process.env.TWILIO_NUMBER;
  delete process.env.TWILIO_NUMBER;
  try {
    const res = responseSpy();
    publicConfigHandler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 503);
  } finally {
    if (prev !== undefined) process.env.TWILIO_NUMBER = prev;
  }
});
