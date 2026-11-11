# Manager Review Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement the approved flow task by task. Track steps with checkboxes.

**Goal:** Route management decisions to the manager and deliver explicit tenant-facing replies exactly, without premature maintenance work.

**Architecture:** Add review state and the saved outward manager reply to existing Property HQ requests. Deterministic bot commands and SQL validation protect role, recipient and verbatim content; the existing coordinator/outbox handles persistence and delivery.

**Tech Stack:** Existing Node ES modules, node:test, Supabase Postgres functions, PGlite 0.3.14 and Property HQ Vitest.

**Spec:** [Approved manager-review design](../specs/2026-11-11-manager-review-design.md).

## Global Constraints

- Exact `SEND:` content, manager-only decisions, account/tenant isolation and no implicit approval from outward wording.
- Manager review and approval persist on the request; ordinary repairs and emergency routing retain their existing behavior.
- No new framework, live messages, live data changes or production deployment.
- Retain RPC signatures, transactional commits, duplicate-SID protection and the existing outbox worker.
- No automatic interpretation of quote/payment language as authority to install or charge anyone.
- `APPROVE INSPECTION` authorizes inspection only; `APPROVE WORK` is a separate explicit decision.

## Review Focus

1. Exact `SEND:` bodies containing dates, job numbers or approval commands must not change routing or schedule anything: Tasks 1–2.
2. Two pending reviews must not send an unnumbered reply to the latest tenant by guessing: Tasks 1–2.
3. Conditional approval, affordability acknowledgements and quotes must preserve the correct blocked review state: Tasks 1–2.
4. Forged roles, mismatched command bodies and cross-account jobs must fail in SQL independently of the bot: Task 2.
5. Inspection-only authorization and ordinary/emergency repair paths must remain distinct: Tasks 1–3.

## Task 1: bot interpretation and decisions

**Files:** create `src/manager-review.js`, `test/manager-review.test.js`; modify `src/assistant.js`, `src/coordinator.js`, `src/staff-scheduling.js`, `src/appointments.js`.

**Interfaces:** `isReviewPending(job) -> boolean`; `requiresManagerReview(text) -> boolean`; `interpretReviewMessage({context,text}) -> intent | undefined`; `decideManagerCommand({context,intent,nextState}) -> decision`. New intents/actions: `request_manager_review`, `send_manager_reply`, `authorize_manager_request`, `manager_review_note`, `review_followup`, `acknowledge_review` (ack decision uses `review_followup` with notification disabled).

- [x] Write failing raw-message tests for the exact spigot request, ordinary broken fixtures, exact/empty/multiline `SEND:`, ambiguous pending reviews, internal manager notes, tenant acknowledgements and separate inspection/work authority.
- [x] Run `node --test test/manager-review.test.js`; expected new review/command assertions fail against existing behavior.
- [x] Implement focused review helpers and wire them before ordinary parsing/decision branches. Preserve exact bodies; do not run them through the model or scheduling regexes. Add active-tenant-only saved manager reply to model context.
- [x] Run the focused file, then `npm test` and `npm run check`; expected zero failures. Commit bot decisions and tests.

## Task 2: saved state, authority and delivery

**Files:** create additive `*_manager_review_replies.sql` with the Supabase CLI; modify `test/helpers/coordinator-fixture.js`, existing database test migration loads, `supabase/README.md`; create `test/manager-review-database.test.js`.

**Interfaces:** `maintenance_requests.coordinator_review_status` nullable enum text (`awaiting_manager_response`, `awaiting_tenant_response`, `inspection_authorized`, `work_authorized`); `coordinator_manager_reply` nullable text. Existing `coordinator_context` and `coordinator_commit` signatures stay unchanged and expose/persist these fields.

- [x] Add failing real RPC/database tests for full accepted conversation, reloaded review state, exact outbox body, acknowledgements, new quotes, duplicate delivery, unnumbered ambiguity, wrong roles/account, forged payload, blocked scheduling and scope-specific approval.
- [x] Run `node --test test/manager-review-database.test.js`; expected missing review route/fields or incorrect notifications.
- [x] Implement the additive migration. Validate the manager command from `p_message`, select its verified recipient, save state and queue exact text in the same transaction. Block scheduling while review is pending; label inspection-only authority in maintenance notices. Explicitly marked form reviews use manager-only routing.
- [x] Load the migration in every real-database fixture. Run all database workflow tests, the complete bot suite/checks and Property HQ tests. Expected zero failures; commit both repositories.

## Task 3: full examples and independent review

**Files:** create `docs/MANAGER_REVIEW_RESULTS.md`; update this plan and the approved spec only for documented implementation decisions.

- [x] Replay the exact spigot request, manager's exact reply and affordability acknowledgement; inspect saved records and actual outbox payloads.
- [x] Verify normal faucet repair reaches maintenance, urgent gas report reaches the manager immediately, inspection approval does not grant installation authority, and approvals never create appointments by themselves.
- [x] Run full bot/app suites and syntax/diff checks; record measured results and limits. Request one independent read-only review of both repository diffs, as required by executing-plans.
- [x] Reproduce any important review finding before its fix, verify regression tests and full suites, then commit the finished change and report local completion. Keep production rollout pending.

## Release ordering

This builds on the previous tenant/maintenance handoff migration. Apply the additive manager-review migration before deploying its matching bot update. No migration or bot deployment is applied by this task.
