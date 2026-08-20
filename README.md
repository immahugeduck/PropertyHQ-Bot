# Maintenance Triage Agent

Production-shaped Phase 1 backend for receiving AgentPhone webhook events and triaging maintenance requests for First Call Maintenance.

Phase 1 establishes:
- AgentPhone webhook endpoint
- HMAC webhook verification
- normalized inbound message parsing
- deterministic safety-first maintenance triage
- emergency escalation guidance
- structured audit logging
- health endpoint
- automated tests

## Architecture

Tenant -> AgentPhone -> `/api/agentphone/webhook` -> signature verification -> triage engine -> structured response

The initial triage engine is intentionally deterministic. AI-assisted classification can be layered on later, but safety-critical categories are not delegated to an LLM alone.

## Local setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local`
3. Set `AGENTPHONE_WEBHOOK_SECRET` to the secret returned when configuring the AgentPhone webhook.
4. Run tests: `npm test`
5. Run locally: `npm run dev`

## Endpoints

- `POST /api/agentphone/webhook` - AgentPhone webhook receiver
- `GET /api/health` - health/configuration check

## AgentPhone setup

Configure the project or agent webhook to:

`https://YOUR_DEPLOYMENT/api/agentphone/webhook`

Set AgentPhone to include recent conversation context. Keep the webhook secret only in deployment environment variables.

## Safety model

Phase 1 recognizes explicit emergency signals including suspected gas/CO, fire/smoke, electrical arcing/fire, major active flooding, sewage backup with exposure risk, and immediate life-safety hazards. Emergency responses tell the occupant to prioritize personal safety and appropriate emergency/utility services rather than waiting for maintenance.

This software assists maintenance intake; it is not a substitute for emergency services or qualified on-site diagnosis.
