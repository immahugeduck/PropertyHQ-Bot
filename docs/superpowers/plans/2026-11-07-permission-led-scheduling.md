# Permission-led Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task, followed by one independent review.

**Goal:** Route scheduling by tenant entry permission, with calendar suggestions sent exclusively to maintenance for approval.

**Architecture:** PostgreSQL computes scoped free openings and stores private suggestions in the existing appointment/version records. Controlled JS decisions route staff approval to direct booking or tenant choices; the transactional RPC rechecks authority, consent and conflicts.

**Tech Stack:** Existing Node ES modules, Supabase PostgreSQL, Twilio outbox, node:test and PGlite.

**Spec:** ../specs/2026-11-07-permission-led-scheduling.md

## Global Constraints
- Suggestions go only to maintenance; staff approval precedes booking or tenant choices.
- Entry permission: one exact visit. Refusal: three options. Unknown permission cannot authorize unattended entry.
- Use configured timezone, open_days/open_time/close_time and a 14-day horizon, at least one-hour lead time, one-hour internal reservations.
- Do not disclose private calendar details, guess availability, replay historical alerts, delete records, or send development test messages.

## Review Focus
- Permission revoked between suggestion and staff approval must block unattended booking.
- Private suggestions must not become tenant-visible options or numeric choices.
- Concurrent bookings, staff blocks and date-only portal visits must prevent conflicts.
- A partial/no-free-time calendar must request staff help without fabricating three times.
- Duplicate webhooks and stale proposal approvals must not double-book or re-notify.

### Task 1: Calendar suggestions and atomic direct booking
**Files:** New PropertyHQ migration `20261107030000_permission_led_scheduling.sql`; Bot `test/coordinator-database.test.js`.
**Interfaces:** SQL `coordinator_free_slots(user,ignore_request)` returns start/end JSON options; `coordinator_refresh_suggestions(user,request)` stores private awaiting_staff options; `coordinator_scheduling_note(user,request)` renders staff-only recommendation. `book_visit` RPC action requires staff, explicit current tenant consent, one exact future slot and conflict-free atomic update.
- [x] Add failing PGlite cases for private suggestions, working hours/calendar/manual conflicts and permission-gated staff booking.
- [x] Implement SQL functions, private context masking, new-request/form/update recommendation routing, and booking outbox notices.
- [x] Run database tests; verify real SQL checks actor scope, stale version, consent and conflicts independently of JS.

### Task 2: Permission-aware conversations and staff approval
**Files:** New `src/staff-scheduling.js`, `test/permission-scheduling.test.js`; modify `src/coordinator.js`, `src/assistant.js`, `src/intake-details.js`.
**Interfaces:** `decideStaffScheduling({context,job,type,fields,nextState,now})` returns a controlled decision; new internal intents `request_times` and `approve_suggestions` use job-scoped stored options/version. Manual offers remain possible but follow permission policy.
- [x] Write failing examples for intake, yes/no/unknown branches, staff-only recommendation approval, invalid/stale/cross-role approval, and tenant summary privacy.
- [x] Implement one-slot booking vs three-slot tenant choice and truthful friendly acknowledgments; preserve latest-question context and pending offers.
- [x] Update existing fixtures only where the approved scheduling policy intentionally changed; retain isolation/consent/version assertions.

### Task 3: Whole-flow verification and release
**Files:** Tests above, documentation and operator ledger.
- [x] Run full bot tests and syntax checks, PropertyHQ tests, and diff checks.
- [x] Obtain independent review, address significant findings, rerun affected/full checks.
- [x] Commit and push source; apply additive migration with history; deploy to the authorized live pilot.
- [x] Verify production health and worker status without sending test messages or backfilling alerts.
