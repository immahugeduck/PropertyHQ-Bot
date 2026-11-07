# Conversation Coordinator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a friendly SMS maintenance coordinator with persistent tenant context, staff-controlled appointments and accurate PropertyHQ records.

**Architecture:** Keep deterministic safety and authorization in front of AI interpretation. Persist identity/conversation state, use typed intents for controlled changes, and deliver notifications through an idempotent outbox.

**Tech Stack:** Node ES modules, native fetch, Supabase PostgreSQL/PostgREST, Twilio webhooks, OpenAI structured responses, node:test.

**Spec:** ../specs/2026-11-01-conversation-coordinator-design.md

## Global Constraints
- Use existing isolated checkouts; no worktree unless requested.
- No real messages, calls, migrations or production deployment during implementation.
- New requests: configured maintenance phone ending 9030. Updates/emergencies: configured manager phone ending 6088. Never infer full numbers from suffixes.
- Only those two configured staff identities supply appointment options or report progress/completion.
- Unknown identities require staff-approved linking before private context is disclosed. Preserve emergency response and opt-out behavior.
- All service-role operations require explicit account scope; no arbitrary model-generated recipients or database operations.
- SMS/MMS is the initial conversational channel; preserve other handlers.

## Review Focus
- Shared/reassigned phone and multiple properties: do not select a tenant arbitrarily; test in Task 1.
- Concurrent webhook delivery and retries: no duplicate request or notification; test in Task 2.
- Two tenants choose overlapping/stale appointments: do not silently double-book; test in Task 3.
- Forged staff intent or prompt injection: never gains authority or cross-account information; test in Task 4.
- Database/AI/send outage: no false success, and emergency guidance still returns; test in Task 5.

## Files and interfaces
New bot modules: src/identity.js (contact resolution), src/conversation-store.js (scoped state), src/coordinator.js (intent decisions), src/appointments.js (option lifecycle), src/assistant.js (OpenAI adapter), src/notifications.js (outbox dispatch). Keep src/triage.js as the independent safety classifier. Integrate via api/twilio/sms.js; adapt src/intake.js and src/staff.js without changing other channels' behavior. Migration belongs in the PropertyHQ repository, where schema is maintained.

Shared objects: Scope={userId,twilioNumber}; Identity={state:'known'|'pending'|'ambiguous',contactId,tenantId,propertyId,role:'tenant'|'unknown'|'maintenance'|'manager'}; Context={scope,identity,conversationId,version,messages,jobs,appointments}; Intent={type,jobId,fields}; Decision={reply,actions,nextState}. Nullable IDs stay null until resolved. Action fields are validated per intent; the model never supplies authority or scope.

### Task 1: Persistent contact identity and scoped storage
**Files:** create src/identity.js, src/conversation-store.js, test/identity.test.js; create PropertyHQ/supabase/migrations/20261102000000_conversation_coordinator.sql.
**Interfaces:** resolveIdentity({scope,fromNumber,db,fetchImpl})->Identity; loadContext({scope,identity,db,fetchImpl})->Context. Persist pending names/address separately from verified tenant bindings.
- [ ] Write failing fixture tests: known phone returns stored property without asking address; pending name survives second message; multiple matches remain ambiguous; staff approval links prior pending messages; foreign account and unapproved sender cannot read tenant data; reassigned phone can be unlinked by staff.
- [ ] Run `node --test test/identity.test.js`; require meaningful failing assertions before implementation.
- [ ] Implement scoped contact bindings (unique account/phone), pending contact claims, conversations with version, and staff approval audit events. Migration adds RLS, foreign keys and account/contact indexes. Reuse tenant phone_e164 as existing verified context; do not overwrite tenant contact details automatically.
- [ ] Run identity tests to pass. Review migration statically; do not apply it.

### Task 2: Durable state transitions and notification outbox
**Files:** modify the migration and src/conversation-store.js; create src/notifications.js and test/conversation-store.test.js.
**Interfaces:** commitDecision({context,eventId,decision,db})->{applied,duplicate,version}; dispatchPending({scope,db,sendImpl})->delivery outcomes. Event IDs derive from verified Twilio MessageSid.
- [ ] Write failing tests for duplicate SID, two concurrent messages using the same version, separate jobs within 24 hours, failed persistence and repeated outbox dispatch.
- [ ] Run `node --test test/conversation-store.test.js` and confirm failures.
- [ ] Add atomic account-scoped database transition function with expected-version checks, unique event IDs and outbox action keys. Use row locking/transactions in PostgreSQL; avoid claiming a multi-request REST sequence is atomic. Track queued/sending/sent/failed delivery and provider IDs. Do not retry ambiguous provider acceptance blindly: mark for reconciliation to avoid duplicate SMS.
- [ ] Pass tests and inspect migration for authorization, transaction boundaries and safe retries.

### Task 3: Staff availability, tenant choice and job summaries
**Files:** create src/appointments.js, test/appointments.test.js; modify src/staff.js and migration.
**Interfaces:** decideAppointment({context,intent,now})->Decision; summarizeJobs({context,filter,now})->string.
- [ ] Add failing tests for two/three staff options, choice by number/time, no matching option, expired option version, concurrent conflicting booking, timezone/date ambiguity, reschedule, staff status query and job completion.
- [ ] Run `node --test test/appointments.test.js` and verify failures.
- [ ] Persist appointment options with explicit start/end/timezone, proposal version and selection; reject past/ambiguous times and ask clarification. Check conflicts for both staff before atomic booking. Distinguish scheduling from in_progress; allow only staff-reported work start/completion. Queue tenant confirmations plus manager updates and staff booking confirmation. Queries include all account jobs, with bounded pagination and clear status grouping; clarify ambiguous job references.
- [ ] Pass appointment tests. Confirm rejected choices do not update scheduled_at or work status.

### Task 4: Contextual AI interpretation with controlled actions
**Files:** create src/assistant.js, src/coordinator.js, test/assistant.test.js, test/coordinator.test.js.
**Interfaces:** interpretMessage({context,text,fetchImpl,signal})->Intent; decideConversation({context,intent,safety,now})->Decision. Assistant uses OPENAI_API_KEY and configurable model; native fetch and strict structured output.
- [ ] Add failing tests for friendly known-tenant intake without address repetition, one missing-field question, unrelated new request, tenant impersonating staff, instructions embedded in messages, cross-tenant job IDs, malformed output, timeout and unavailable model.
- [ ] Run `node --test test/assistant.test.js test/coordinator.test.js` and confirm failures.
- [ ] Implement bounded context selection and request timeout; validate response schema and allowlist intents: collect_contact, request_link_approval, approve_contact, new_request, add_details, request_status, offer_times, select_time, request_alternatives, start_work, report_progress, complete_work, clarify. Recheck role/ownership in application logic. Never send credentials, unrelated tenants, rent or lease information to the model. Fallback uses known context and pending state rather than generic repetitive prompts.
- [ ] Pass tests with fake OpenAI responses, including denial and outage cases; no external AI calls in the suite.

### Task 5: SMS integration and end-to-end fixture conversations
**Files:** modify api/twilio/sms.js, src/intake.js, src/staff.js; create test/conversation-flow.test.js; update README.md and .env.example.
**Interfaces:** SMS handler retains signature verification and keyword short-circuit, then resolves scope/context, runs deterministic safety, interprets within remaining deadline, commits validated actions and dispatches outbox.
- [ ] Add failing simulated sequences: known tenant -> issue -> staff options -> tenant choice -> staff progress -> completion; unknown sender -> saved claims -> staff approval -> remembered address; emergency during identity collection; duplicate webhook; database failure; send failure; AI timeout; staff summary with multiple open jobs.
- [ ] Run `node --test test/conversation-flow.test.js` and verify failures.
- [ ] Integrate new coordinator for SMS only. Remove latest-job/24-hour guessing from that path and preserve legacy behavior for voice. Return immediate deterministic emergency guidance without waiting on AI. Use truthful acknowledgement if logging/alerting fails; preserve attempted interaction for retry where storage permits. Keep deadline below Twilio webhook budget. Document conversation model, staff examples, required migration, model setting and network prerequisites.
- [ ] Run `npm test` and `npm run check` in PropertyHQ-Bot. Run PropertyHQ tests and production build for compatibility. Validate no live-network tests, secret output or unintended tracked changes. Review changes before any integration commit.

## Release prerequisites (separate from implementation)
- Review migration and apply only with separate authorization; no changes to live tenant records during development.
- Read-only check of triage_settings must confirm configured full staff phones match 9030/6088; a mismatch blocks live enablement.
- Configure/verify approved OpenAI destination and selected model access without printing credentials. Keep AI disabled until schema and configuration are ready.
- Review simulated conversation transcripts, then separately authorize a controlled live pilot. No production deployment or real outbound traffic is included here.

## Self-review
Identity, routing, history, scheduling, summaries, tenant notifications, safety and failures each have an owning task and fixture acceptance tests. Persistent status and appointment state remain distinct. The migration and operational enablement are explicit release prerequisites, not assumed installed capabilities.

## Implementation outcome

Implemented on `feat/conversation-coordinator` in both checkouts. Verified 122 bot tests, syntax checks, 12 PropertyHQ tests and production build. PostgreSQL migration tests run in disposable PGlite. No live schema or messaging changes were made.

Refinements: staff confirms parsed options with `CONFIRM OPTIONS`; tenant confirms displayed date with `CONFIRM`. Revoked contact destinations are canceled before delivery. AI selects intent and relevant follow-up question; outcome wording stays application-controlled. Delivery uses a separately authenticated worker, which must be scheduled and monitored before rollout. Model access and live API credentials remain untested.
