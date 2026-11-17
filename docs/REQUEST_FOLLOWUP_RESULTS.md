# Request notes, next action and stalled follow-ups

This update adds an internal, dated activity history to Property HQ maintenance
requests. Each applied bot action preserves the author and current message; manual
management notes append through an owner-checked RPC and never send a text.
Earlier notes remain available. Editing request details omits the old shared notes
field, preserving notes added while the form was open.

The request list and details show who needs to act next and why. The same saved
waiting token controls follow-ups, so a permission answer, changed visit, completed
request or new manager decision invalidates the old queued reminder. Questions,
thanks and internal notes do not reset a pending response's clock.

Default reminder interval: **24 hours**, adjustable from 1 to 168 in
Settings → Maintenance follow-ups. Use the existing account's working days,
opening/closing hours and time zone. A request can pause/resume reminders. A
second reminder waits a full interval after the first attempt has finished;
there are at most two per pending action, including after a long weekend.

Manager SEND replies are optional by default. In the request details, management
can mark **Tenant response needed** for an answer that requires follow-up. Optional
quotes and declined installations are not automatically chased. Confirmed future
visits use the existing visit check-in; stalled completion updates become eligible
only after the visit begins and the waiting interval expires.

The additive migration is `20261116233357_request_notes_followups.sql`. Apply it
before the UI release. Existing requests start their interval at rollout: no old
reminder backlog is sent. The same authenticated minute worker discovers and
validates these messages. Internal helpers remain service-only; activity is
management-only and account-scoped. No extra messaging provider or scheduler.

Fictional real-SQL/runtime examples cover author attribution, internal notes,
owner/RLS checks, repeated SIDs, separate requests, optional offers, attended access,
progress vs status questions, thresholds, quiet hours, caps, invalidation, paused
requests, changed contacts, uncertainty and the existing claim worker. The first
full run passed **508 bot tests and 30 Property HQ tests**, before the final review.
TypeScript and touched-file lint passed. The actual components were rendered in
headless Chromium at desktop and mobile widths; note saving, pause/settings
controls and preservation of notes on edit were exercised with intercepted
fictional service requests. No live test SMS was sent.

Other-thread completion notes and model diagnostics are preserved. The published
baseline for this change is bot `d49850b` and Property HQ `c5fee3a`.

One fresh independent review found three Important issues: a draft typed while
saving could be cleared, an emergency booked directly in Property HQ could still
look stalled, and initial dashboard notes lacked activity metadata. Each was
reproduced before its fix. The delayed-save Chromium example now preserves the
new draft; initial notes record the authenticated manager and time; saved future
emergency visits stay quiet. No review findings were deferred.

Final verification: **513 bot tests and 31 Property HQ tests passed**, including
the new notes/reminder examples and ownership checks. Bot syntax, touched-file
lint, TypeScript and the local production webpack build passed. The local default
Turbopack build cannot follow this worktree's shared node_modules symlink; the
normal Git deployment uses its own installed dependencies. Current requests keep
their existing statuses and begin a fresh waiting interval at rollout.

Production applied the source migration as
`20261117022605_request_notes_followups` on November 17. The owner-scoped tables
have RLS enabled, internal worker helpers remain service-only, and management
RPCs enforce signed-in ownership. Verification found no historical reminder
backlog queued and preserved the existing request statuses.

Release completed November 17: both repositories were pushed to `main`; the
functional bot release `289defb` and Property HQ release `98c37f2` reached READY
and their public health/page checks returned HTTP 200. Deployment-scoped
error/fatal scans were clean. The existing minute runner remained enabled and
reported a successful run at 02:33 UTC after the migration. Subsequent completion
documentation does not change the tested runtime. Ready for the next controlled
live tenant/maintenance walkthrough.
