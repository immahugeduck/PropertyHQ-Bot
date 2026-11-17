# Request notes, next action and stalled-request reminders

The user requested clearer note keeping in Property HQ, a request-list indicator
of who needs to respond, and reminders when that response stalls. This extends
the already-approved request workflow using the existing Supabase records and
minute delivery worker. The successful tenant/maintenance flow stays in place.

## Approach and scope

Keep one saved workflow for the request. Add an append-only activity history and
derive the next actor from the existing review, entry and appointment records.
Use that same saved state to validate reminders immediately before delivery.
A separate reminder service would duplicate the scheduler and state. Asking the
model to guess the next actor on every timer tick would make routing less reliable.
This is the proposed implementation choice, based on the user's request for the
previously recommended waiting indicator and limited reminders.

Deliver in two steps within this upgrade: notes and next-action UI, then reminder
discovery/validation. Run fictional conversation/SQL examples between them.

## Request history

- Record meaningful applied bot actions as separate entries with time, author
  (tenant, maintenance, manager or bot), kind and original current-message text.
  Do not copy a conversation transcript or infer a diagnosis.
- Record management notes through a request-owned, authenticated RPC. Notes are
  internal and saving one never sends a text. New entries are appended rather than
  replacing a shared text field. Blank/oversized notes and cross-account access fail.
- Preserve the existing notes as earlier history. Keep new bot writes to that
  existing field for compatibility; the edit form must not overwrite it from a
  stale browser snapshot. Management uses the new add-note form for future notes.
- Duplicate inbound SIDs or repeated completed commands do not create duplicate
  entries. Inspection, approval and entry facts preserve their existing authority.

## Next action

The list gets a compact waiting badge. Request details show the actor, next action,
when waiting began, reminder status and a pause/resume control. Closed requests
have no pending actor. A future confirmed visit shows Scheduled and is not stalled.

Priority of derived state:

1. Completed/cancelled: closed, no reminders.
2. Manager review: manager response required. Manager has replied with an optional
   offer/quote: tenant may respond, but no automatic reminder to pursue that offer.
3. Future confirmed appointment: scheduled. Appointment has begun: maintenance
   progress/completion needed. The visit check-in remains separate and sends once.
4. Emergency without a confirmed visit: manager follow-up; existing immediate
   emergency escalation remains unchanged.
5. Current valid offered visit options: tenant selects/confirms, including attended
   options after entry was refused. Expired options move back to maintenance.
6. Entry not answered: tenant permission required. Entry refused: manager arranges
   attended access, without granting unattended entry.
7. Otherwise maintenance supplies/approves a visit time. Requests with no verified
   tenant/contact or no usable bot configuration require management attention.

The waiting token changes when this action changes or meaningful progress is
recorded. Status questions, thanks and private management notes do not postpone a
stalled request. Scheduled visit progress uses its actual start and latest real
progress; a timer never asserts work has begun or finished.

## Reminder policy

Builder defaults, offered to the user for correction: 24 elapsed hours before the
first reminder; configurable in Property HQ (1–168 hours). Deliver only on the
account's configured working days and between open/close times in its time zone.
At most two reminders per waiting cycle. The first is due at one configured
interval; the second waits at least another full interval after the first was
attempted and finished. Missed intervals never create a catch-up burst.
After the cap, the indicator remains visible; no repeated automatic texts.

- Address only the person whose action is needed. Staff reminders include the
  request number and concise next action; tenant reminders use the repair label.
  Manager-only notes never enter a tenant or maintenance reminder.
- Use the current verified contact/routing. Revocation, rerouting, completion,
  cancellation, rescheduling, changed waiting token and pausing invalidate queued
  reminders. Never bypass entry gating or manager review to send a work order.
- One durable outbox identity per request, waiting token and reminder number.
  Sent/sending/uncertain attempts are consumed and never automatically retried.
  Repeated worker ticks and concurrent inbound replies cannot duplicate delivery.
- Recheck state, routing, configured hours and due time at claim. Keep the existing
  account lock, outbox limit and visit-check-in behavior.
- Existing open requests begin their waiting interval at migration rollout, so
  deploying does not send a historical reminder backlog. No live simulation SMS.
- A global enabled switch and per-request pause allow waiting for a part or other
  known delay without nagging. Resuming begins a fresh waiting interval.
- Every manager SEND is conservatively optional until management enables the
  request's "Tenant response needed" control. This makes an expected answer
  explicit without guessing that a declined or conditional offer needs chasing.

## Storage and authority

Add request waiting actor/reason/since/token and pause fields, an internal activity
table, owner-scoped follow-up settings, and reminder identity columns on the
existing outbox. RLS permits only the owning management account to read activity
and settings. Private worker helpers are service-only with an empty search path;
the public note/settings/pause RPCs independently check the signed-in owner.
No tenant portal exposes internal activity. Existing privacy boundaries stay intact.

## Verification and release

Test real SQL plus the bot runtime using fictional contacts: entry, review,
optional quote, fresh/expired options, attended access, future/started visits,
meaningful progress vs questions, two requests at once, cross-account isolation,
note concurrency, closed requests, reminder caps, quiet hours/DST, revoked
contacts, stale queued reminders, uncertain delivery and duplicate worker ticks.
Verify UI formatting and note validation; inspect the list and detail screens in
the browser. Run both full suites, type/lint checks relevant to touched UI, and
fresh builds. Apply only the new migration, preserve the other thread's current
main commits, push both repositories to main and verify production readiness.

Other-thread baseline: bot d49850b, Property HQ c5fee3a. Preserve its completion
notes handling and model diagnostics; this upgrade does not change that grammar.
