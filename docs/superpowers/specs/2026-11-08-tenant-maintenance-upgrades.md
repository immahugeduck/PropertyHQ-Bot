# Tenant capture and maintenance communication

The user authorized two or three upgrades based on BREE's exchange and earlier walkthroughs, with example tests between upgrades. Use three independently testable upgrades: reliable capture, simple staff handoff, then complete scheduling and follow-up verification. Native execution follows that authorization; no production deployment is part of this work.

## Goal and approach

Make a tenant's clear answer become the saved job fact that every subsequent reply uses. Keep maintenance communication practical: repair, property, urgency, entry permission, availability, and the next scheduling action. Send conversational context to the manager and retain the full history in Property HQ.

Continue using Property HQ to create and number tickets. Keep the existing coordinator, transactional commit, delivery outbox, identity checks, calendar conflict checks, and permission-led scheduling. Prompt-only changes would leave the deterministic permission defect and database-generated messages intact. Rebuilding the workflow would add scope without addressing the demonstrated failures more directly. The authorized incremental approach builds on the existing examples and implementation.

## Upgrade 1: reliable capture

- Recognize BREE's exact `Yes permission granted.` after an unattended-entry question, including ordinary punctuation/case variants and `Permission granted.`.
- Bind short answers to the job in the question. Never transfer permission to another repair, tenant, completed job, or a different kind of question.
- Keep refusals and restrictions ahead of positive wording. A conditional answer must never become unrestricted permission. Preserve the original wording in history.
- Acknowledge the saved permission once, then move toward scheduling. Do not repeat the entry question once answered or repeat appliance precautions on every permission-only follow-up.
- Verify original text through interpretation and decision, then save and reload the real database fixture. Do not insert the expected permission value directly into the test.

Example: washer report → absent-entry question → `Yes permission granted.` → `Thanks, I've recorded your permission to enter while nobody is home. I'll coordinate the visit with maintenance.` One ticket; saved permission true; no second question.

## Upgrade 2: separate staff communication

- Maintenance receives one work order, with one job reference, issue/location, urgency, current permission and availability, any relevant repair update, and the scheduling next step. No copied tenant permission answers or appended conversation summary.
- The manager receives the report/update context and the saved job summary. The manager also receives the initial request; maintenance retains the actionable handoff.
- Generate both recipients' permission statements after saving facts, inside the existing transaction.
- An ambiguous entry clarification is logged for the manager; it must not generate another maintenance scheduling alert. Repeated unchanged permission must not produce another maintenance alert or refresh an otherwise current proposal.
- Keep the proposed visit and its version attached to the exact maintenance message for natural `Yes` approval. Form-created requests use the same handoff format.
- New emergency reports keep immediate manager routing and safety instructions; do not introduce normal scheduling into emergencies.

Example maintenance message:

> #1009 — 508 Wisconsin St
> Repair: Washer in the basement won't turn on
> Urgency: routine
> Permission to enter while nobody is home: granted.
> [Existing private visit suggestion and staff approval question.]

Later changes carry their relevant facts; a revocation must reach maintenance even after booking. Do not infer unrestricted access from availability.

## Upgrade 3: scheduling and follow-up

- Preserve the existing rule: with unattended entry granted, maintenance approves one exact visit and the tenant receives the confirmed time; without it, staff approves three options and the tenant selects and agrees to a time. Permission alone never books a visit.
- Save new availability and explicit permission facts supplied when asking for alternative times. Clear the old pending tenant selection and invalidate old offered options through the existing database action.
- Replay washer, sink/disposal and screen/window examples through persistence, staff approval, tenant notifications, rescheduling, status, completion, duplicate inbound delivery, and unavailable slots.
- Tests use fixture contacts and an in-memory Postgres database. They must not send real SMS, modify BREE's ticket, or replay live alerts.

## Passing each upgrade

Run its focused examples first, inspect the saved job and actual outbox bodies, then run the bot suite. Run the Property HQ suite for database handoff changes. Record results between upgrades and do not claim deployment. Keep permission, identity isolation, emergency behavior, retry idempotency, and calendar conflicts covered throughout.

## Implementation decisions

Keep the current JavaScript modules and SQL RPC boundaries. Use an additive migration for changed database functions and revoke access to new internal helpers from public, anon and authenticated. Reuse the existing permission-led scheduling design rather than changing scheduling authority. Handle third-party AI and delivery calls with boundary fixtures; exercise actual parsing, decisions and SQL locally. Investigate the missing final `Yes` as a separate delivery issue only if new evidence identifies its cause; do not claim this work repairs carrier delivery.
