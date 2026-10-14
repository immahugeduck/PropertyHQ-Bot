import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMaintenanceRequest } from '../src/triage.js';

test('gas smell is an emergency', () => {
  const result = classifyMaintenanceRequest('I smell gas in the apartment');
  assert.equal(result.severity, 'EMERGENCY');
  assert.equal(result.category, 'gas_or_co');
});

test('propane smell and a CO detector are emergencies', () => {
  assert.equal(classifyMaintenanceRequest('There is a propane smell in the kitchen').severity, 'EMERGENCY');
  assert.equal(classifyMaintenanceRequest('The CO detector is going off').severity, 'EMERGENCY');
});

test('burst pipe is an emergency', () => {
  const result = classifyMaintenanceRequest('A pipe burst and water is gushing everywhere');
  assert.equal(result.severity, 'EMERGENCY');
  assert.equal(result.category, 'major_water');
});

test('no heat and no AC are emergencies under the manager policy', () => {
  const result = classifyMaintenanceRequest('We have no heat and the furnace is not working');
  assert.equal(result.severity, 'EMERGENCY');
  assert.equal(result.category, 'no_hvac');
  assert.equal(classifyMaintenanceRequest('The AC is not working').severity, 'EMERGENCY');
});

test('ordinary faucet leak is priority', () => {
  const result = classifyMaintenanceRequest('The kitchen faucet is leaking');
  assert.equal(result.severity, 'PRIORITY');
  assert.equal(result.category, 'water_leak');
});

test('an active roof leak is an emergency', () => {
  const result = classifyMaintenanceRequest('The roof is leaking into the bedroom');
  assert.equal(result.severity, 'EMERGENCY');
  assert.equal(result.category, 'major_water');
});

test('an overflowing toilet is urgent even when sewage is not named', () => {
  const result = classifyMaintenanceRequest('The upstairs toilet is overflowing');
  assert.equal(result.severity, 'URGENT');
  assert.equal(result.category, 'sewage');
});

test('general repair defaults to routine', () => {
  const result = classifyMaintenanceRequest('The bedroom closet door came off the track');
  assert.equal(result.severity, 'ROUTINE');
  assert.equal(result.category, 'general_maintenance');
});

test('worsening or spraying water escalates to a major water emergency', () => {
  for (const text of [
    "Okay the water is coming a lot more now. It's spraying everywhere",
    'Water is spraying from under the sink',
    'The basement is flooding',
    'There is water all over the kitchen floor',
    "The leak is getting worse and won't stop"
  ]) {
    const result = classifyMaintenanceRequest(text);
    assert.equal(result.severity, 'EMERGENCY', text);
    assert.equal(result.category, 'major_water', text);
  }
});

test('an ordinary slow leak stays a priority water request', () => {
  const result = classifyMaintenanceRequest('The bathroom faucet is dripping');
  assert.equal(result.severity, 'PRIORITY');
  assert.equal(result.category, 'water_leak');
});
