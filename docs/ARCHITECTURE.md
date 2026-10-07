# Phase 1 Architecture

## Purpose

Receive tenant maintenance traffic from AgentPhone through a standing HTTPS webhook and classify it safely enough to drive intake and escalation workflows.

## Request path (Twilio — active integration)

1. A tenant texts or calls the Twilio number.
2. Twilio sends a signed form-encoded POST to `/api/twilio/sms` (Messaging) or `/api/twilio/voice` (Voice).
3. The backend reconstructs the request URL and verifies `X-Twilio-Signature` (HMAC-SHA1 over the URL + sorted POST params) before processing.
4. The relevant field (`Body` for SMS, `SpeechResult` for voice) is passed to the provider-independent triage engine.
5. Deterministic safety rules run before any future AI classifier.
6. SMS replies with TwiML `<Message>`; voice gathers speech then answers with TwiML `<Say>`.
7. A privacy-conscious audit event is logged without the message body or phone number.

An alternate `/api/agentphone/webhook` path (HMAC-SHA256 over `timestamp.raw_body`, JSON in/out) remains available for the AgentPhone provider and shares the same triage engine.

## Request path (Inkbox — AI communications agent)

Inkbox is not an inbound HTTP webhook. The agent runs as an Inkbox identity
(`tenant-coms-agent`) and is driven through the Inkbox MCP tools, so it acts
only when invoked — continuous handling needs a scheduled task or gateway.

1. The agent reads inbound email/iMessage via the Inkbox MCP read tools.
2. Each message body is passed to the same provider-independent triage engine.
3. Deterministic safety rules run exactly as they do for the phone paths.
4. `src/inkbox.js` formats a channel-aware reply (email gets a subject +
   FCM sign-off; iMessage/SMS get short text) which the agent sends back with
   the Inkbox reply/send tools.

Live channels on this identity: email (`tenant-coms-agent@inkboxmail.com`) and
iMessage are active; SMS/voice require a phone number assigned to the identity.
The MCP connection is the authenticated channel, so there is no per-message
signature to verify; message content remains untrusted and only flows through
the deterministic engine and templated replies.

## Severity contract

- `ROUTINE`: ordinary maintenance intake.
- `PRIORITY`: issue should receive accelerated maintenance review but no explicit immediate life-safety signal was detected.
- `URGENT`: substantial habitability/sanitation problem requiring prompt attention.
- `EMERGENCY`: explicit life-safety or severe active property hazard; tenant response prioritizes safety/emergency services and immediate escalation.

## Security boundaries

- Reject unsigned/invalid webhook requests (Twilio `X-Twilio-Signature`; AgentPhone `X-Webhook-Signature`).
- Reject AgentPhone deliveries outside its five-minute replay window.
- Never commit Twilio/AgentPhone/OpenAI/database secrets; store the Twilio Auth Token only in deployment environment variables.
- Avoid logging message bodies and phone numbers by default.
- Do not let an LLM downgrade a deterministic emergency match in future phases.
- Persistent records should use least-privilege database credentials and explicit retention rules.

## Phase 1 limitations

- Tenant/property identity is not yet persisted.
- `MessageSid`/`CallSid` are not yet persisted for retry idempotency; complete this before creating real work orders or sending outbound notifications.
- Escalation notifications are not yet dispatched.
- No work-order system integration exists yet.
- AI classification is intentionally not enabled yet.
- Voice uses the same message triage path but needs live AgentPhone testing before production use.
- Webhook signature verification must be validated against an actual AgentPhone test delivery before production activation because provider signature canonicalization can change implementation details.

## Phase 2 candidates

- database-backed properties, tenants, conversations, and work orders
- owner/technician escalation routing
- AI-assisted intent extraction beneath deterministic safety rules
- image/MMS attachment handling
- duplicate request detection
- property-specific shutoff/instruction data
- human handoff and acknowledgement tracking
