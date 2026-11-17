# Request notes and follow-ups Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Keep clear request history, show the next actor in Property HQ and send capped reminders when an action stalls.

**Architecture:** Extend saved request state in Supabase and the existing minute outbox worker. Applied actions create internal activity entries atomically. Owner-scoped UI reads that history and the same waiting state the worker validates.

**Tech Stack:** PostgreSQL/Supabase, Node.js native tests with PGlite, Next.js/React/TypeScript, Vitest, existing Twilio delivery.

**Spec:** ../specs/2026-11-16-request-notes-followups-design.md

## Global Constraints

- Preserve bot d49850b and Property HQ c5fee3a, including completion notes and model diagnostics.
- Default first reminder: 24 elapsed hours; configurable 1–168 hours; two per waiting cycle.
- Working days/hours/time zone come from existing account settings.
- Internal notes never create outbound messages. Closed, future scheduled and optional quote requests do not receive stalled-action reminders.
- Existing requests start the waiting clock at rollout. No live test SMS or historical backlog.
- Existing authorization covers implementation, main pushes and deployment; routine builder choices are recorded in the design. Optional interval clarification can override the default.

## Review Focus

- A private note or status question must not postpone a genuinely stalled action.
- Two simultaneous requests must retain separate actors, histories and reminder identities.
- A reply after queueing must invalidate the obsolete reminder before delivery.
- A changed/revoked recipient and uncertain provider acceptance must not cause a duplicate send.
- Existing raw note edits must not overwrite concurrent bot history from a stale browser snapshot.

### Task 1: Request activity and next-action display

**Files:** Create the CLI-generated `_request_notes_followups.sql` migration in PropertyHQ; `components/maintenance/request-activity.tsx`, `components/maintenance/waiting-indicator.tsx`, `lib/maintenance-workflow.ts` and its Vitest test. Modify maintenance list/detail, edit form, types and bot fixture. Create bot `test/request-followups.test.js`.

**Interfaces:** SQL `coordinator_refresh_waiting(p_user uuid,p_request uuid,p_now timestamptz default now(),p_progress boolean default false)` derives saved actor/reason/since/token. `maintenance_add_note(p_request uuid,p_body text)` returns a new activity id after ownership validation. `maintenance_pause_followups(p_request uuid,p_paused boolean)` controls request reminders. `coordinator_record_activity(...)` is private and runs only for an actually applied request action. UI formatter consumes saved coordinator waiting fields, never infers permission.

- [x] Write and run failing real-SQL tests for tenant entry → maintenance scheduling, review/optional reply, scheduled/started visit, meaningful progress vs questions and private notes, duplicate SID, two jobs, internal manual notes and account isolation. RED must identify missing waiting fields/activity, not an invalid fixture.
- [x] Add owner-only activity/settings storage, waiting derivation, triggers for portal/appointment updates and an applied-action hook in the current commit function. Preserve all existing action validation.
- [x] Run those tests GREEN and replay existing completion/review/access tests. Expected: no extra outbox messages for note saving or state tracking.
- [x] Write UI formatter tests for each saved state, invalid/missing dates and reminder pause; observe RED, implement formatter and the list/detail badge. Add the internal note form and chronological activity, preserving earlier notes. Omit raw notes from edit submissions to prevent lost updates.
- [x] Run HQ tests, touched-file lint/type checks and inspect rendered list/detail with fictional data. Commit the coherent first part locally in each repo.

### Task 2: Capped reminder delivery and release

**Files:** Extend the same additive migration; add `components/settings/maintenance-followup-settings.tsx`, modify settings page and bot reminder integration tests. Update results docs and fixture migration loading.

**Interfaces:** `coordinator_enqueue_followups(p_user uuid,p_now timestamptz default now()) returns integer`; `coordinator_followup_valid(p_user uuid,p_outbox uuid,p_now timestamptz default now(),p_delivery boolean default false) returns boolean`. Claim uses these without changing the public Node delivery API. Reminder outbox columns bind waiting token and number; uniqueness is per account/request/token/number. `maintenance_save_followup_settings(p_enabled boolean,p_hours integer)` is owner-only.

- [x] Add and run failing SQL tests: no early/quiet-hour reminder; one at the threshold; second at two intervals; cap thereafter; stale reply/booking/completion; pauses; two jobs; revoked/rerouted contacts; uncertain delivery and duplicate ticks. Use literal controlled account-local times and real SQL.
- [x] Implement discovery plus final claim validation and cancellation, retaining visit check-ins and the normal outbox claim limit. Record queued reminders in activity without claiming delivery succeeded.
- [x] Add settings interval/enable UI. Validate bounds and signed-in ownership in SQL independently of the browser.
- [x] Run targeted tests GREEN, then full bot and HQ suites plus type/lint checks and builds. Expected: all pass; fictional tests produce no carrier traffic.
- [x] Request one fresh whole-branch review. Fix Important/Critical findings in one RED→GREEN pass; rerun full affected checks. Record any scope decisions in results.
- [x] Fetch both main branches, integrate concurrent changes, apply only the new migration, verify private permissions and no historical backlog, push main non-force, and verify exact-SHA production builds, public health and worker status.
