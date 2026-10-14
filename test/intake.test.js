import test from 'node:test';
import assert from 'node:assert/strict';
import { recordInbound, recordReply, decorateReply, mapUrgency, mapCategory } from '../src/intake.js';
import { classifyMaintenanceRequest } from '../src/triage.js';

const ENV = {
  SUPABASE_URL: 'https://db.example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  TWILIO_ACCOUNT_SID: 'AC123',
  TWILIO_AUTH_TOKEN: 'token'
};
const SETTINGS = {
  user_id: 'mgr-1',
  twilio_number: '+17657700925',
  maintenance_phone: '(317) 645-6088',
  manager_phone: '317-645-6088',
  emergency_reply: 'Someone will call you within 30 minutes.'
};
const TENANT = { id: 'ten-1', first_name: 'Jane', last_name: 'Doe', property_id: 'prop-1' };

/**
 * Fake fetch for PostgREST + Twilio. Routes on method + table, records
 * every call, and lets each test choose what the tables hold.
 */
function fakeBackend({ settings = SETTINGS, tenant = TENANT, openRequest = null, priorInbound = [], duplicate = false } = {}) {
  const calls = [];
  let jobNumber = 1042;
  const json = (status, data) => ({ ok: status < 300, status, text: async () => JSON.stringify(data), json: async () => data });

  async function fetchImpl(url, init = {}) {
    const method = init.method ?? 'GET';
    const body = init.body && init.headers?.['Content-Type'] === 'application/json' ? JSON.parse(init.body) : init.body;
    calls.push({ url, method, body });

    if (url.startsWith('https://api.twilio.com/')) return json(201, { sid: `SMout${calls.length}`, status: 'queued' });

    const table = new URL(url).pathname.replace('/rest/v1/', '');
    if (table === 'triage_settings') return json(200, settings ? [settings] : []);
    if (table === 'tenants') return json(200, tenant ? [tenant] : []);
    if (table === 'properties') return json(200, [{ name: 'Elm Duplex', address: '12 Elm St', city: 'Greencastle' }]);
    if (table === 'sms_messages' && method === 'POST') {
      if (duplicate && body.direction === 'inbound') return json(409, { code: '23505' });
      return json(201, [{ id: `msg-${calls.length}` }]);
    }
    if (table === 'sms_messages' && method === 'GET') return json(200, priorInbound);
    if (table === 'maintenance_requests' && method === 'GET') return json(200, openRequest ? [openRequest] : []);
    if (table === 'maintenance_requests' && method === 'POST') return json(201, [{ id: 'req-1', job_number: jobNumber++ }]);
    return json(200, []);
  }
  return { fetchImpl, calls };
}

const params = (overrides = {}) => ({ From: '+17655551234', To: '+17657700925', MessageSid: 'SM1', ...overrides });

function run(message, backend, overrides = {}) {
  return recordInbound({
    params: params(overrides),
    message,
    triage: classifyMaintenanceRequest(message),
    env: ENV,
    fetchImpl: backend.fetchImpl
  });
}

test('maps triage severity and category onto Property HQ values', () => {
  assert.equal(mapUrgency('EMERGENCY'), 'emergency');
  assert.equal(mapUrgency('ROUTINE'), 'medium');
  assert.equal(mapCategory('sewage'), 'plumbing');
  assert.equal(mapCategory('general_maintenance'), 'general');
});

test('does nothing when Supabase is not configured', async () => {
  const backend = fakeBackend();
  const result = await recordInbound({ params: params(), message: 'sink leaking', triage: classifyMaintenanceRequest('sink leaking'), env: {}, fetchImpl: backend.fetchImpl });
  assert.equal(result, null);
  assert.equal(backend.calls.length, 0);
});

test('does nothing when the Twilio number has no triage settings row', async () => {
  const backend = fakeBackend({ settings: null });
  assert.equal(await run('sink leaking', backend), null);
});

test('a known tenant text creates a request, links the message, and alerts maintenance once', async () => {
  const backend = fakeBackend();
  const result = await run('The kitchen sink is leaking', backend);

  assert.equal(result.isNewRequest, true);
  assert.equal(result.jobNumber, 1042);
  assert.equal(result.tenantMatched, true);

  const created = backend.calls.find((c) => c.method === 'POST' && c.url.endsWith('/maintenance_requests'));
  assert.equal(created.body.property_id, 'prop-1');
  assert.equal(created.body.tenant_id, 'ten-1');
  assert.equal(created.body.source, 'sms');
  assert.equal(created.body.category, 'plumbing');
  assert.equal(created.body.urgency, 'high');

  const link = backend.calls.find((c) => c.method === 'PATCH' && c.url.includes('/sms_messages'));
  assert.deepEqual(link.body, { maintenance_request_id: 'req-1' });

  // maintenance_phone and manager_phone are the same number: one text, not two.
  const texts = backend.calls.filter((c) => c.url.startsWith('https://api.twilio.com/'));
  assert.equal(texts.length, 1);
  const form = new URLSearchParams(texts[0].body);
  assert.equal(form.get('To'), '+13176456088');
  assert.equal(form.get('From'), '+17657700925');
  assert.match(form.get('Body'), /job #1042/);
  assert.match(form.get('Body'), /Jane Doe @ 12 Elm St/);

  assert.equal(decorateReply('Thanks.', result), 'Thanks. Your request number is #1042.');
});

test('a follow-up text attaches to the open request without a new alert', async () => {
  const backend = fakeBackend({ openRequest: { id: 'req-9', job_number: 1009, urgency: 'medium' } });
  const result = await run('It is unit 3', backend, { MessageSid: 'SM2' });

  assert.equal(result.isNewRequest, false);
  assert.equal(result.jobNumber, 1009);
  assert.ok(!backend.calls.some((c) => c.method === 'POST' && c.url.endsWith('/maintenance_requests')));
  assert.ok(!backend.calls.some((c) => c.url.startsWith('https://api.twilio.com/')));
  assert.equal(decorateReply('Thanks.', result), 'Thanks. Added to your request #1009.');
});

test('an emergency follow-up raises the open request to emergency and alerts', async () => {
  const backend = fakeBackend({ openRequest: { id: 'req-9', job_number: 1009, urgency: 'medium' } });
  const result = await run('Now I smell gas', backend, { MessageSid: 'SM3' });

  const bump = backend.calls.find((c) => c.method === 'PATCH' && c.url.includes('/maintenance_requests'));
  assert.deepEqual(bump.body, { urgency: 'emergency' });
  assert.ok(backend.calls.some((c) => c.url.startsWith('https://api.twilio.com/')));
  const alertLog = backend.calls.find((c) => c.method === 'POST' && c.url.endsWith('/sms_messages') && c.body.kind === 'emergency_alert');
  assert.ok(alertLog);
  assert.match(decorateReply('Leave now.', result), /Someone will call you within 30 minutes\. Added to your request #1009\.$/);
});

test('a Twilio retry of the same MessageSid is detected and does nothing else', async () => {
  const backend = fakeBackend({ duplicate: true });
  const result = await run('The kitchen sink is leaking', backend);
  assert.deepEqual(result, { duplicate: true });
  assert.ok(!backend.calls.some((c) => c.url.includes('/maintenance_requests')));
  assert.ok(!backend.calls.some((c) => c.url.startsWith('https://api.twilio.com/')));
});

test('an unknown number is logged and alerts maintenance on its first text only', async () => {
  const first = fakeBackend({ tenant: null, priorInbound: [{ id: 'just-logged' }] });
  const result = await run('My dishwasher is broken', first);
  assert.equal(result.tenantMatched, false);
  assert.equal(result.jobNumber, null);
  const inbound = first.calls.find((c) => c.method === 'POST' && c.url.endsWith('/sms_messages'));
  assert.equal(inbound.body.party, 'unknown');
  const text = first.calls.find((c) => c.url.startsWith('https://api.twilio.com/'));
  assert.match(new URLSearchParams(text.body).get('Body'), /Unknown number/);

  const later = fakeBackend({ tenant: null, priorInbound: [{ id: 'a' }, { id: 'b' }] });
  await run('Hello?', later, { MessageSid: 'SM4' });
  assert.ok(!later.calls.some((c) => c.url.startsWith('https://api.twilio.com/')));
});

test('the tenant reply is logged against the request', async () => {
  const backend = fakeBackend();
  const result = await run('The kitchen sink is leaking', backend);
  await recordReply(result.context, 'Thanks. Your request number is #1042.');
  const reply = backend.calls.at(-1);
  assert.equal(reply.body.direction, 'outbound');
  assert.equal(reply.body.party, 'tenant');
  assert.equal(reply.body.to_number, '+17655551234');
  assert.equal(reply.body.maintenance_request_id, 'req-1');
});
