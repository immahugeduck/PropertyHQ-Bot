# Phase 1 Architecture

## Purpose

Receive tenant maintenance traffic from AgentPhone through a standing HTTPS webhook and classify it safely enough to drive intake and escalation workflows.

## Request path

1. AgentPhone receives SMS/iMessage or a voice transcript.
2. AgentPhone sends a signed `agent.message` event to `/api/agentphone/webhook`.
3. The backend verifies `X-Webhook-Signature` against `X-Webhook-Timestamp` and the exact raw body before processing the event.
4. The event is normalized into a provider-independent shape.
5. Deterministic safety rules run before any future AI classifier.
6. For voice, a tenant-facing spoken response and triage state are returned. SMS/MMS/iMessage replies will be sent through the outbound Messages API after durable idempotency is implemented.
7. A privacy-conscious audit event is logged without the message body or phone number.

## Severity contract

- `ROUTINE`: ordinary maintenance intake.
- `PRIORITY`: issue should receive accelerated maintenance review but no explicit immediate life-safety signal was detected.
- `URGENT`: substantial habitability/sanitation problem requiring prompt attention.
- `EMERGENCY`: explicit life-safety or severe active property hazard; tenant response prioritizes safety/emergency services and immediate escalation.

## Security boundaries

- Reject unsigned/invalid webhook requests.
- Reject deliveries outside AgentPhone's five-minute replay window.
- Never commit AgentPhone/OpenAI/database secrets.
- Avoid logging message bodies and phone numbers by default.
- Do not let an LLM downgrade a deterministic emergency match in future phases.
- Persistent records should use least-privilege database credentials and explicit retention rules.

## Phase 1 limitations

- Tenant/property identity is not yet persisted.
- Webhook IDs are not yet persisted for retry idempotency; complete this before creating real work orders or sending notifications.
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
