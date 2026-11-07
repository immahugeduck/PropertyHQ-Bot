# PropertyHQ conversation coordinator

## Approved intent
Replace repetitive, directionless maintenance texting with friendly conversations grounded in PropertyHQ. Remember verified tenants, their property and relevant jobs across interactions. Record every accepted interaction and resulting action. Staff remain the source of availability and job progress.

## Approach
Selected: AI coordinator with controlled actions. An LLM interprets messages and drafts concise, warm replies using scoped records; deterministic application code validates and executes actions. Alternative: a fixed guided flow is simpler and predictable but less flexible with natural staff and tenant messages. Keep the existing emergency classifier as an independent first step.

## Behavior
- Known verified phone: reuse tenant/contact and property context; never repeatedly request address. If multiple properties or jobs match, ask which one instead of guessing.
- Unknown phone: collect missing name and address/unit one question at a time, retaining prior answers across messages. Save a pending contact and candidate match. Do not disclose tenant details or bind the phone based only on a claimed name/address. Staff approve matches; ambiguous/unmatched contacts remain pending and can still report maintenance. This approval mechanism is the implementation proposal for the agreed verification requirement.
- Link accepted messages, notes and actions to the resolved contact and job, keeping unresolved messages pending until verified. Preserve the original message and identity-decision audit trail.
- New requests go to the configured maintenance number ending 9030. Updates and emergencies go to the configured manager number ending 6088. Both roles can provide availability/progress and ask for job summaries. Resolve full numbers from triage_settings; never construct a number from its suffix. Confirm mismatches before enabling live traffic.
- Staff supply two or three concrete appointment options. Store options before presenting them. The tenant chooses by number or clear wording; confirm selection, update PropertyHQ and notify staff. None suitable: collect availability and return to staff. Never invent availability or silently book a proposed time.
- Keep scheduling negotiation separate from work status: awaiting details, awaiting options, awaiting tenant selection, confirmed, and rescheduling. Existing work statuses remain open, in_progress and completed. Staff explicitly report work started and completed; scheduling alone is not work started.
- Tenants receive intake, confirmed appointment, meaningful progress, reschedule and completion updates. Staff summaries distinguish new, awaiting scheduling, scheduled, ongoing and completed jobs, using current records and the account timezone.
- Keep unrelated requests separate even within the existing 24-hour follow-up window. Ask a short clarification for ambiguous references such as 'that one'.
- Emergencies get deterministic safety guidance immediately, without waiting for identity collection or AI. Notification claims reflect actual send results; never promise an unverified response time.

## Boundaries and reliability
Initial conversational release targets Twilio SMS/MMS. Preserve existing voice, AgentPhone and Inkbox functionality; their conversational expansion is separate. No rent, payment, lease or unrelated tenant disclosures. No autonomous appointment availability, closure, or invented repair advice.

All reads and writes are account-scoped and tenant-scoped as appropriate, including service-role queries. Only configured manager/maintenance phones receive staff powers. Model output is untrusted: validated intents and allowlisted fields only, never arbitrary SQL, URLs or recipients. Give the model the minimum relevant conversation and maintenance data; never credentials. Preserve Twilio signatures and STOP/START/HELP handling.

Persist conversation state and scheduling across serverless invocations. Use webhook idempotency, atomic state transitions and an outbound outbox so retries do not duplicate jobs or alerts. Proposed appointments have versions; outdated/conflicting selections require fresh staff confirmation. Surface persistence/send failures honestly and retain retryable actions. If AI is unavailable, use a contextual deterministic fallback and staff handoff. Logging failures must not be presented as successful recording.

## Implementation choices and release
Reuse Node ES modules, native fetch, Supabase REST and existing tests. Add explicit identity, conversation, appointment and outbox storage in a reviewed migration; do not overload free-text tenant notes. Use existing triage_settings timezone. Keep model name configurable, use a structured response schema and bounded timeouts compatible with the Twilio webhook deadline.

Tests use fixtures and fake external calls. No real messages, calls, migrations or production deployment during implementation. Migration application and live rollout require a separate authorized step. Review OpenAI network access and model configuration before runtime enablement. OpenAI API-key presence does not prove API access.

## Acceptance
Known tenant repeats no address; unknown sender remembers supplied details and cannot access records before approval; separate jobs stay separate; both staff roles can query and update correct jobs; only staff-provided appointment options can be selected; confirmed scheduling and completion notify the tenant and required staff; emergency safety remains immediate; retries, concurrent messages, stale options and service failures preserve truthful records without duplicate side effects.
