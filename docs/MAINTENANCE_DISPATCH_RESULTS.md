# Maintenance dispatch and message attribution

The November 12 live hot-water example showed three full maintenance texts:
an initial TBD request, the same request with YES permission, and an internal
manager comment incorrectly described as a tenant preference. Scheduling still
selected the correct request and time; it did not correct the mistaken note.

## Resulting workflow

- Save the ordinary request and inform the manager. Ask the tenant once for
  unattended-entry permission if it is missing. Do not dispatch to maintenance
  while permission is unknown or refused. Emergency escalation stays immediate.
- A clear grant sends one compact maintenance request with the issue, location,
  access precautions and three earliest available recorded calendar openings.
  Consent in the first report can dispatch immediately.
- Tenant details received before permission are retained separately from private
  staff notes. Details received before delivery update the same queued work
  order. After delivery, material changes use a concise update, with unsent
  updates combined. Unchanged permission and status requests do not resend it.
- Revoking permission cancels an unsent initial work order. If maintenance
  already received it, a concise restriction update is queued immediately.
  The delivery worker also holds legacy queued first requests that lack
  permission; emergency alerts, attended bookings and safety updates still pass.
- Refused unattended entry stays with the manager for access coordination.
  The manager can offer attended visits; the tenant must confirm an exact time
  before maintenance receives the booking. This does not grant unattended entry.
- Manager comments remain raw-authored internal notes in both native routing
  and SQL, including if the model fabricates tenant wording. Maintenance context
  excludes those raw notes. Short staff acknowledgements stay quiet.
- New repair and manager-review reports cannot inherit model access instructions
  from an older job. Existing proposal versions remain valid when only a pet/access note
  changes; staff can still select `1`, `2` or `3` on the delivered request.

Example using fictional contact information:

> Tenant: My water is not getting hot at all.
>
> Bot: Thanks for letting me know, Bree. I’ve saved your request. Before I send it to maintenance, does maintenance have permission to enter if nobody’s home?
>
> Tenant: Yes. I should be home but you do have permission.
>
> Maintenance receives one request: New maintenance request #1001 from Bree Fixture at 508 Fixture St. Requesting maintenance repair for: No hot water in the home. You have permission to enter while nobody is home: YES. Potential schedule times: the next three recorded openings. Reply 1, 2 or 3, or send another exact visit time to book.

## Verification and release

New tests reproduced the reported failures before implementation. Focused real
SQL tests cover ordinary and portal intake, an initial explicit grant, details
before permission/delivery, combined later updates, unchanged consent and status,
revocation before/after dispatch, manager source attribution, emergency escalation,
and account/role isolation. Existing attended-visit and inspection tests exercise
manager coordination while the maintenance dispatch is held.

All contacts are fictional. PGlite executes the real migrations, and model
responses are controlled at the API boundary. Local tests establish persisted
workflow and actual queued bodies; live model variation and carrier delivery
are assessed through subsequent real use. No real SMS is sent by these tests.

One independent read-only review found four issues: keeping attended access
valid across late details, guarding new manager-review access notes, suppressing
repeated manager consent alerts, and gating previously queued work at delivery.
Each was reproduced locally before its fix. Regression tests also verify that
a later pet note cannot revive a revoked unattended-entry request. The review's
wording findings were corrected. Existing free-text tenant availability remains
for staff review; it does not invent new calendar openings.

Final verification: **349 bot tests passed, 28 Property HQ tests passed, bot
syntax checks and both repository diff checks passed.** No product findings
were deferred. The fixes were verified through the regressions and full suite
after the single independent review.

The additive database migration is
`20261112235510_maintenance_dispatch_gate.sql`; apply it before the matching bot
release. It adds bounded pending tenant repair details, a flag for a specifically
confirmed attended visit, and private dispatch logic while preserving prior
audit records and appointments. It does
not replay old outbox messages. Earlier results describing an initial TBD
maintenance text are superseded by this permission gate.
