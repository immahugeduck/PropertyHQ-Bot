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
- `GET /api/health` - health/configuration check

## Twilio setup

In the [Twilio Console](https://console.twilio.com) → **Phone Numbers → Manage → Active numbers → your number**:

| Setting | Value |
| --- | --- |
| **Voice — A call comes in** | Webhook, `https://YOUR_DEPLOYMENT/api/twilio/voice`, HTTP POST |
| **Messaging — A message comes in** | Webhook, `https://YOUR_DEPLOYMENT/api/twilio/sms`, HTTP POST |

Then set `TWILIO_AUTH_TOKEN` in your Vercel project environment variables (Production) to your Twilio **Auth Token**. Redeploy so the variable takes effect.

Twilio signs each request with `X-Twilio-Signature` (HMAC-SHA1 over the exact request URL plus the sorted POST parameters). The endpoints reject any request whose signature does not match. If validation fails because the reconstructed URL does not match the host Twilio actually called (custom domain, redirect), set `TWILIO_WEBHOOK_BASE_URL` to the exact base URL Twilio uses (e.g. `https://your-app.vercel.app`).

Before creating real work orders or sending outbound messages, add a persistent idempotency store keyed by `MessageSid`/`CallSid` so a Twilio retry cannot duplicate work.

## Safety model

Phase 1 recognizes explicit emergency signals including suspected gas/CO, fire/smoke, electrical arcing/fire, major active flooding, sewage backup with exposure risk, and immediate life-safety hazards. Emergency responses tell the occupant to prioritize personal safety and appropriate emergency/utility services rather than waiting for maintenance.

This software assists maintenance intake; it is not a substitute for emergency services or qualified on-site diagnosis.
