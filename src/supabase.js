/**
 * Minimal Supabase REST (PostgREST) client for the Property HQ database.
 *
 * Uses the service-role key, which bypasses row-level security, so it must
 * only ever run server-side. No SDK dependency: plain fetch keeps the
 * serverless bundle small and lets tests inject a fake fetch.
 */

export function supabaseConfig(env = process.env) {
  const url = String(env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !key) return null;
  return { url, key };
}

/**
 * Call a PostgREST endpoint. `path` is relative to /rest/v1, e.g.
 * "tenants?select=id&phone_e164=eq.%2B17655550123".
 * Resolves to { ok, status, data }; never throws on HTTP errors.
 */
export async function supabaseRequest(config, path, { method = 'GET', body, prefer, fetchImpl = globalThis.fetch } = {}) {
  const headers = {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    Accept: 'application/json'
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;

  const res = await fetchImpl(`${config.url}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    // Twilio waits 15s for the webhook; never let one slow query eat it all.
    signal: AbortSignal.timeout(5000)
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { ok: res.ok, status: res.status, data };
}

/** URL-encode a PostgREST `eq.` filter value. */
export function eq(value) {
  return `eq.${encodeURIComponent(String(value))}`;
}
