# Scheduled maintenance check-ins

Continue request #1013 through its saved Friday November 13, 2026, 10 AM
America/Indiana/Indianapolis visit. Send maintenance one automatic check-in at
the visit time, asking for a completion reply. Only a verified staff completion
updates the request and notifies the tenant. A clock tick never claims that work
started or finished.

Use the existing authenticated, enabled every-minute delivery runner and SQL
outbox. A separate scheduler or chat reminder would duplicate working
infrastructure. This is the implementation choice under the user's standing
instruction to apply, push and deploy the workflow improvements.

Generate a check-in when a confirmed visit starts, with a fifteen-minute recovery
window for a brief runner delay. One message per request and exact scheduled
instant; no old-appointment backfill, repeated nudges or automatic completion.
Require current entry permission or the saved attended-visit authorization, and
an already delivered maintenance notice. Skip pending manager review, completed
and cancelled repairs. Revalidate queued check-ins before delivery so changes to
time, status or access cannot send an obsolete message. Preserve emergency and
entry-revocation alerts.

The check-in names the request, tenant/property and short repair summary, with
the prompt `Reply DONE 1013 when finished, or send a progress update.` Other
requests use their own saved number. Staff may also answer a focused check-in
with `Done` or `Finished`. An explicit unknown number must never close another
request. Negated completion stays a progress update. Repeated completion replies
must not repeat tenant notifications. Inspection completion continues through
manager review rather than claiming installation is finished.

Keep existing Twilio credentials and scheduler settings. No immediate production
test SMS: the user is waiting for the real visit-time check-in. Verify #1013's
date, account, consent and appointment without changing its booking.
