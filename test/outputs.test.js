import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMaintenanceRequest } from '../src/triage.js';
import { buildTriagePayload, extractEntities, formatMaintenanceSms, formatManagerSms } from '../src/outputs.js';

const NOW = new Date('2026-01-05T09:00:00Z'); // Monday

function payloadFor(message, opts = {}) {
  const triage = classifyMaintenanceRequest(message);
  return buildTriagePayload({ message, triage, now: NOW, ...opts });
}

test('emergency payload maps to spec EMERGENCY tier and provides containment', () => {
  const p = payloadFor('Water is pouring out from under the kitchen sink and flooding the floor');
  assert.equal(p.triage_summary.priority, 'EMERGENCY');
  assert.equal(p.triage_summary.category, 'PLUMBING');
  assert.ok(p.triage_summary.containment_instructions_provided);
  assert.equal(p.triage_summary.proposed_schedule_slots.length, 2);
  assert.equal(p.manager_update.status, 'ACTION_REQUIRED');
  assert.equal(p.maintenance_dispatch.priority_banner, '[CRITICAL EMERGENCY]');
  assert.ok(p.maintenance_dispatch.suggested_parts_tools.length > 0);
});

test('internal PRIORITY collapses into spec URGENT', () => {
  const p = payloadFor('The kitchen faucet is leaking');
  assert.equal(p._meta.internalSeverity, 'PRIORITY');
  assert.equal(p.triage_summary.priority, 'URGENT');
});

test('new URGENT categories classify and carry parts', () => {
  const fridge = payloadFor('The refrigerator stopped working and food is going bad');
  assert.equal(fridge.triage_summary.priority, 'URGENT');
  assert.equal(fridge.triage_summary.category, 'APPLIANCE');

  const heater = payloadFor('The water heater is leaking slowly in the closet');
  assert.equal(heater.triage_summary.category, 'PLUMBING');
  assert.equal(heater._meta.internalCategory, 'water_heater');

  const lock = payloadFor("The front door deadbolt is broken and I can't lock it");
  assert.equal(lock.triage_summary.priority, 'URGENT');
  assert.equal(lock.triage_summary.category, 'STRUCTURAL');
});

test('routine payload proposes windows and asks for confirmation', () => {
  const p = payloadFor('The closet door sticks and squeaks');
  assert.equal(p.triage_summary.priority, 'ROUTINE');
  assert.equal(p.manager_update.status, 'INFO_ONLY');
  assert.match(p.tenant_message.body, /confirm/i);
});

test('entity extraction pulls unit and entry permission', () => {
  const e = extractEntities('Unit 4B here, you have permission to enter while I am at work');
  assert.equal(e.unit, '4B');
  assert.equal(e.entryPermission, 'granted');

  const e2 = extractEntities('I must be home for this one please');
  assert.equal(e2.entryPermission, 'tenant_must_be_present');
});

test('sms formatters render dispatch and manager lines', () => {
  const p = payloadFor('The refrigerator stopped working', { unit: '12' });
  const maint = formatMaintenanceSms(p);
  assert.match(maint, /\[URGENT\] APPLIANCE - Unit 12/);
  assert.match(maint, /Prep:/);
  assert.equal(formatManagerSms(p), p.manager_update.summary_line);
});
