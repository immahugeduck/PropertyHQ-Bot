/**
 * Property HQ intake: files inbound texts/calls as maintenance requests,
 * logs every message to sms_messages, and texts alerts from triage_settings:
 * every new request to maintenance_phone, emergencies also to manager_phone.
 *
 * Everything here is best-effort. The webhook handlers call it inside a
 * try/catch and still send the tenant the deterministic triage reply if the
 * database or Twilio REST API is down.
 */
import { supabaseConfig, supabaseRequest, eq } from './supabase.js';
import { normalizePhoneNumber } from './twilio.js';
import { staffParty, handleStaffMessage } from './staff.js';

const URGENCY_BY_SEVERITY = {
  EMERGENCY: 'emergency',
  URGENT: 'high',
  PRIORITY: 'high',
  ROUTINE: 'medium'
};
const URGENCY_RANK = { low: 1, medium: 2, high: 3, emergency: 4 };

// Triage categories -> Property HQ maintenance_requests.category
const CATEGORY_BY_TRIAGE = {
  gas_or_co: 'general',
  fire_smoke: 'general',
  electrical_hazard: 'electrical',
  electrical: 'electrical',
  major_water: 'plumbing',
  water_leak: 'plumbing',
  sewage: 'plumbing',
  no_hvac: 'hvac'
};

const TITLE_BY_TRIAGE = {
  gas_or_co: 'Possible gas / CO',
  fire_smoke: 'Fire or smoke',
  electrical_hazard: 'Electrical hazard',
  electrical: 'Electrical problem',
  major_water: 'Active water leak',
  water_leak: 'Water leak',
  sewage: 'Sewage backup',
  no_hvac: 'No heat / no AC',
  general_maintenance: 'Maintenance request'
};

// A follow-up text within this window is attached to the tenant's open
// request instead of opening a new one ("it's unit 3", photos, etc.).
const FOLLOW_UP_WINDOW_MS = 24 * 60 * 60 * 1000;

export function mapUrgency(severity) {
  return URGENCY_BY_SEVERITY[severity] ?? 'medium';
}

export function mapCategory(triageCategory) {
  return CATEGORY_BY_TRIAGE[triageCategory] ?? 'general';
}

function truncate(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Send an SMS through the Twilio REST API. Resolves to { sid, status, error }. */
export async function sendSms({ to, from, body, env = process.env, fetchImpl = globalThis.fetch }) {
  const sid = String(env.TWILIO_ACCOUNT_SID ?? '').trim();
  const token = String(env.TWILIO_AUTH_TOKEN ?? '').trim();
  if (!sid || !token) return { sid: null, status: 'not_sent', error: 'TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set' };

  try {
    const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { sid: null, status: 'failed', error: truncate(data.message ?? `HTTP ${res.status}`, 300) };
    return { sid: data.sid ?? null, status: data.status ?? 'queued', error: null };
  } catch (error) {
    return { sid: null, status: 'failed', error: truncate(error.message, 300) };
  }
}

export async function logMessage(db, row, fetchImpl) {
  return supabaseRequest(db, 'sms_messages', {
    method: 'POST',
    body: row,
    prefer: 'return=representation',
    fetchImpl
  });
}

/**
 * Record an inbound text or transcribed call.
 *
 * Returns null when Supabase or the Twilio number is not set up (the caller
 * then behaves exactly as before), { duplicate: true } for a Twilio retry,
 * or { context, jobNumber, isNewRequest, tenantMatched, emergencyReply }.
 */
export async function recordInbound({ params, message, triage, channel = 'sms', env = process.env, fetchImpl = globalThis.fetch, now = new Date() }) {
  const db = supabaseConfig(env);
  if (!db) return null;

  const twilioNumber = normalizePhoneNumber(params.To);
  const fromNumber = normalizePhoneNumber(params.From) ?? String(params.From ?? '');
  const twilioSid = (channel === 'voice' ? params.CallSid : params.MessageSid) ?? null;
  if (!twilioNumber) return null;

  const settingsRes = await supabaseRequest(db, `triage_settings?select=*&twilio_number=${eq(twilioNumber)}&limit=1`, { fetchImpl });
  const settings = settingsRes.ok && Array.isArray(settingsRes.data) ? settingsRes.data[0] : null;
  if (!settings) {
    console.error(JSON.stringify({ type: 'intake_error', error: 'no_triage_settings_for_number', status: settingsRes.status }));
    return null;
  }
  const userId = settings.user_id;

  // Texts from the maintenance/manager phones are job updates ("1003 2pm",
  // "1003 done"), never new tenant requests.
  const staff = channel === 'sms' ? staffParty(settings, fromNumber) : null;
  if (staff) {
    const staffInbound = await logMessage(db, {
      user_id: userId,
      direction: 'inbound',
      channel,
      party: staff,
      kind: 'message',
      from_number: fromNumber,
      to_number: twilioNumber,
      body: message,
      twilio_sid: twilioSid
    }, fetchImpl);
    if (staffInbound.status === 409) return { duplicate: true };
    const inboundId = Array.isArray(staffInbound.data) ? staffInbound.data[0]?.id : null;
    const staffReply = await handleStaffMessage({ db, settings, party: staff, message, inboundId, fromNumber, twilioNumber, env, fetchImpl, now });
    return {
      context: { db, settings, userId, twilioNumber, fromNumber, channel, tenant: null, party: staff, requestId: null, fetchImpl },
      staffReply
    };
  }

  const tenantRes = await supabaseRequest(
    db,
    `tenants?select=id,first_name,last_name,property_id&user_id=${eq(userId)}&phone_e164=${eq(fromNumber)}&order=status.asc,created_at.desc&limit=1`,
    { fetchImpl }
  );
  const tenant = tenantRes.ok && Array.isArray(tenantRes.data) ? tenantRes.data[0] ?? null : null;

  // Log the inbound message first. twilio_sid is unique, so a Twilio retry
  // fails here with 409 and nothing below runs twice.
  const inboundRes = await logMessage(db, {
    user_id: userId,
    direction: 'inbound',
    channel,
    party: tenant ? 'tenant' : 'unknown',
    kind: 'message',
    from_number: fromNumber,
    to_number: twilioNumber,
    body: message,
    twilio_sid: twilioSid,
    tenant_id: tenant?.id ?? null
  }, fetchImpl);
  if (inboundRes.status === 409) return { duplicate: true };
  if (!inboundRes.ok) {
    console.error(JSON.stringify({ type: 'intake_error', error: 'inbound_log_failed', status: inboundRes.status }));
  }
  const inboundId = Array.isArray(inboundRes.data) ? inboundRes.data[0]?.id : null;

  const context = { db, settings, userId, twilioNumber, fromNumber, channel, tenant, requestId: null, fetchImpl };
  const urgency = mapUrgency(triage.severity);
  const isEmergency = triage.severity === 'EMERGENCY';
  let request = null;
  let isNewRequest = false;
  let property = null;

  if (tenant?.property_id) {
    const since = new Date(now.getTime() - FOLLOW_UP_WINDOW_MS).toISOString();
    const openRes = await supabaseRequest(
      db,
      `maintenance_requests?select=id,job_number,urgency&tenant_id=${eq(tenant.id)}&source=in.(sms,voice)&status=in.(open,in_progress)&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=1`,
      { fetchImpl }
    );
    request = openRes.ok && Array.isArray(openRes.data) ? openRes.data[0] ?? null : null;

    if (request) {
      if ((URGENCY_RANK[urgency] ?? 0) > (URGENCY_RANK[request.urgency] ?? 0)) {
        await supabaseRequest(db, `maintenance_requests?id=${eq(request.id)}`, { method: 'PATCH', body: { urgency }, fetchImpl });
      }
    } else {
      const reporter = [tenant.first_name, tenant.last_name].filter(Boolean).join(' ') || null;
      const createRes = await supabaseRequest(db, 'maintenance_requests', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          user_id: userId,
          property_id: tenant.property_id,
          tenant_id: tenant.id,
          title: `${TITLE_BY_TRIAGE[triage.category] ?? 'Maintenance request'} (via ${channel === 'voice' ? 'call' : 'text'})`,
          description: message,
          category: mapCategory(triage.category),
          urgency,
          status: 'open',
          source: channel,
          reported_by_name: reporter
        },
        fetchImpl
      });
      if (createRes.ok && Array.isArray(createRes.data)) {
        request = createRes.data[0];
        isNewRequest = true;
      } else {
        console.error(JSON.stringify({ type: 'intake_error', error: 'request_create_failed', status: createRes.status }));
      }
    }

    if (request && inboundId) {
      await supabaseRequest(db, `sms_messages?id=${eq(inboundId)}`, { method: 'PATCH', body: { maintenance_request_id: request.id }, fetchImpl });
    }

    const propRes = await supabaseRequest(db, `properties?select=name,address,city&id=${eq(tenant.property_id)}&limit=1`, { fetchImpl });
    property = propRes.ok && Array.isArray(propRes.data) ? propRes.data[0] ?? null : null;
  }
  context.requestId = request?.id ?? null;

  // Alerts: every new request and every emergency. Unknown numbers alert on
  // their first message of the day so a tenant whose phone isn't on file
  // still reaches a person without every follow-up text paging someone.
  let alertUnknown = false;
  if (!tenant && !isEmergency) {
    const since = new Date(now.getTime() - FOLLOW_UP_WINDOW_MS).toISOString();
    const priorRes = await supabaseRequest(
      db,
      `sms_messages?select=id&user_id=${eq(userId)}&direction=eq.inbound&from_number=${eq(fromNumber)}&created_at=gte.${encodeURIComponent(since)}&limit=2`,
      { fetchImpl }
    );
    alertUnknown = priorRes.ok && Array.isArray(priorRes.data) && priorRes.data.length <= 1;
  }

  if (isNewRequest || isEmergency || alertUnknown) {
    const who = tenant
      ? `${[tenant.first_name, tenant.last_name].filter(Boolean).join(' ')}${property ? ` @ ${property.address || property.name}` : ''}`
      : 'Unknown number (not on file)';
    const label = isEmergency ? 'EMERGENCY' : triage.severity;
    const job = request?.job_number ? ` job #${request.job_number}` : '';
    const via = channel === 'voice' ? 'Call' : 'Text';
    const alertBody = `FCM ${label}${job} - ${via} from ${who} ${fromNumber}: "${truncate(message, 280)}"`;

    // Maintenance gets every alert; the manager line only gets emergencies.
    const recipients = [
      { party: 'maintenance', phone: normalizePhoneNumber(settings.maintenance_phone) },
      ...(isEmergency ? [{ party: 'manager', phone: normalizePhoneNumber(settings.manager_phone) }] : [])
    ].filter((r, i, all) => r.phone && all.findIndex((o) => o.phone === r.phone) === i);

    for (const recipient of recipients) {
      const sent = await sendSms({ to: recipient.phone, from: twilioNumber, body: alertBody, env, fetchImpl });
      await logMessage(db, {
        user_id: userId,
        direction: 'outbound',
        channel: 'sms',
        party: recipient.party,
        kind: isEmergency ? 'emergency_alert' : 'new_request_alert',
        from_number: twilioNumber,
        to_number: recipient.phone,
        body: alertBody,
        twilio_sid: sent.sid,
        status: sent.status,
        error: sent.error,
        tenant_id: tenant?.id ?? null,
        maintenance_request_id: request?.id ?? null
      }, fetchImpl);
    }
  }

  return {
    context,
    jobNumber: request?.job_number ?? null,
    isNewRequest,
    tenantMatched: Boolean(tenant),
    tenantFirstName: tenant?.first_name ?? null,
    propertyLabel: property
      ? [property.name, property.address].filter(Boolean).join(' - ') || null
      : null,
    isEmergency,
    emergencyReply: isEmergency ? settings.emergency_reply ?? null : null
  };
}

/** Log the reply the tenant received (sent as TwiML, so there is no SID). */
export async function recordReply(context, body) {
  if (!context || !body) return;
  await logMessage(context.db, {
    user_id: context.userId,
    direction: 'outbound',
    channel: context.channel,
    party: context.party ?? (context.tenant ? 'tenant' : 'unknown'),
    kind: 'message',
    from_number: context.twilioNumber,
    to_number: context.fromNumber,
    body,
    status: 'replied',
    tenant_id: context.tenant?.id ?? null,
    maintenance_request_id: context.requestId
  }, context.fetchImpl);
}

/**
 * Personalize the tenant reply: greet a known tenant, stop asking for an
 * address we already have, acknowledge follow-ups briefly, and add the job
 * number / emergency callback promise.
 */
export function decorateReply(reply, intake) {
  if (!intake || intake.duplicate) return reply;
  if (intake.staffReply) return intake.staffReply;

  // A non-emergency follow-up on an open request ("it's unit 10", "only when
  // the faucet runs") just needs an acknowledgement, not the intake questions again.
  if (intake.jobNumber && !intake.isNewRequest && !intake.isEmergency) {
    const name = intake.tenantFirstName ? `, ${intake.tenantFirstName}` : '';
    return `Thanks${name}. I added that to your request #${intake.jobNumber}. Maintenance will follow up.`;
  }

  let out = reply;
  if (intake.propertyLabel) {
    out = out.replace(/the property address\/unit(, | and )/, '');
    out = `${intake.tenantFirstName ? `Hi ${intake.tenantFirstName}. ` : ''}${out} We have you at ${intake.propertyLabel}.`;
  }
  if (intake.emergencyReply) out = `${out} ${intake.emergencyReply}`;
  if (intake.jobNumber) {
    out = intake.isNewRequest
      ? `${out} Your request number is #${intake.jobNumber}.`
      : `${out} Added to your request #${intake.jobNumber}.`;
  }
  return out;
}
