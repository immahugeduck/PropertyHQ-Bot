import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStaffCommand, parseScheduleTime, formatWhen, zonedTimeToDate } from '../src/staff.js';
import { recordInbound, decorateReply } from '../src/intake.js';
import { classifyMaintenanceRequest } from '../src/triage.js';

const TZ = 'America/Indiana/Indianapolis';
// Wednesday Oct 14 2026, 10:59 AM in Indiana (EDT, UTC-4).
const NOW = new Date('2026-10-14T14:59:00Z');
const local = (d) => formatWhen(d, TZ);

test('zonedTimeToDate converts Indiana wall time to UTC across DST', () => {
  assert.equal(zonedTimeToDate(2026, 10, 14, 12, 30, TZ).toISOString(), '2026-10-14T16:30:00.000Z');
  assert.equal(zonedTimeToDate(2026, 12, 1, 9, 0, TZ).toISOString(), '2026-12-01T14:00:00.000Z');
});

test('parses the times staff actually text', () => {
  assert.equal(local(parseScheduleTime('Okay I will be by there at 12:30 to resolve both issues', NOW, TZ)), 'Wed, Oct 14 at 12:30 PM');
  assert.equal(local(parseScheduleTime('1003 2pm', NOW, TZ)), 'Wed, Oct 14 at 2:00 PM');
  assert.equal(local(parseScheduleTime('1003 tomorrow 9am', NOW, TZ)), 'Thu, Oct 15 at 9:00 AM');
  assert.equal(local(parseScheduleTime('1003 friday at 3', NOW, TZ)), 'Fri, Oct 16 at 3:00 PM');
  assert.equal(local(parseScheduleTime('1003 10/20 8:15 am', NOW, TZ)), 'Tue, Oct 20 at 8:15 AM');
  assert.equal(local(parseScheduleTime('1003 noon', NOW, TZ)), 'Wed, Oct 14 at 12:00 PM');
  // 9:30 has already passed today, so it means tomorrow.
  assert.equal(local(parseScheduleTime('1003 9:30', NOW, TZ)), 'Thu, Oct 15 at 9:30 AM');
  // Same weekday name means next week, not today.
  assert.equal(local(parseScheduleTime('wed 2pm', NOW, TZ)), 'Wed, Oct 21 at 2:00 PM');
});

test('does not mistake job numbers or counts for times', () => {
  assert.equal(parseScheduleTime('1003 done', NOW, TZ), null);
  assert.equal(parseScheduleTime('fixed 2 sinks', NOW, TZ), null);
  assert.equal(parseScheduleTime('This is the maintenance number. Are you able to log that', NOW, TZ), null);
});

test('parseStaffCommand picks schedule, complete, or help', () => {
  assert.deepEqual(
    { ...parseStaffCommand('1003 tomorrow 2pm', NOW, TZ), scheduledAt: undefined },
    { action: 'schedule', jobNumber: 1003, scheduledAt: undefined }
  );
  assert.deepEqual(parseStaffCommand('#1003 done', NOW, TZ), { action: 'complete', jobNumber: 1003 });
  assert.deepEqual(parseStaffCommand('all set at Berkshire', NOW, TZ), { action: 'complete', jobNumber: null });
  assert.equal(parseStaffCommand('be there at 12:30 to resolve both issues', NOW, TZ).action, 'schedule');
  assert.deepEqual(parseStaffCommand('hello?', NOW, TZ), { action: 'help', jobNumber: null });
});

const ENV = {
  SUPABASE_URL: 'https://db.example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  TWILIO_ACCOUNT_SID: 'AC123',
  TWILIO_AUTH_TOKEN: 'token'
};
const SETTINGS = {
  user_id: 'mgr-1',
  twilio_number: '+17657700925',
  maintenance_phone: '+17657709030',
  manager_phone: '+13176456088',
  timezone: TZ
};
const REQUEST = { id: 'req-3', job_number: 1003, status: 'open', tenant_id: 'ten-1', property_id: 'prop-1' };

function fakeBackend({ request = REQUEST, alerts = [{ maintenance_request_id: 'req-3' }], pending = null, tenantPhone = '+17652464405' } = {}) {
  const calls = [];
  const json = (status, data) => ({ ok: status < 300, status, text: async () => JSON.stringify(data), json: async () => data });
  async function fetchImpl(url, init = {}) {
    const method = init.method ?? 'GET';
    const body = init.body && init.headers?.['Content-Type'] === 'application/json' ? JSON.parse(init.body) : init.body;
    calls.push({ url, method, body });
    if (url.startsWith('https://api.twilio.com/')) return json(201, { sid: `SM${calls.length}`, status: 'queued' });
    const u = new URL(url);
    const table = u.pathname.replace('/rest/v1/', '');
    if (table === 'triage_settings') return json(200, [SETTINGS]);
    if (table === 'sms_messages' && method === 'POST') return json(201, [{ id: `msg-${calls.length}` }]);
    if (table === 'sms_messages' && method === 'GET') {
      return json(200, u.search.includes('reply_to_number') ? (pending ? [pending] : []) : alerts);
    }
    if (table === 'maintenance_requests' && method === 'GET') return json(200, request ? [request] : []);
    if (table === 'maintenance_requests' && method === 'PATCH') return json(200, [{ ...request, ...body, completed_at: body.status === 'completed' ? '2026-10-14T15:00:00Z' : null }]);
    if (table === 'tenants') return json(200, [{ id: 'ten-1', first_name: 'Claude', last_name: 'Codemaster', phone_e164: tenantPhone }]);
    if (table === 'properties') return json(200, [{ name: 'Berkshire Apartments', address: '601 E Washington St APT #10' }]);
    return json(200, []);
  }
  return { fetchImpl, calls };
}

function staffText(message, backend, from = '+17657709030') {
  return recordInbound({
    params: { From: from, To: '+17657700925', MessageSid: 'SMstaff' },
    message,
    triage: classifyMaintenanceRequest(message),
    env: ENV,
    fetchImpl: backend.fetchImpl,
    now: NOW
  });
}

const twilioTexts = (backend) =>
  backend.calls.filter((c) => c.url.startsWith('https://api.twilio.com/')).map((c) => Object.fromEntries(new URLSearchParams(c.body)));

test('a short staff reply with a time schedules the last alerted job and texts tenant + manager', async () => {
  const backend = fakeBackend();
  const result = await staffText('be there at 12:30', backend);

  const patch = backend.calls.find((c) => c.method === 'PATCH' && c.url.includes('/maintenance_requests'));
  assert.equal(patch.body.scheduled_at, '2026-10-14T16:30:00.000Z');
  assert.equal(patch.body.scheduled_date, '2026-10-14');
  assert.equal(patch.body.status, 'in_progress');

  const texts = twilioTexts(backend);
  assert.deepEqual(texts.map((t) => t.To), ['+17652464405', '+13176456088']);
  assert.match(texts[0].Body, /scheduled to come out Wed, Oct 14 at 12:30 PM for your request #1003/);
  assert.match(texts[1].Body, /job #1003 \(Claude Codemaster @ 601 E Washington St APT #10\) scheduled/);

  // Staff text is logged as maintenance, never opens a request or alerts itself.
  const inbound = backend.calls.find((c) => c.method === 'POST' && c.url.endsWith('/sms_messages'));
  assert.equal(inbound.body.party, 'maintenance');
  assert.ok(!backend.calls.some((c) => c.method === 'POST' && c.url.endsWith('/maintenance_requests')));
  assert.equal(decorateReply('ignored triage text', result), 'Got it. Job #1003 scheduled Wed, Oct 14 at 12:30 PM. Tenant notified.');
});

test('"1003 done" completes the job and records the completion notice', async () => {
  const backend = fakeBackend();
  const result = await staffText('1003 done', backend);

  const lookup = backend.calls.find((c) => c.method === 'GET' && c.url.includes('/maintenance_requests'));
  assert.match(lookup.url, /job_number=eq\.1003/);
  const patches = backend.calls.filter((c) => c.method === 'PATCH' && c.url.includes('/maintenance_requests'));
  assert.deepEqual(patches[0].body, { status: 'completed' });
  assert.ok(patches[1].body.completion_notified_at);

  const notice = backend.calls.find((c) => c.method === 'POST' && c.url.endsWith('/sms_messages') && c.body.party === 'tenant');
  assert.equal(notice.body.kind, 'completion_notice');
  assert.equal(notice.body.completed_at, '2026-10-14T15:00:00Z');
  assert.equal(result.staffReply, 'Job #1003 marked complete. Tenant notified.');
});

test('the manager texting an update does not text themselves', async () => {
  const backend = fakeBackend();
  await staffText('1003 done', backend, '+13176456088');
  assert.deepEqual(twilioTexts(backend).map((t) => t.To), ['+17652464405']);
});

test('a staff text that is not an update, with nothing to answer, gets the how-to reply', async () => {
  const backend = fakeBackend();
  const result = await staffText('This is the maintenance number. Are you able to log that or should I hard write that', backend);
  assert.match(result.staffReply, /^To update a job, text the job number/);
  assert.ok(!backend.calls.some((c) => c.method === 'PATCH'));
  assert.equal(twilioTexts(backend).length, 0);
});

test('an unknown job number is reported back to staff', async () => {
  const backend = fakeBackend({ request: null });
  const result = await staffText('1099 done', backend);
  assert.match(result.staffReply, /^I couldn't find job #1099/);
  assert.equal(twilioTexts(backend).length, 0);
});

const PENDING = { reply_to_number: '+17652464405', tenant_id: 'ten-1', maintenance_request_id: 'req-3' };

test('a free-text reply to an alert is relayed word for word to that tenant', async () => {
  const backend = fakeBackend({ pending: PENDING });
  const answer = 'The main shutoff is in the basement next to the water heater. Turn the red handle clockwise until it stops.';
  const result = await staffText(answer, backend);

  const texts = twilioTexts(backend);
  assert.deepEqual(texts.map((t) => t.To), ['+17652464405']);
  assert.equal(texts[0].Body, `Maintenance: ${answer}`);
  const log = backend.calls.find((c) => c.method === 'POST' && c.url.endsWith('/sms_messages') && c.body.kind === 'staff_relay');
  assert.equal(log.body.party, 'tenant');
  assert.equal(log.body.maintenance_request_id, 'req-3');
  assert.ok(!backend.calls.some((c) => c.method === 'PATCH' && c.url.includes('/maintenance_requests')));
  assert.equal(result.staffReply, 'Sent to Claude Codemaster (job #1003).');
});

test('a relayed reply that names a time also schedules the job, without a second tenant text', async () => {
  const backend = fakeBackend({ pending: PENDING });
  const result = await staffText('Okay I will be by there at 12:30 to resolve both issues', backend);

  const patch = backend.calls.find((c) => c.method === 'PATCH' && c.url.includes('/maintenance_requests'));
  assert.equal(patch.body.scheduled_at, '2026-10-14T16:30:00.000Z');
  const texts = twilioTexts(backend);
  // Tenant gets the tech's own words; the manager line gets the schedule update.
  assert.deepEqual(texts.map((t) => t.To), ['+17652464405', '+13176456088']);
  assert.equal(texts[0].Body, 'Maintenance: Okay I will be by there at 12:30 to resolve both issues');
  assert.match(texts[1].Body, /job #1003 .* scheduled Wed, Oct 14 at 12:30 PM/);
  assert.equal(result.staffReply, 'Sent to Claude Codemaster (job #1003). Job #1003 scheduled Wed, Oct 14 at 12:30 PM.');
});

test('a reply to an unknown sender is relayed to their number', async () => {
  const backend = fakeBackend({ pending: { reply_to_number: '+17655550000', tenant_id: null, maintenance_request_id: null } });
  const result = await staffText('Which apartment are you in? I can come take a look this afternoon.', backend);
  const texts = twilioTexts(backend);
  assert.deepEqual(texts.map((t) => t.To), ['+17655550000']);
  assert.equal(result.staffReply, 'Sent to +17655550000.');
});

test('"1003 <message>" sends the message to that job\'s tenant', async () => {
  const backend = fakeBackend();
  const result = await staffText('1003 running about 10 minutes late', backend);
  const texts = twilioTexts(backend);
  assert.equal(texts[0].To, '+17652464405');
  assert.equal(texts[0].Body, 'Maintenance: running about 10 minutes late');
  assert.equal(result.staffReply, 'Sent to Claude Codemaster (job #1003).');
});

test('short commands still act as commands even with a pending question', async () => {
  const backend = fakeBackend({ pending: PENDING });
  const result = await staffText('1003 done', backend);
  assert.equal(result.staffReply, 'Job #1003 marked complete. Tenant notified.');
  assert.ok(!backend.calls.some((c) => c.method === 'POST' && c.body?.kind === 'staff_relay'));
});

test('"help" always gets the how-to reply', async () => {
  const backend = fakeBackend({ pending: PENDING });
  const result = await staffText('help', backend);
  assert.match(result.staffReply, /^To update a job/);
  assert.equal(twilioTexts(backend).length, 0);
});
