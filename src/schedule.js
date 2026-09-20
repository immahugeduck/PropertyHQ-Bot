// Deterministic scheduling suggestions.
//
// Produces exactly two proposed service windows per request, sized by priority:
//   EMERGENCY -> two immediate windows (60-90 min, then 105-135 min)
//   URGENT    -> two business-hour blocks starting >= 12h out
//   ROUTINE   -> two business-hour blocks starting >= 24h out
//
// Vercel runs in UTC. Set TRIAGE_UTC_OFFSET_HOURS (e.g. -5 for US Eastern
// standard time) to render the windows in the property's local wall-clock
// time. Default is 0 (UTC). This is a display offset only and does not handle
// daylight-saving transitions; for multi-property or DST-accurate scheduling,
// move to a tz database (e.g. Intl/Luxon) keyed per property.

import { toSpecTier } from './triage.js';

const OFFSET_MS = (Number(process.env.TRIAGE_UTC_OFFSET_HOURS) || 0) * 3600000;

// Business-hour block start hours (each block is 2 hours long).
const BLOCK_START_HOURS = [10, 14];

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Convert an absolute instant to a "wall-clock" Date whose UTC fields equal
// the property's local time, so all formatting can read getUTC* consistently.
function toWall(date) {
  return new Date(date.getTime() + OFFSET_MS);
}

function fmtDate(wall) {
  return `${wall.getUTCFullYear()}-${pad2(wall.getUTCMonth() + 1)}-${pad2(wall.getUTCDate())}`;
}

function fmtTime(wall) {
  return `${pad2(wall.getUTCHours())}:${pad2(wall.getUTCMinutes())}`;
}

function fmtSlot(startWall, endWall) {
  return `${fmtDate(startWall)} ${fmtTime(startWall)} - ${fmtTime(endWall)}`;
}

function relativeSlot(now, startMinutes, endMinutes) {
  const start = toWall(new Date(now.getTime() + startMinutes * 60000));
  const end = toWall(new Date(now.getTime() + endMinutes * 60000));
  return fmtSlot(start, end);
}

function isWeekend(wall) {
  const dow = wall.getUTCDay();
  return dow === 0 || dow === 6;
}

// Walk forward from `earliestWall` and collect `count` two-hour business-day
// blocks (Mon-Fri) whose start is at or after the earliest allowed time.
function businessBlocks(earliestWall, count) {
  const blocks = [];
  const dayCursor = new Date(earliestWall.getTime());
  dayCursor.setUTCHours(0, 0, 0, 0);

  for (let dayOffset = 0; dayOffset < 21 && blocks.length < count; dayOffset += 1) {
    const day = new Date(dayCursor.getTime());
    day.setUTCDate(dayCursor.getUTCDate() + dayOffset);
    if (isWeekend(day)) continue;

    for (const hour of BLOCK_START_HOURS) {
      const start = new Date(day.getTime());
      start.setUTCHours(hour, 0, 0, 0);
      const end = new Date(day.getTime());
      end.setUTCHours(hour + 2, 0, 0, 0);
      if (start.getTime() >= earliestWall.getTime()) {
        blocks.push([start, end]);
        if (blocks.length >= count) break;
      }
    }
  }

  return blocks;
}

export function proposeSlots(severity, now = new Date()) {
  const tier = toSpecTier(severity);

  if (tier === 'EMERGENCY') {
    return [relativeSlot(now, 60, 90), relativeSlot(now, 105, 135)];
  }

  const minHours = tier === 'URGENT' ? 12 : 24;
  const earliest = toWall(new Date(now.getTime() + minHours * 3600000));
  return businessBlocks(earliest, 2).map(([start, end]) => fmtSlot(start, end));
}
