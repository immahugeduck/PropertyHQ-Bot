# Manager-review upgrade results

Approved plan: [Manager-review implementation](superpowers/plans/2026-11-11-manager-review.md).
Base revisions: bot `7c8e373`, Property HQ `68546de`. Work remains on the existing
isolated `feat/tenant-maintenance-upgrades` branches. Production rollout is pending.

## What changed

Clear optional-addition requests go directly to the manager before asking the
tenant about access or visits. The request saves its review status and the exact
outward manager reply. Maintenance stays out of the exchange until the manager
separately approves inspection or work.

- `SEND #1001: <message>` forwards the exact body to that request's verified
  tenant. An unnumbered command requires exactly one open request.
- Other manager review comments stay internal. Quotes and substantive tenant
  follow-ups return to the manager; acknowledgements remain quiet.
- `APPROVE INSPECTION #1001` authorizes only an inspection. `APPROVE WORK #1001`
  authorizes work. Neither command books an appointment by itself.
- Inspection completion sends the findings back to the manager for a work
  decision; it does not complete the installation.

## Recorded spigot exchange

The local replay used the user's exact wording, fictional contacts, real bot
decisions, real database functions, saved records and the delivery outbox.

Tenant:

> Hello is there anyway I could get a garden Spigot out here? I'm trying to wash my car and I realized I don't have a Spigot and j don't ha E a long enough hose to hook it up to my sink

Bot:

> Thanks! I’ll pass your request to your property manager for review and get back to you.

The manager received the request, tenant and property, and “How would you like me
to respond?” with the `SEND #1001:` instructions. Maintenance received no alert.

The manager's accepted `SEND:` text was queued to the tenant exactly:

> I see that is a big pain but unfortunately we will not be able to install a Spigot at this time. Since it is not affecting your day to day stay we are going to leave things how they are. If it is something that you would like to have and you would pay for, submit a quote and we will approve by accepting a check and maintenance will install for you or contact the issuer of the quote and send them my number to schedule an install. Thanks. Let me know if you need anything else.

Tenant:

> Okay i understand i will let you know if it is something we can afford

Bot:

> You’re welcome. If you decide to move forward, send the quote here and I’ll pass it along to your property manager for review.

Saved outcome: **one request, `awaiting_tenant_response`, zero appointments**.
Outbox counts for the three steps: **1 manager alert, 1 exact tenant message,
0 acknowledgement alerts**. The conditional wording did not authorize installation.

## Test checkpoints

| Checkpoint | Evidence |
| --- | --- |
| Baseline | 252 bot tests and 28 Property HQ tests passed. |
| Bot decisions | The initial missing manager-review path failed before implementation; focused command, authority and acknowledgement tests then passed. |
| Database integration | Missing fields/actions, a number quoted inside `SEND`, and follow-up behavior were reproduced before fixes. The first full suite passed 283 bot tests and 28 app tests. |
| Additional boundaries | Seven edge failures were reproduced: mixed review/repair ambiguity, a direct SQL role bypass under malformed staff routing, an emergency form review marker, a water-supply repair misclassification and two common acknowledgements. All 40 focused tests then passed. |

The fixtures also cover exact multiline replies, the SMS length limit, empty
messages, duplicate carrier event IDs, wrong staff roles, forged wording,
cross-account records, revoked tenant contacts, private helper permissions,
blocked booking/work during review, new quotes and inspection completion.

An ordinary broken kitchen faucet generated the existing manager update and
maintenance work order. “I smell gas in the kitchen” generated safety guidance
and an immediate emergency manager alert. The prior BREE entry-permission and
scheduling regression cases remain in the full suite.

## Implementation decisions

1. Inspection completion returns to manager review. A manager must separately
   approve resulting work; treating it as installation completion would hide
   unfinished work.
2. A verified manager's explicit `SEND` body is outward wording, including quoted
   hazards. Unframed hazard reports still use emergency handling. A manager must
   report a new emergency separately from text being relayed.
3. Exact SMS bodies are limited to 1,600 Unicode characters and rejected above
   that limit. The manager must shorten or explicitly split an overlong reply.
4. Completing an inspection clears a used entry grant while preserving an entry
   refusal. Later work may require a fresh access answer.

## Verification limits and rollout

No live messages, production data changes or deployments were performed.
External AI interpretation uses controlled response fixtures where needed;
deterministic parsing, role checks, coordination, commits, reloads and queued
message bodies run as real code. These tests establish local workflow behavior,
not live model accuracy or carrier delivery. Unmarked portal form descriptions
retain existing behavior; automatic portal classification and UI changes are
outside this focused upgrade. Second Brain remains excluded.

Apply the additive manager-review migration before deploying its matching bot
update. Final independent review and verification are recorded below after review.
