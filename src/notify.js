// Real outbound notifications via the Twilio REST API.
//
// Uses fetch + Basic auth directly (no SDK dependency) so it runs unchanged in
// the serverless runtime. Degrades gracefully: if Twilio or a recipient list
// is not configured, sends are skipped (never thrown) so the inbound webhook
// can still classify, reply to the tenant, and log what it would have sent.
//
// Env:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER  (required to send)
//   MAINTENANCE_ESCALATION_NUMBERS  (comma-separated) -> maintenance dispatch
//   MANAGER_NOTIFY_NUMBERS          (comma-separated) -> manager updates

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';
const SEND_TIMEOUT_MS = 8000;

export function twilioConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

export function parseRecipients(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Send a single SMS. Never throws; returns a structured result.
 * @returns {Promise<{to: string, ok: boolean, sid?: string, error?: string, status?: number}>}
 */
export async function sendSms(to, body, { fetchImpl = fetch } = {}) {
  if (!twilioConfigured()) return { to, ok: false, error: 'twilio_not_configured' };
  if (!to) return { to, ok: false, error: 'missing_recipient' };

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');

  const form = new URLSearchParams({ To: to, From: from, Body: String(body ?? '') });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const res = await fetchImpl(`${TWILIO_API_BASE}/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString(),
      signal: controller.signal
    });

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok) {
      const error = payload?.message || `twilio_http_${res.status}`;
      return { to, ok: false, status: res.status, error };
    }
    return { to, ok: true, sid: payload?.sid, status: res.status };
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'timeout' : error?.message || 'send_failed';
    return { to, ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

async function sendToRecipients(recipients, body, opts) {
  const results = [];
  for (const to of recipients) {
    // Sequential to keep well under Twilio's default concurrency limits.
    results.push(await sendSms(to, body, opts)); // eslint-disable-line no-await-in-loop
  }
  return results;
}

/**
 * Dispatch the maintenance and manager notifications for a triaged request.
 * Reads recipient lists from env. Returns a per-channel result summary and
 * never throws, so the caller can always complete the tenant reply.
 */
export async function dispatchNotifications({ maintenanceBody, managerBody }, opts = {}) {
  const summary = {
    configured: twilioConfigured(),
    maintenance: { recipients: 0, sent: 0, results: [] },
    manager: { recipients: 0, sent: 0, results: [] }
  };

  const maintenanceRecipients = parseRecipients(process.env.MAINTENANCE_ESCALATION_NUMBERS);
  const managerRecipients = parseRecipients(process.env.MANAGER_NOTIFY_NUMBERS);

  if (maintenanceBody && maintenanceRecipients.length) {
    const results = await sendToRecipients(maintenanceRecipients, maintenanceBody, opts);
    summary.maintenance = { recipients: maintenanceRecipients.length, sent: results.filter((r) => r.ok).length, results };
  } else {
    summary.maintenance.recipients = maintenanceRecipients.length;
  }

  if (managerBody && managerRecipients.length) {
    const results = await sendToRecipients(managerRecipients, managerBody, opts);
    summary.manager = { recipients: managerRecipients.length, sent: results.filter((r) => r.ok).length, results };
  } else {
    summary.manager.recipients = managerRecipients.length;
  }

  return summary;
}
