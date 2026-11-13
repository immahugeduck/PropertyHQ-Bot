# Scheduled Maintenance Check-ins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send one maintenance check-in at a confirmed visit time and notify the tenant after verified completion.

**Architecture:** Reuse the enabled every-minute delivery worker. SQL creates and revalidates visit-linked outbox rows; native staff parsing resolves completion without depending on model interpretation.

**Tech Stack:** Existing JavaScript, Supabase PostgreSQL, Twilio and cron-job.org; no new dependencies or scheduler.

**Spec:** `docs/superpowers/specs/2026-11-13-visit-status-checkins-design.md`

## Global Constraints

- Preserve #1013 at `2026-11-13T15:00:00Z` (10 AM America/Indiana/Indianapolis).
- One check-in per request and exact scheduled instant; fifteen-minute recovery window.
- No reminder may assert work started or finished; completion needs verified staff.
- Preserve entry restrictions, manager-review scope, account isolation and uncertain-delivery handling.
- No immediate production SMS; use fictional local fixtures, then deploy under standing authorization.

## Review Focus

- Reschedule, cancel or revoke entry after enqueue: suppress obsolete check-ins before claiming.
- Repeated completion with a different inbound SID: one tenant completion notification.
- Bare completion with competing jobs or an unknown explicit number: keep request binding correct.
- Inspection completion: return findings to manager review, preserving the installation approval boundary.
- Runner repeats, delayed ticks and return to a formerly cancelled visit time: one valid check-in, no stale replay.

## Task 1: Complete the scheduled check-in workflow

**Files:**
- Create: PropertyHQ `supabase/migrations/<CLI-generated>_visit_status_checkins.sql`.
- Create: `test/visit-checkins-database.test.js`, `test/visit-status-replies.test.js`.
- Modify: `test/helpers/coordinator-fixture.js`, explicit migration loaders, `src/assistant.js`, `src/coordinator.js`, `README.md`.

**Interfaces:**
- Consumes: `coordinator_claim_outbox(p_user uuid)`, `coordinator_commit(...)`, saved confirmed appointments and scoped staff context.
- Produces: private `coordinator_enqueue_visit_checkins(p_user uuid,p_now timestamptz default now()) returns integer`; nullable outbox `visit_checkin_at timestamptz`; deterministic staff completion intents.

- [ ] Write behavior tests for due/early/expired reminders, account/role scope, stable deduplication, attended access, invalidation, and reminder-to-completion tenant delivery.
- [ ] Run new tests and confirm missing reminder behavior and completion parsing fail for the expected reasons.
- [ ] Add the private enqueuer and delivery-time validation, preserving the existing outbox gate and claim contract. Bind uniqueness to request/time and retain safe cancelled-before-send reactivation.
- [ ] Add bounded staff completion/progress parsing and native plus SQL repeated-completion suppression.
- [ ] Run focused tests; then full `npm test` in both repositories, bot `npm run check`, and both diff checks. Expect all tests and checks to pass.
- [ ] Get one fresh read-only review; reproduce Important findings before fixes, run focused regressions and full suite after fixes.
- [ ] Commit both repositories, apply only the new migration, push main and verify fresh production builds and endpoints.
- [ ] Re-read the existing runner status and #1013 eligibility; leave its appointment intact for the scheduled real test.
