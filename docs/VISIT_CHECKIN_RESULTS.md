# Visit-time check-ins and completion updates

The user requested an automatic maintenance text at the saved appointment time
for request #1013, then a tenant update after maintenance reports completion.
Its saved appointment remains Friday November 13, 2026, 10 AM in
America/Indiana/Indianapolis (`2026-11-13T15:00:00Z`).

The existing authenticated notification runner is enabled and successfully
calling the delivery worker every minute. The upgrade reuses that runner;
no extra scheduler, recurring agent run or new messaging provider is needed.

## Workflow

- At a confirmed visit time, maintenance receives one brief request-linked
  check-in with the tenant/property, short repair summary and current access
  precautions. It prompts `Reply DONE 1013 when finished, or send a progress update.`
- The next minute tick creates and claims the message. A fifteen-minute recovery
  window tolerates a short scheduling interruption; older appointments do not
  produce a historical backlog. Provider delivery time can vary.
- Native staff parsing accepts `DONE 1013`, `1013 done` and a focused `Done` or
  `Finished` reply. Unknown numbers and ambiguous requests require clarification.
  A verified completion marks that repair complete and queues the friendly tenant
  completion notice. Repeated completion with a new inbound SID does not repeat it.
- `Not finished yet. I need a replacement part.` stays a progress update. A timer
  never claims that someone arrived, began work or finished a repair.
- Inspection-only completion returns to manager review. It does not claim that
  optional installation or work has been authorized or completed.

The SQL outbox binds the check-in to its exact scheduled instant. Before delivery,
the worker checks the current booking, request status, access, review scope and
routing again. Obsolete queued check-ins are cancelled. An already sent or
uncertain delivery is never automatically resent. A tenant-agreed attended visit
remains eligible without acquiring unattended-entry permission.

## Verification and release

Local examples execute the real migrations, RPCs, context reloads and queued SMS
bodies with fictional contacts. They cover no early/stale reminders, minute-worker
integration, one message per visit, rescheduling, cancellation, revoked access,
attended access, staff completion, duplicate completion, parts updates, inspection
scope, account isolation and private function permissions.

The additive migration is `20261113032510_visit_status_checkins.sql`. Apply it
before the matching native status parser release. Existing scheduler settings and
Twilio credentials stay in place. No immediate production reminder is sent to
simulate #1013; the real scheduled visit is the user's next live test.


One fresh read-only review identified three Important issues. They were reproduced
before fixes: cancelled/deleted prompt binding, private progress being forwarded,
and recipient changes bypassing per-visit deduplication. The fixes retain prompt
binding even after SMS foreign keys are cleared, recognize private staff notes
before progress shortcuts, and enforce request/time uniqueness with a database
index. Safe queued rerouting updates the saved conversation destination too.
All 42 focused examples passed after the fix pass. No product findings were deferred.

Carrier delivery at the future visit time remains the user's live test. New
completion paths are deterministic; general model interpretation remains an
external dependency. Production load testing was outside this targeted workflow
change; account locks and the unique index enforce the observed queue contracts.

Final release verification: **391 bot tests and 28 Property HQ tests passed; bot syntax and both diff checks passed.** The three review findings were fixed and verified through regressions and the full suite after a single independent review.
