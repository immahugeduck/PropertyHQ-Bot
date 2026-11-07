# Approved conversation walkthrough refinements

The user approved three simulated flows: washer leaking only while operating;
broken screen-door handle with a working main door; and disposal/slow kitchen
drain with an unconfirmed cabinet leak. Apply their feedback to the existing
opt-in coordinator, preserving authorization, atomic recording and safety checks.

- Use facts already in the message. Do not ask whether a leak stops when the
  tenant already said it only occurs while running. Do not add rhetorical remarks
  explaining that a scheduled visit is before the tenant's departure time.
- Record job-specific availability and permission to enter while absent. Explicit
  refusal replaces earlier consent; omitted fields preserve facts. Never copy
  permission from a different job or let a stale appointment confirmation restore
  revoked permission. Persist incoming deltas, not an old job snapshot.
- Refer a new request for inspection/scheduling immediately. A main-door security
  question may accompany a screen-door report, but referral does not wait for it.
- A tenant who is away can update the team when somebody returns. Do not require
  tenant diagnosis, photos or confirmation of a leak before arranging inspection.
  Ask entry permission if absent when appropriate; staff supplies availability.
- Queue initial maintenance referral before the tenant acknowledgement in the
  same transaction. Actual carrier delivery remains asynchronous and must not be
  described as already completed. Include issue, property/contact, availability,
  entry permission and an explicit request for visit options in staff referral.
- Late tenant details go to maintenance and manager; a leak only while used does
  not cancel an existing inspection. Preserve current visit and permission in
  staff summaries and in the recorded notification body.
- Accept one specific staff visit or up to three options. Keep broad availability
  as broad, requiring an exact tenant-selected time within the offered hours.
  Staff still reviews interpreted options and tenant still confirms displayed date.

Implementation decisions: reserve an hour internally for exact point appointments
and for selected times within broad availability (capped by its end), without
promising repair duration. Business hours bound broad phrases such as anytime;
missing hours/date require clarification. Distinguish tenant-reported leak facts
from a technician's confirmed findings. Schema is an additive follow-up migration,
never a live database operation during this task.

Validation: 13 focused example/regression tests, existing bot suite, service/RPC
walkthrough and actual migration execution in disposable PGlite. The latter checks
fact persistence, staff notification contents, broad-window selection and current
consent across two verified contacts. OpenAI responses are fixtures, not a live
model evaluation. A real messaging pilot still needs separate rollout authorization.
