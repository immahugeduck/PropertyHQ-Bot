import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeSlots } from '../src/schedule.js';

const SLOT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} - \d{2}:\d{2}$/;

test('every priority produces exactly two well-formed slots', () => {
  for (const severity of ['ROUTINE', 'PRIORITY', 'URGENT', 'EMERGENCY']) {
    const slots = proposeSlots(severity, new Date('2026-01-05T09:00:00Z')); // Monday
    assert.equal(slots.length, 2, `${severity} should yield 2 slots`);
    for (const slot of slots) assert.match(slot, SLOT_RE, `${severity} slot format: ${slot}`);
  }
});

test('emergency windows are immediate (60-90 min, then 105-135 min)', () => {
  const now = new Date('2026-01-05T09:00:00Z');
  const [first, second] = proposeSlots('EMERGENCY', now);
  assert.equal(first, '2026-01-05 10:00 - 10:30');
  assert.equal(second, '2026-01-05 10:45 - 11:15');
});

test('urgent slots start at least 12h out and land in business hours', () => {
  const now = new Date('2026-01-05T09:00:00Z'); // Monday 09:00
  const slots = proposeSlots('URGENT', now);
  // 12h out = 21:00 Monday, so the next business block is Tuesday 10:00.
  assert.equal(slots[0], '2026-01-06 10:00 - 12:00');
  assert.equal(slots[1], '2026-01-06 14:00 - 16:00');
});

test('routine slots skip the weekend', () => {
  const now = new Date('2026-01-09T09:00:00Z'); // Friday 09:00
  const slots = proposeSlots('ROUTINE', now);
  // 24h out = Saturday; business blocks fall on Monday.
  assert.equal(slots[0], '2026-01-12 10:00 - 12:00');
  assert.equal(slots[1], '2026-01-12 14:00 - 16:00');
});
