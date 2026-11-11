# Entry cues, compact maintenance notices and request continuity

The user requested these changes from the November 11 tenant/maintenance
screenshots and explicitly authorized pushing the earlier and current upgrades.
Today's saved Property HQ messages and coordinator decisions confirmed the two
reported failures: the pet precaution prevented a permission grant, and an
unnumbered scheduling reply selected a completed older request.

## Resulting behavior

- A clear answer such as `Yes that's fine. Just watch out for my cat. He can be
  sneaky` saves unattended-entry permission and the cat precaution on the same
  request. It does not ask for verification. Refusals and instructions such as
  `call me first` or `only after 5 PM` retain their restrictions.
- Initial reports and relevant follow-ups save a short factual `repairSummary`
  and `accessNotes`. Maintenance receives these saved facts rather than the
  tenant's full message or conversation. The manager retains the context.
- Ordinary requests show the earliest three free slots in the recorded
  maintenance calendar, including when permission is TBD. These are private
  tentative suggestions; permission or presence coordination still gates booking.
- Maintenance can select a displayed slot with `1`, `2` or `3`, or explicitly
  book an exact visit such as `Schedule for to morrow morning st 9 am`.
  A vague yes does not select among three possible visits.
- The latest delivered open request provides durable staff focus beyond the
  twelve-message context window. Explicit job numbers, names and issue references
  can select another request. Closed records cannot supply stale scheduling focus.
- Staff scheduling reviews save their verified request ID in SMS history even
  when no data-changing action occurs. Their next answer stays attached to that
  review. SQL validates the request's account/tenant scope.

## Maintenance message example

Fictional contact and property, using the tested electrical-report example:

> New maintenance request #1001 from Bree Fixture at 508 Fixture St.
> Requesting maintenance repair for: Kitchen outlets and dishwasher lose power while charging a Tesla through an indoor extension cord and adapter.
> You have permission to enter while nobody is home: YES.
> Access note: Just watch out for my cat. He can be sneaky
> Potential schedule times based on your schedule: 1) Thu Nov 12 2026 09:00 AM; 2) Thu Nov 12 2026 10:00 AM; 3) Thu Nov 12 2026 11:00 AM (America/Indiana/Indianapolis). Reply 1, 2 or 3, or send another exact visit time to book.

Permission is shown as `TBD` when missing and `NO` when refused. Existing manager
review/inspection scope, explicit tenant availability and priority information
remain visible when relevant. No slot is invented when the calendar is full.

## Verification

- The new example tests first failed in 12 of 13 cases, then passed all 13 after
  implementation. They exercise raw text, real coordinator decisions, real SQL
  commits/reloads, actual queued message bodies, private slots and selected visits.
- The durable-focus example inserts an old completed request, stale staff state
  and fourteen later messages. The exact misspelled scheduling command still
  schedules the current electrical request and leaves the completed request alone.
- The full suite caught unbound manual review replies, a nullable helper edge and
  interference with manual scheduling confirmation. These were fixed and verified
  through the existing ordinary-repair and manager-review examples.
- Final pre-review verification: **315 bot tests passed; 28 Property HQ tests
  passed; bot syntax and both diff checks passed.**

One independent read-only review identified five Important findings. All were
reproduced before fixes: restrictive pet instructions, private-event time replies,
weekday/daypart handling, completion of a closed request, and preservation of
earlier access instructions. The fix pass preserves restrictions, keeps a pending
private event separate from tenant visits, respects explicit `this` weekdays,
asks about contradictory dayparts, retains the addressed completion target and
merges independent access instructions. A short-time follow-up regression also
guards against restoring a stale scheduling target.

Final release verification: **327 bot tests passed; 28 Property HQ tests passed;
bot syntax and both diff checks passed.** No product findings were deferred.
Live carrier delivery was outside the read-only review; an explicit staff visit
may reasonably differ from suggested business-hour slots. Ambiguous `next`
weekday wording retains existing interpretation; the explicit `this` case is
covered. The fixes were verified by regressions and the full suite without a
second reviewer pass.

Fixtures use fictional contacts and an in-memory Postgres database. External model
responses are controlled at the API boundary; live model variation and carrier
delivery are not established by these local checks. No real SMS conversation is
replayed by the tests or migrations. Credentials remain unchanged.

## Release

Apply the three additive migrations in order before the matching bot release:

1. `20261108181500_tenant_maintenance_handoff.sql`
2. `20261111003933_manager_review_replies.sql`
3. `20261111214912_context_followup.sql`

These change the saved workflow and future message generation. They do not replay
previous outbox messages, book an old scheduling instruction, or retrospectively
grant access on an existing tenant request. Both repositories are released from
the tested branches to their existing production `main` branches.
