/**
 * Staff replies: texts to the Twilio number from the maintenance or manager
 * phone in triage_settings are job updates, not tenant requests.
 *
 *   "1003 tomorrow 2pm"  -> schedule job #1003, text the tenant and manager
 *   "be there at 12:30"  -> schedule the job most recently alerted to that phone
 *   "1003 done"          -> mark complete, text the tenant and manager
 *
 * Anything else gets a short how-to reply. Staff texts never open requests.
 */
import { supabaseRequest, eq } from './supabase.js';
import { logMessage, sendSms } from './intake.js';
import { normalizePhoneNumber } from './twilio.js';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const COMPLETE_WORDS = /\b(done|complete|completed|finished|fixed|resolved|all set)\b/i;
const HELP =
  'To update a job, text the job number and a time or "done". Examples: "1003 tomorrow 2pm", "1003 12:30", "1003 done".';

/** Calendar date and wall-clock parts of `date` in `timeZone`. */
function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'long'
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf(parts.weekday.toLowerCase())
  };
}

/** The instant when the wall clock in `timeZone` reads y-m-d h:min. */
export function zonedTimeToDate(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const p = zonedParts(new Date(guess), timeZone);
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess;
  return new Date(guess - offset);
}

/**
 * Pull a time (and optional day) out of a staff text. Needs a clear time:
 * "12:30", "2pm", "2 pm", "noon", or "at 2". A bare hour without am/pm is
 * read as working hours: 7-11 morning, 12-6 afternoon.
 */
export function parseScheduleTime(text, now, timeZone) {
  const lower = String(text).toLowerCase();
  let hour;
  let minute = 0;

  if (/\bnoon\b/.test(lower)) {
    hour = 12;
  } else {
    const m =
      lower.match(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?(?![\d])/) ||
      lower.match(/\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/) ||
      lower.match(/(?:\bat|@)\s*(\d{1,2})\b(?!\s*[:\d])/);
    if (!m) return null;
    hour = Number(m[1]);
    const hasMinutes = m[2] !== undefined && /^\d{2}$/.test(m[2]);
    if (hasMinutes) minute = Number(m[2]);
    const meridiem = hasMinutes ? m[3] : m[2] && !/^\d/.test(m[2]) ? m[2] : undefined;
    if (hour > 23 || minute > 59) return null;
    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      const pm = meridiem.startsWith('p');
      if (pm && hour !== 12) hour += 12;
      if (!pm && hour === 12) hour = 0;
    } else if (hour >= 1 && hour <= 6) {
      hour += 12;
    }
  }

  const today = zonedParts(now, timeZone);
  let { year, month, day } = today;
  let dayGiven = false;

  const md = lower.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  const weekday = WEEKDAYS.findIndex((d) => new RegExp(`\\b(${d}|${d.slice(0, 3)})\\b`).test(lower));
  let addDays = 0;
  if (/\btomorrow\b/.test(lower)) {
    addDays = 1;
    dayGiven = true;
  } else if (/\btoday\b|\btonight\b/.test(lower)) {
    dayGiven = true;
  } else if (md) {
    month = Number(md[1]);
    day = Number(md[2]);
    dayGiven = true;
    if (month < today.month || (month === today.month && day < today.day)) year += 1;
  } else if (weekday >= 0) {
    addDays = (weekday - today.weekday + 7) % 7 || 7;
    dayGiven = true;
  }

  if (addDays) {
    const base = new Date(Date.UTC(year, month - 1, day + addDays));
    year = base.getUTCFullYear();
    month = base.getUTCMonth() + 1;
    day = base.getUTCDate();
  }

  let when = zonedTimeToDate(year, month, day, hour, minute, timeZone);
  // "12:30" with no day, sent after 12:30, means tomorrow.
  if (!dayGiven && when.getTime() < now.getTime()) {
    const base = new Date(Date.UTC(year, month - 1, day + 1));
    when = zonedTimeToDate(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hour, minute, timeZone);
  }
  return when;
}

/** Work out what a staff text asks for. */
export function parseStaffCommand(text, now, timeZone) {
  const body = String(text ?? '');
  const job = body.match(/#?\b(\d{4,6})\b(?!\s*[:/]|\s*(?:am|pm|a\.m|p\.m))/i);
  const jobNumber = job ? Number(job[1]) : null;
  const scheduledAt = parseScheduleTime(body, now, timeZone);
  if (scheduledAt) return { action: 'schedule', jobNumber, scheduledAt };
  if (COMPLETE_WORDS.test(body)) return { action: 'complete', jobNumber };
  return { action: 'help', jobNumber };
}

export function formatWhen(date, timeZone) {
  const dayPart = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(date);
  const timePart = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date);
  return `${dayPart} at ${timePart}`;
}

/** Which party a phone number is, if it's one of the staff lines. */
export function staffParty(settings, phone) {
  if (phone && phone === normalizePhoneNumber(settings.maintenance_phone)) return 'maintenance';
  if (phone && phone === normalizePhoneNumber(settings.manager_phone)) return 'manager';
  return null;
}

const REQUEST_FIELDS = 'id,job_number,status,tenant_id,property_id';

async function findRequest({ db, userId, jobNumber, fromNumber, fetchImpl }) {
  if (jobNumber) {
    const res = await supabaseRequest(db, `maintenance_requests?select=${REQUEST_FIELDS}&user_id=${eq(userId)}&job_number=${eq(jobNumber)}&limit=1`, { fetchImpl });
    return res.ok && Array.isArray(res.data) ? res.data[0] ?? null : null;
  }
  // No job number: the open job most recently alerted to this phone.
  const alerts = await supabaseRequest(
    db,
    `sms_messages?select=maintenance_request_id&user_id=${eq(userId)}&direction=eq.outbound&to_number=${eq(fromNumber)}&kind=in.(new_request_alert,emergency_alert)&maintenance_request_id=not.is.null&order=created_at.desc&limit=10`,
    { fetchImpl }
  );
  const ids = [...new Set((alerts.ok && Array.isArray(alerts.data) ? alerts.data : []).map((a) => a.maintenance_request_id))];
  for (const id of ids) {
    const res = await supabaseRequest(db, `maintenance_requests?select=${REQUEST_FIELDS}&id=${eq(id)}&status=in.(open,in_progress)&limit=1`, { fetchImpl });
    const request = res.ok && Array.isArray(res.data) ? res.data[0] : null;
    if (request) return request;
  }
  return null;
}

/**
 * Handle a text from the maintenance or manager phone. Returns the reply
 * text for the staff member. The inbound message is already logged.
 */
export async function handleStaffMessage({ db, settings, party, message, inboundId, fromNumber, twilioNumber, env, fetchImpl, now }) {
  const userId = settings.user_id;
  const timeZone = settings.timezone || 'America/Indiana/Indianapolis';
  const command = parseStaffCommand(message, now, timeZone);
  if (command.action === 'help') return HELP;

  const request = await findRequest({ db, userId, jobNumber: command.jobNumber, fromNumber, fetchImpl });
  if (!request) {
    return command.jobNumber
      ? `I couldn't find job #${command.jobNumber}. ${HELP}`
      : `I couldn't tell which job that's for. ${HELP}`;
  }
  if (inboundId) {
    await supabaseRequest(db, `sms_messages?id=${eq(inboundId)}`, { method: 'PATCH', body: { maintenance_request_id: request.id }, fetchImpl });
  }

  const tenantRes = request.tenant_id
    ? await supabaseRequest(db, `tenants?select=id,first_name,last_name,phone_e164&id=${eq(request.tenant_id)}&limit=1`, { fetchImpl })
    : null;
  const tenant = tenantRes?.ok && Array.isArray(tenantRes.data) ? tenantRes.data[0] ?? null : null;
  const propRes = await supabaseRequest(db, `properties?select=name,address&id=${eq(request.property_id)}&limit=1`, { fetchImpl });
  const property = propRes.ok && Array.isArray(propRes.data) ? propRes.data[0] ?? null : null;
  const where = property ? property.address || property.name : '';
  const who = tenant ? [tenant.first_name, tenant.last_name].filter(Boolean).join(' ') : 'no tenant on file';

  let tenantText;
  let managerText;
  let staffReply;
  let kind;
  let completedAt = null;

  if (command.action === 'schedule') {
    const when = formatWhen(command.scheduledAt, timeZone);
    const localDate = zonedParts(command.scheduledAt, timeZone);
    const res = await supabaseRequest(db, `maintenance_requests?id=${eq(request.id)}`, {
      method: 'PATCH',
      body: {
        scheduled_at: command.scheduledAt.toISOString(),
        scheduled_date: `${localDate.year}-${String(localDate.month).padStart(2, '0')}-${String(localDate.day).padStart(2, '0')}`,
        status: 'in_progress'
      },
      fetchImpl
    });
    if (!res.ok) return `Sorry, I couldn't update job #${request.job_number}. Please try again or update it in Property HQ.`;
    kind = 'schedule_notice';
    tenantText = `First Call Maintenance: we're scheduled to come out ${when} for your request #${request.job_number}. Reply here if that time doesn't work.`;
    managerText = `FCM update: job #${request.job_number} (${who}${where ? ` @ ${where}` : ''}) scheduled ${when}.`;
    staffReply = `Got it. Job #${request.job_number} scheduled ${when}.`;
  } else {
    const res = await supabaseRequest(db, `maintenance_requests?id=${eq(request.id)}`, {
      method: 'PATCH',
      body: { status: 'completed' },
      prefer: 'return=representation',
      fetchImpl
    });
    if (!res.ok) return `Sorry, I couldn't update job #${request.job_number}. Please try again or update it in Property HQ.`;
    completedAt = (Array.isArray(res.data) && res.data[0]?.completed_at) || now.toISOString();
    kind = 'completion_notice';
    tenantText = `First Call Maintenance: your request #${request.job_number} has been completed. If anything still isn't right, reply to this text.`;
    managerText = `FCM update: job #${request.job_number} (${who}${where ? ` @ ${where}` : ''}) completed.`;
    staffReply = `Job #${request.job_number} marked complete.`;
  }

  const notices = [];
  if (tenant?.phone_e164) notices.push({ party: 'tenant', to: tenant.phone_e164, body: tenantText, tenantId: tenant.id });
  const managerPhone = normalizePhoneNumber(settings.manager_phone);
  if (managerPhone && managerPhone !== fromNumber) notices.push({ party: 'manager', to: managerPhone, body: managerText, tenantId: tenant?.id ?? null });

  let tenantNotified = false;
  for (const notice of notices) {
    const sent = await sendSms({ to: notice.to, from: twilioNumber, body: notice.body, env, fetchImpl });
    if (notice.party === 'tenant') tenantNotified = !sent.error;
    await logMessage(db, {
      user_id: userId,
      direction: 'outbound',
      channel: 'sms',
      party: notice.party,
      kind,
      from_number: twilioNumber,
      to_number: notice.to,
      body: notice.body,
      twilio_sid: sent.sid,
      status: sent.status,
      error: sent.error,
      tenant_id: notice.tenantId,
      maintenance_request_id: request.id,
      completed_at: kind === 'completion_notice' ? completedAt : null
    }, fetchImpl);
  }

  if (kind === 'completion_notice' && tenantNotified) {
    await supabaseRequest(db, `maintenance_requests?id=${eq(request.id)}`, { method: 'PATCH', body: { completion_notified_at: now.toISOString() }, fetchImpl });
  }

  if (!tenant?.phone_e164) return `${staffReply} No tenant phone on file, so the tenant was not texted.`;
  return tenantNotified ? `${staffReply} Tenant notified.` : `${staffReply} The tenant text failed to send; please contact them directly.`;
}
