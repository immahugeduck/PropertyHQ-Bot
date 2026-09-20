import test from 'node:test';
import assert from 'node:assert/strict';
import { sendSms, dispatchNotifications, parseRecipients, twilioConfigured } from '../src/notify.js';

function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  return (async () => {
    try {
      return await fn();
    } finally {
      for (const key of Object.keys(vars)) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  })();
}

const TWILIO_ENV = {
  TWILIO_ACCOUNT_SID: 'ACtest',
  TWILIO_AUTH_TOKEN: 'tok',
  TWILIO_FROM_NUMBER: '+15550000000'
};

test('parseRecipients splits and trims comma lists', () => {
  assert.deepEqual(parseRecipients(' +1555, +1666 ,, +1777'), ['+1555', '+1666', '+1777']);
  assert.deepEqual(parseRecipients(''), []);
  assert.deepEqual(parseRecipients(undefined), []);
});

test('sendSms is skipped (not thrown) when Twilio is not configured', () =>
  withEnv({ TWILIO_ACCOUNT_SID: undefined, TWILIO_AUTH_TOKEN: undefined, TWILIO_FROM_NUMBER: undefined }, async () => {
    assert.equal(twilioConfigured(), false);
    const result = await sendSms('+15551234567', 'hello');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'twilio_not_configured');
  }));

test('sendSms posts to Twilio with basic auth and form body', () =>
  withEnv(TWILIO_ENV, async () => {
    let captured = null;
    const fetchImpl = async (url, init) => {
      captured = { url, init };
      return { ok: true, status: 201, json: async () => ({ sid: 'SM123' }) };
    };
    const result = await sendSms('+15551234567', 'test body', { fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.sid, 'SM123');
    assert.match(captured.url, /\/Accounts\/ACtest\/Messages\.json$/);
    assert.match(captured.init.headers.Authorization, /^Basic /);
    const body = new URLSearchParams(captured.init.body);
    assert.equal(body.get('To'), '+15551234567');
    assert.equal(body.get('From'), '+15550000000');
    assert.equal(body.get('Body'), 'test body');
  }));

test('sendSms surfaces Twilio API errors without throwing', () =>
  withEnv(TWILIO_ENV, async () => {
    const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ message: 'Invalid To' }) });
    const result = await sendSms('+1bad', 'x', { fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.error, 'Invalid To');
  }));

test('dispatchNotifications sends to both recipient lists', () =>
  withEnv(
    { ...TWILIO_ENV, MAINTENANCE_ESCALATION_NUMBERS: '+1111,+1222', MANAGER_NOTIFY_NUMBERS: '+1333' },
    async () => {
      const calls = [];
      const fetchImpl = async (_url, init) => {
        calls.push(new URLSearchParams(init.body).get('To'));
        return { ok: true, status: 201, json: async () => ({ sid: 'SM' }) };
      };
      const summary = await dispatchNotifications(
        { maintenanceBody: 'maint', managerBody: 'mgr' },
        { fetchImpl }
      );
      assert.equal(summary.configured, true);
      assert.equal(summary.maintenance.sent, 2);
      assert.equal(summary.manager.sent, 1);
      assert.deepEqual(calls, ['+1111', '+1222', '+1333']);
    }
  ));

test('dispatchNotifications degrades gracefully with no recipients', () =>
  withEnv(
    { ...TWILIO_ENV, MAINTENANCE_ESCALATION_NUMBERS: undefined, MANAGER_NOTIFY_NUMBERS: undefined },
    async () => {
      const summary = await dispatchNotifications({ maintenanceBody: 'm', managerBody: 'g' });
      assert.equal(summary.maintenance.sent, 0);
      assert.equal(summary.manager.sent, 0);
    }
  ));
