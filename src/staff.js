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
  'To update a job, text the job number and a time or "done". Examples: "1003 tomorrow 2pm", "1003 12:30", "1003 done". "1003 <message>" texts that job\'s tenant. Text "?" to see this again.';

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
    year = base.getUTCFullYear(); month = base.getUTCMonth() + 1; day = base.getUTCDate();
    when = zonedTimeToDate(year, month, day, hour, minute, timeZone);
  }
  const actual = zonedParts(when, timeZone);
  if (actual.year !== year || actual.month !== month || actual.day !== day || actual.hour !== hour || actual.minute !== minute || when < now) return null;
  return when;
}

/** Work out what a staff text asks for. */
export function parseStaffCommand(text, now, timeZone) {
  const body = String(text ?? '');
  // A job number has to lead the text ("1003 done") or be marked ("#1003",
  // "job 1003") so street numbers and years ("1234 Main St") aren't mistaken for one.
  const job = body.match(/^\s*#?(\d{4,6})\b(?!\s*[:/]|\s*(?:am|pm|a\.m|p\.m))|(?:#|\bjob\s*#?)\s*(\d{4,6})\b/i);
  const jobNumber = job ? Number(job[1] ?? job[2]) : null;
  if (/\b(when|what time|remind me|schedule|scheduled|appointment)\b/i.test(body) && /\?|\b(when|what time|show|recall|remind me)\b/i.test(body)) return { action: 'recall', jobNumber };
  if (/\bcancel\b|\b(?:not|don’t|don't)\s+(?:done|complete|finished|fixed|resolved)\b/i.test(body) || (/\b(can|could|maybe|might|available|between|after|before|not|don’t|don't)\b|\d\s*(?:am|pm)?\s*[-–]\s*\d/i.test(body) && parseScheduleTime(body, now, timeZone))) return { action: 'clarify', jobNumber };
  const scheduledAt = parseScheduleTime(body, now, timeZone);
  if (scheduledAt) return { action: 'schedule', jobNumber, scheduledAt };
  if ((jobNumber || body.trim().split(/\s+/).length <= 6) && /\b(tomorrow|today|tonight|morning|afternoon|schedule)\b|\d{1,2}:\d{2}|\d\s*(?:am|pm)\b/i.test(body)) return { action: 'clarify', jobNumber };
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

const REQUEST_FIELDS = 'id,job_number,status,tenant_id,property_id,scheduled_at,scheduled_date';

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

// Alerts and forwarded questions stay answerable for this long.
const RELAY_WINDOW_MS = 12 * 60 * 60 * 1000;

/** The most recent alert/question sent to this staff phone that can be answered. */
async function findPendingRelay({ db, userId, fromNumber, now, fetchImpl }) {
  const since = new Date(now.getTime() - RELAY_WINDOW_MS).toISOString();
  const res = await supabaseRequest(
    db,
    `sms_messages?select=reply_to_number,tenant_id,maintenance_request_id&user_id=${eq(userId)}&direction=eq.outbound&to_number=${eq(fromNumber)}&reply_to_number=not.is.null&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=1`,
    { fetchImpl }
  );
  return res.ok && Array.isArray(res.data) ? res.data[0] ?? null : null;
}

async function getRequestById({ db, id, fetchImpl }) {
  if (!id) return null;
  const res = await supabaseRequest(db, `maintenance_requests?select=${REQUEST_FIELDS}&id=${eq(id)}&limit=1`, { fetchImpl });
  return res.ok && Array.isArray(res.data) ? res.data[0] ?? null : null;
}

async function getTenant({ db, id, fetchImpl }) {
  if (!id) return null;
  const res = await supabaseRequest(db, `tenants?select=id,first_name,last_name,phone_e164&id=${eq(id)}&limit=1`, { fetchImpl });
  return res.ok && Array.isArray(res.data) ? res.data[0] ?? null : null;
}

const fullName = (tenant) => (tenant ? [tenant.first_name, tenant.last_name].filter(Boolean).join(' ') : '');

/**
 * Handle a text from the maintenance or manager phone. Returns the reply
 * text for the staff member. The inbound message is already logged.
 *
 * Short texts or texts starting with a job number are commands ("1003 2pm",
 * "done"). A longer free-text reply to an alert or forwarded question is
 * relayed word for word to that tenant, and still schedules or completes the
 * job if it names a time or says it's done.
 */
export async function handleStaffMessage({ db, settings, party, message, inboundId, fromNumber, twilioNumber, env, fetchImpl, now }) {
  const userId = settings.user_id;
  const timeZone = settings.timezone || 'America/Indiana/Indianapolis';
  const text = String(message ?? '').trim();
  const command = parseStaffCommand(text, now, timeZone);
  const startsWithJob = /^#?\d{4,6}\b/.test(text);
  const commandStyle = Boolean(command.jobNumber) || startsWithJob || text.split(/\s+/).length <= 6;
  const ctx = { db, settings, userId, timeZone, fromNumber, twilioNumber, env, fetchImpl, now, inboundId };
  // "HELP" itself never reaches us: Twilio answers it as an opt-out keyword.
  if (/^(\?|commands)$/i.test(text)) return HELP;
  if (command.action === 'clarify') return 'I can help with that. Please send the job number and a confirmed day and time, such as "1003 tomorrow 2pm". I haven’t changed the saved appointment.';
  if (command.action === 'recall') {
    const request = await findRequest({ db, userId, jobNumber: command.jobNumber, fromNumber, fetchImpl });
    if (!request) return 'Which job should I check? Send its job number, such as "when is job 1003 scheduled?"';
    if (!request.scheduled_at) return `Job #${request.job_number} has no confirmed appointment saved yet.`;
    return `Job #${request.job_number} is scheduled ${formatWhen(new Date(request.scheduled_at), timeZone)} (${timeZone}). Status: ${request.status}.`;
  }

  // "1003 the shutoff is behind the water heater": message that job's tenant.
  if (startsWithJob && command.action === 'help') {
    const request = await findRequest({ db, userId, jobNumber: command.jobNumber, fromNumber, fetchImpl });
    if (!request) return `I couldn't find job #${command.jobNumber}. ${HELP}`;
    const tenant = await getTenant({ db, id: request.tenant_id, fetchImpl });
    if (!tenant?.phone_e164) return `Job #${request.job_number} has no tenant phone on file, so nothing was sent.`;
    const body = text.replace(/^#?\d{4,6}[\s:,-]*/, '');
    if (!body) return HELP;
    return relay(ctx, { to: tenant.phone_e164, tenant, request, body });
  }

  if (!commandStyle || command.action === 'help') {
    const pending = await findPendingRelay({ db, userId, fromNumber, now, fetchImpl });
    if (pending) {
      const tenant = await getTenant({ db, id: pending.tenant_id, fetchImpl });
      const request = await getRequestById({ db, id: pending.maintenance_request_id, fetchImpl });
      let reply = await relay(ctx, { to: pending.reply_to_number, tenant, request, body: text });
      if (request && command.action !== 'help' && ['open', 'in_progress'].includes(request.status)) {
        reply += ` ${await applyUpdate(ctx, { request, command, tenant, notifyTenant: false })}`;
      }
      return reply;
    }
    if (command.action === 'help') return HELP;
  }

  const request = await findRequest({ db, userId, jobNumber: command.jobNumber, fromNumber, fetchImpl });
  if (!request) {
    return command.jobNumber
      ? `I couldn't find job #${command.jobNumber}. ${HELP}`
      : `I couldn't tell which job that's for. ${HELP}`;
  }
  const tenant = await getTenant({ db, id: request.tenant_id, fetchImpl });
  return applyUpdate(ctx, { request, command, tenant, notifyTenant: true });
}

/** Send a staff member's words to the tenant and log it. */
async function relay(ctx, { to, tenant, request, body }) {
  const { db, userId, twilioNumber, env, fetchImpl, inboundId } = ctx;
  if (inboundId && request) {
    await supabaseRequest(db, `sms_messages?id=${eq(inboundId)}`, { method: 'PATCH', body: { maintenance_request_id: request.id }, fetchImpl });
  }
  const tenantBody = `Maintenance: ${body}`;
  const sent = await sendSms({ to, from: twilioNumber, body: tenantBody, env, fetchImpl });
  await logMessage(db, {
    user_id: userId,
    direction: 'outbound',
    channel: 'sms',
    party: tenant ? 'tenant' : 'unknown',
    kind: 'staff_relay',
    from_number: twilioNumber,
    to_number: to,
    body: tenantBody,
    twilio_sid: sent.sid,
    status: sent.status,
    error: sent.error,
    tenant_id: tenant?.id ?? null,
    maintenance_request_id: request?.id ?? null
  }, fetchImpl);
  const who = fullName(tenant) || to;
  const job = request?.job_number ? ` (job #${request.job_number})` : '';
  return sent.error ? `Couldn't send that to ${who}${job}; please contact them directly.` : `Sent to ${who}${job}.`;
}

/**
 * Schedule or complete a job. With notifyTenant the tenant gets the standard
 * notice; without it (the staff's own words were just relayed) only the
 * manager line is updated.
 */
async function applyUpdate(ctx, { request, command, tenant, notifyTenant }) {
  const { db, settings, userId, timeZone, fromNumber, twilioNumber, env, fetchImpl, now, inboundId } = ctx;
  if (inboundId) {
    await supabaseRequest(db, `sms_messages?id=${eq(inboundId)}`, { method: 'PATCH', body: { maintenance_request_id: request.id }, fetchImpl });
  }

  const propRes = await supabaseRequest(db, `properties?select=name,address&id=${eq(request.property_id)}&limit=1`, { fetchImpl });
  const property = propRes.ok && Array.isArray(propRes.data) ? propRes.data[0] ?? null : null;
  const where = property ? property.address || property.name : '';
  const who = fullName(tenant) || 'no tenant on file';

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
    staffReply = `Job #${request.job_number} scheduled ${when}.`;
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
  if (notifyTenant && tenant?.phone_e164) notices.push({ party: 'tenant', to: tenant.phone_e164, body: tenantText });
  const managerPhone = normalizePhoneNumber(settings.manager_phone);
  if (managerPhone && managerPhone !== fromNumber) notices.push({ party: 'manager', to: managerPhone, body: managerText });

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
      tenant_id: tenant?.id ?? null,
      maintenance_request_id: request.id,
      completed_at: kind === 'completion_notice' ? completedAt : null
    }, fetchImpl);
  }

  // The relayed reply counts as telling the tenant.
  if (kind === 'completion_notice' && (tenantNotified || !notifyTenant)) {
    await supabaseRequest(db, `maintenance_requests?id=${eq(request.id)}`, { method: 'PATCH', body: { completion_notified_at: now.toISOString() }, fetchImpl });
  }

  if (!notifyTenant) return staffReply;
  if (kind === 'schedule_notice') staffReply = `Got it. ${staffReply}`;
  if (!tenant?.phone_e164) return `${staffReply} No tenant phone on file, so the tenant was not texted.`;
  return tenantNotified ? `${staffReply} Tenant notified.` : `${staffReply} The tenant text failed to send; please contact them directly.`;
}
