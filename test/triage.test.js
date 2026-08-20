import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMaintenanceRequest } from '../src/triage.js';

test('gas smell is an emergency', () => {
  const result = classifyMaintenanceRequest('I smell gas in the apartment');
  assert.equal(result.severity, 'EMERGENCY');
  assert.equal(result.category, 'gas_or_co');
});

test('burst pipe is an emergency', () => {
  const result = classifyMaintenanceRequest('A pipe burst and water is gushing everywhere');
  assert.equal(result.severity, 'EMERGENCY');
  assert.equal(result.category, 'major_water');
});

test('no heat is urgent', () => {
  const result = classifyMaintenanceRequest('We have no heat and the furnace is not working');
  assert.equal(result.severity, 'URGENT');
  assert.equal(result.category, 'no_heat');
});

test('ordinary faucet leak is priority', () => {
  const result = classifyMaintenanceRequest('The kitchen faucet is leaking');
  assert.equal(result.severity, 'PRIORITY');
  assert.equal(result.category, 'water_leak');
});

test('general repair defaults to routine', () => {
  const result = classifyMaintenanceRequest('The bedroom closet door came off the track');
  assert.equal(result.severity, 'ROUTINE');
  assert.equal(result.category, 'general_maintenance');
});
