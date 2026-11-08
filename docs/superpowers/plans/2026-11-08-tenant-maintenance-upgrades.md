# Tenant and Maintenance Workflow Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this authorized plan task by task. Steps use checkboxes to track progress.

**Goal:** Capture tenant information reliably and provide simple, accurate maintenance communication in three upgrades, testing examples between each.

**Architecture:** Keep Property HQ as the ticket and job-state authority. Improve deterministic permission handling in the bot, format staff messages from committed state in SQL, and exercise the complete coordinator workflow against an in-memory database.

**Tech Stack:** Node.js ES modules, node:test, Supabase Postgres functions, PGlite 0.3.14, Property HQ Vitest.

**Spec:** [Tenant capture and maintenance communication](../specs/2026-11-08-tenant-maintenance-upgrades.md)

## Global Constraints

- Three independently testable upgrades; native execution; no production deployment.
- Property HQ creates and numbers tickets.
- No real SMS, live ticket edits, or live alert replay during testing.
- Permission is job-specific; preserve refusals/restrictions and explicit revocation.
- Permission alone never books a visit; maintenance approves scheduling.
- Preserve transactional persistence, verified identities, emergency routing, idempotency and calendar conflict checks.
- New internal SQL helpers must not be callable by public, anon or authenticated.

## Review Focus

1. Positive permission wording with a restriction must not permit unrestricted entry: Upgrade 1 tests.
2. A short answer after a different question or for another job must not set permission: Upgrade 1 tests.
3. An unchanged permission answer must not spam maintenance or invalidate its displayed proposal: Upgrade 2 tests.
4. A permission revocation after scheduling must reach maintenance and invalidate stale staff approval: Upgrades 2 and 3 tests.
5. An alternative-time request must save availability, clear the old selection and reject stale choices: Upgrade 3 tests.

## File map

Bot:
- `src/entry-consent.js`: bounded interpretation of entry answers.
- `src/assistant.js`: job binding and deterministic reply intent.
- `src/coordinator.js`: tenant acknowledgement and rescheduling state.
- `test/entry-permission-flow.test.js`: raw entry-answer examples and scope boundaries.
- `test/tenant-maintenance-workflow.test.js`: real persistence and actual staff outbox assertions.
- `test/helpers/coordinator-fixture.js`: local database and RPC fixture; no live services.
- Existing database test files: load the new additive migration so lifecycle checks cover the current SQL.

Property HQ:
- New `supabase/migrations/*_tenant_maintenance_handoff.sql`: work-order helper and updated commit/form functions.
- `supabase/README.md`: migration and release ordering.

## Upgrade 1: capture tenant permission accurately

**Interfaces**
- Consumes: `entryConsent(text, priorReply) -> boolean | undefined`; `interpretMessage({context,text,...}) -> intent`; `decideConversation({context,intent,...}) -> {reply,actions,nextState}`.
- Produces: existing `add_details` action with a job-specific `fields.facts.entryPermission` boolean and a concise permission acknowledgement; signatures stay unchanged.

- [x] Add failing raw-text examples for `Yes permission granted.`, punctuation/case variants and `Permission granted.` after the unattended-entry question. Assert one update to the question's original job, permission true, and no repeated question.
- [x] Add cases for refusals, conditional wording, another question, another job/tenant and a completed job. Assert no unrestricted permission for these cases.
- [x] Run `node --test test/entry-permission-flow.test.js`; confirm the BREE cases fail because permission is absent, then implement the bounded parser and acknowledgement changes.
- [x] Add a fixture using real coordinator migrations and RPCs. Replay the raw BREE permission answer, reload the ticket, and assert one job, permission true and consistent outgoing permission state.
- [x] Run focused examples, `npm test`, and `npm run check`; record exact results and commit this upgrade.

## Upgrade 2: simplify the maintenance handoff

**Interfaces**
- Consumes: existing `coordinator_commit(p_user,p_from,p_sid,p_version,p_message,p_decision)`, `coordinator_form_intake()`, and stored `maintenance_requests.coordinator_details`.
- Produces: internal `coordinator_work_order(p_user uuid,p_request uuid,p_update text default null) -> text`; unchanged public RPC and outbox contracts, including `schedule_proposal` snapshots.

- [x] Extend workflow tests before implementation. Assert maintenance receives one job reference, repair facts and a clear permission status, without the raw `Yes permission granted` text. Assert the manager receives initial context and later context updates.
- [x] Add failing checks for ambiguous clarification and repeated unchanged permission: no extra maintenance notification and no proposal-version churn. Assert changed permission after a booking still alerts maintenance.
- [x] Create an additive migration using the Supabase CLI. Preserve existing function authority/validation and format maintenance bodies from saved state; keep manager context separate. Reuse the helper for form intake and scheduling follow-ups.
- [x] Load the migration in all real-database fixture tests. Run `node --test test/tenant-maintenance-workflow.test.js test/coordinator-database.test.js test/permission-scheduling-database.test.js` and inspect the actual bodies and saved fields.
- [x] Run `npm test` and `npm run check` in the bot, and `npm test` in Property HQ. Record results and commit this upgrade in both repositories.

## Upgrade 3: close the scheduling and follow-up loop

**Interfaces**
- Consumes: `request_alternatives` intent with `fields.description` and `fields.facts`, and persisted pending tenant selection.
- Produces: same action with validated facts, cleared `nextState.pendingSelection`, saved availability and invalidated old database options.

- [x] Add a failing coordinator example in which a tenant changes availability while requesting alternatives. Assert the action includes `availability`, old selection is removed, and omitted permission is not restored or revoked.
- [x] Implement that state transition in `src/coordinator.js` without changing staff scheduling authority.
- [x] Extend the real workflow examples: BREE washer → saved permission → maintenance approval → booked notice; sink refusal → three approved choices → tenant confirmation; window/screen report; alternatives with saved availability; permission revocation; duplicate inbound SID; status and completion; a competing occupied slot.
- [x] For AI-dependent initial issue extraction, fixture only the external model response. Keep raw permission parsing, coordinator decisions, fresh context loads, SQL commits and outbox generation real. Label this distinction in test results.
- [ ] Run the focused workflow file and all bot tests/checks, plus Property HQ tests. Update the example-results document, commit, and request one independent whole-change review.

## Release sequence

Each upgrade is independently reviewable. Upgrade 1 can ship before the SQL handoff. For Upgrade 2, apply the additive Property HQ migration before releasing the corresponding bot changes. Upgrade 3 follows passing scheduling examples. This session prepares and validates changes locally; it does not apply migrations or send test traffic in production.

## Example checkpoints

| Upgrade | Example input | Required observable result |
| --- | --- | --- |
| 1 | BREE: `Yes permission granted.` | Same ticket; saved permission true; no second question. |
| 1 | `Yes, but only if I'm home.` | No unrestricted entry; original restriction retained. |
| 2 | Tenant answers permission | Manager gets context; maintenance gets current job facts and a next step. |
| 2 | Tenant repeats the same answer | No extra maintenance alert or changed proposal. |
| 3 | Maintenance approves with permission | One confirmed visit; tenant informed; no tenant reapproval loop. |
| 3 | Tenant refuses unattended entry | Three staff-approved choices; tenant agrees to a specific time. |
| 3 | `Those times don't work; weekdays after 4.` | Availability saved; previous selection cleared; no invented booking. |

## Progress

See [example test results](../../TENANT_MAINTENANCE_RESULTS.md) for checkpoint results, known limitations and completion status.
