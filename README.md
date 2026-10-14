# Maintenance Triage Agent

Production-shaped Phase 1 backend for receiving inbound phone/SMS traffic and triaging maintenance requests for First Call Maintenance. **Twilio is the active phone integration.**

Phase 1 establishes:
- Twilio SMS/MMS and Voice webhook endpoints (with an alternate AgentPhone endpoint)
- Twilio request-signature verification (`X-Twilio-Signature`)
- normalized inbound message parsing
- deterministic safety-first maintenance triage
- emergency escalation guidance
- structured audit logging
- health endpoint
- automated tests

## Architecture

Caller/Tenant -> Twilio number -> `/api/twilio/sms` or `/api/twilio/voice` -> signature verification -> triage engine -> TwiML response

The triage engine is intentionally deterministic. AI-assisted classification can be layered on later, but safety-critical categories are not delegated to an LLM alone.

- **SMS/MMS** replies immediately with a TwiML `<Message>` containing the triage guidance.
- **Voice** answers with a TwiML `<Gather input="speech">` prompt, then triages the transcribed request and speaks the guidance back with `<Say>`.

## Local setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local`
3. Set `TWILIO_AUTH_TOKEN` (from the Twilio Console) so inbound webhook signatures can be verified.
4. Run tests: `npm test`
5. Run locally: `npm run dev`

## Endpoints

- `POST /api/twilio/sms` - Twilio Messaging webhook ("A message comes in")
- `POST /api/twilio/voice` - Twilio Voice webhook ("A call comes in")
- `POST /api/agentphone/webhook` - alternate AgentPhone webhook receiver
- `POST /api/inkbox/imessage` - Inkbox iMessage webhook receiver (triage reply as JSON)
- `GET /api/health` - health/configuration check

## Twilio setup

In the [Twilio Console](https://console.twilio.com) → **Phone Numbers → Manage → Active numbers → your number**:

| Setting | Value |
| --- | --- |
| **Voice — A call comes in** | Webhook, `https://YOUR_DEPLOYMENT/api/twilio/voice`, HTTP POST |
| **Messaging — A message comes in** | Webhook, `https://YOUR_DEPLOYMENT/api/twilio/sms`, HTTP POST |

Then set `TWILIO_AUTH_TOKEN` in your Vercel project environment variables (Production) to your Twilio **Auth Token**. Redeploy so the variable takes effect.

Twilio signs each request with `X-Twilio-Signature` (HMAC-SHA1 over the exact request URL plus the sorted POST parameters). The endpoints reject any request whose signature does not match. If validation fails because the reconstructed URL does not match the host Twilio actually called (custom domain, redirect), set `TWILIO_WEBHOOK_BASE_URL` to the exact base URL Twilio uses (e.g. `https://your-app.vercel.app`).

### STOP / START / HELP keywords

Twilio replies to these keywords itself and still forwards them to `/api/twilio/sms`. The handler recognizes them (whole-message match, any case, or Twilio's `OptOutType` parameter), logs a `twilio.keyword` audit event, and returns an empty TwiML response, so the customer never gets a second reply and keywords never go through triage.

To make Twilio's replies match the A2P campaign registration, enable **Advanced Opt-Out** on the campaign's Messaging Service (Messaging → Services → your service → Opt-Out Management) and set:

| Type | Reply |
| --- | --- |
| Opt-in (START) | First Call Maintenance: You're enrolled in maintenance text alerts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out. |
| Help (HELP) | First Call Maintenance: For help with a maintenance request, visit firstcallmaintenance.biz. For emergencies call 911. Msg & data rates may apply. Reply STOP to opt out. |
| Opt-out (STOP) | First Call Maintenance: You're unsubscribed and will receive no further texts. Reply START to resubscribe. |

## Property HQ connection (Supabase)

Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `TWILIO_ACCOUNT_SID` (use the Property HQ Supabase project) and the Twilio SMS/voice handlers also:

- look up the `triage_settings` row whose `twilio_number` is the number that was texted/called, which says which Property HQ account owns it and who gets alerts;
- log every inbound and outbound message to `sms_messages` (unique `twilio_sid`, so a Twilio retry is detected and ignored);
- match the sender to a tenant by `tenants.phone_e164` and file a `maintenance_requests` row (`source = 'sms'` or `'voice'`), then add "Your request number is #1042" to the reply;
- attach follow-up texts within 24 hours to the tenant's open request instead of opening a new one, raising its urgency if the follow-up is an emergency;
- text every new-request alert to `maintenance_phone`, and emergencies to `manager_phone` as well. Texts from numbers not on file are logged and alert maintenance on their first message of the day.

### Staff replies

Texts from `maintenance_phone` or `manager_phone` are treated as job updates, never as tenant requests:

| Text | Effect |
| --- | --- |
| `1003 tomorrow 2pm`, `1003 fri at 3`, `1003 10/20 8:15am` | Sets `scheduled_at`/`scheduled_date`, status `in_progress`; texts the tenant and the manager line |
| `be there at 12:30` (no job number) | Same, for the open job most recently alerted to that phone |
| `1003 done` / `fixed` / `complete` | Marks it completed (trigger stamps `completed_at`); texts the tenant and the manager line, sets `completion_notified_at` |
| anything else | Replies with a short how-to; nothing changes |

Times are read in `triage_settings.timezone`. A bare hour without am/pm is read as working hours (7-11 morning, 12-6 afternoon), and a time already past today with no day given means tomorrow.

All of this is best-effort: if Supabase or the Twilio REST API is down, the tenant still gets the deterministic triage reply. The schema lives in Property HQ (`supabase/migrations/20261014000000_maintenance_triage.sql`). `GET /api/health` reports `propertyHqConfigured`.

## Inkbox AI communications agent (email + iMessage)

This branch adds **Inkbox** as an AI communications channel, separate from the
Twilio phone integration. The agent runs as an Inkbox identity — agent handle
`tenant-coms-agent`, display name "Agent-Coms" — and is driven through the
Inkbox MCP tools rather than an inbound HTTP webhook.

Live channels on this identity (from `inkbox_channel_status_get`):

| Channel | Status |
| --- | --- |
| Email (`tenant-coms-agent@inkboxmail.com`) | active |
| iMessage (shared router) | enabled |
| SMS / voice calling | **not available** — needs a phone number assigned to the identity |

### How it works

Inkbox does not push signed webhooks into this app and does not wake the model
on its own. Instead, on each invocation the agent:

1. reads inbound email/iMessage with the Inkbox MCP read tools
   (`inkbox_conversations_list`, `inkbox_emails_list`, `inkbox_email_get`, …),
2. runs each message through the **same deterministic triage engine**
   (`src/triage.js`) the phone paths use — safety-critical categories are never
   delegated to an LLM alone,
3. formats a reply in First Call Maintenance's voice with `src/inkbox.js`, and
4. sends it back on the same channel (`inkbox_email_reply`,
   `inkbox_imessage_send`).

`src/inkbox.js` holds the pure, testable core of that loop
(`normalizeInboundMessage`, `formatEmailReply`, `formatChatReply`,
`triageInboundMessage`); `test/inkbox.test.js` covers it. Because Inkbox acts
only when invoked, continuous handling requires either a scheduled task/gateway
that runs the agent on a cadence, or the iMessage webhook below.

### iMessage connect flow

Tenants reach the agent over iMessage two ways:

- **Shared router** (from `inkbox_imessage_onboarding_get`): text
  `connect @tenant-coms-agent` to the triage number **+1 650-484-9720** — this
  is Inkbox's shared line for all agents — to link to this agent.
- **Direct line:** **+1 717-660-7624**, the tenant's dedicated line for this
  agent, confirmed by Inkbox's connect flow ("You're now connected to agent
  @tenant-coms-agent. Text them at +17176607624"). `inkbox_channel_status_get`
  still reports `dedicated_number: null` — that API field does not surface the
  dedicated line, but it is live.

### iMessage webhook (`POST /api/inkbox/imessage`)

When Inkbox is configured to POST inbound iMessages, `api/inkbox/imessage.js`
verifies the delivery, runs the shared triage engine, and returns the reply
text as JSON. It reuses `src/inkbox.js`, so quoted-reply stripping and the
photo-only prompt apply here too. `test/inkbox-webhook.test.js` covers it.

- Set `INKBOX_WEBHOOK_SECRET` so `X-Inkbox-Signature` is verified. The endpoint
  refuses to run without it unless `INKBOX_WEBHOOK_ALLOW_UNVERIFIED=true` is set
  explicitly (testing only).
- **Provisional:** the exact signature scheme, inbound field names, and how
  Inkbox consumes the response must be validated against one real delivery
  before production use (same caveat this repo already carries for AgentPhone).
  `verifyInkboxSignature` assumes `sha256=<hex HMAC of the raw body>`.

### Trust boundary

The MCP connection is the authenticated channel, so there is no per-message HMAC
to verify (that is what the Twilio/AgentPhone signature checks are for). Message
content is still untrusted sender-authored text; it is only ever run through the
deterministic regex triage engine and echoed into templated reply text, never
executed or used to build a request.

## Safety model

Phase 1 recognizes explicit emergency signals including suspected gas/CO, fire/smoke, electrical arcing/fire, major active flooding, sewage backup with exposure risk, and immediate life-safety hazards. Emergency responses tell the occupant to prioritize personal safety and appropriate emergency/utility services rather than waiting for maintenance.

This software assists maintenance intake; it is not a substitute for emergency services or qualified on-site diagnosis.
