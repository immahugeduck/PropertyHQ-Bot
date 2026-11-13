# Property HQ agent architecture

Property HQ coordinates maintenance through a bounded agent turn for each SMS.
It combines natural language interpretation, persistent job context, application
policy and transactional actions. Twilio carries messages, Supabase stores the
shared record, and Vercel runs the webhooks and delivery worker.

This structure follows the Vercel build-agents guidance for an established stack.
The agent proposes structured actions through its contract. The coordinator and
database validate those actions before they change a job or queue a notification.

## Files and responsibilities

| Component | Implementation | Responsibility |
| --- | --- | --- |
| Channel adapter | `api/twilio/sms.js` | Verify signatures, handle messaging keywords and return TwiML |
| SMS service | `src/conversation-service.js` | Route existing callers to the agent runtime |
| Agent turn | `src/agent/runtime.js` | Load context, evaluate safety, interpret, decide and commit within the webhook budget |
| Instructions | `src/agent/instructions.js` | Versioned guidance for context and interpreting messages |
| Model contract | `src/agent/contract.js` | Strict JSON schema for proposed intents and fields |
| Interpreter | `src/assistant.js` | Resolve clear commands and permission answers, then use the model when needed |
| Policy | `src/coordinator.js`, `src/staff-scheduling.js`, `src/manager-review.js` | Check authority, identity, entry permission, review scope and scheduling state |
| Memory and actions | `src/conversation-store.js` and PropertyHQ SQL migrations | Load scoped records and commit actions, state and notification entries atomically |
| Delivery | `api/coordinator/deliver.js`, `src/notifications.js` | Claim queued messages, send through Twilio and record the outcome |
| Evaluations | `test/helpers/coordinator-fixture.js` and workflow tests | Replay conversations through the actual runtime and SQL with fictional contacts |

## A turn through the agent

1. The channel adapter verifies the Twilio request. Identity comes from saved
   account routing, verified contact bindings and tenant records.
2. The runtime loads the sender's job context and recent messages from Supabase.
   Each invocation reloads memory so state survives restarts and deploys.
3. Safety rules run before model interpretation. A manager's explicit `SEND`
   command is handled as a message to relay under the existing manager policy.
4. The interpreter handles clear staff commands and entry replies directly. For
   other wording, the model returns one structured intent against scoped records.
   It receives account time, job facts and relevant recent messages.
5. Application policy resolves the job and action. Ambiguity produces a focused
   clarification. Staff authority, permission and review scope are checked.
6. `coordinator_commit` serializes account changes, checks conversation and proposal
   versions, enforces calendar conflicts and stores the decision and outbox entries.
   Duplicate inbound message IDs produce no repeated action.
7. The reply returns after the commit. The delivery worker handles queued messages
   separately and records sent or uncertain outcomes. A queued notification and
   provider acceptance are separate results.

## Action families

| Family | Behavior and authority |
| --- | --- |
| Intake and follow-up | Verified tenant reports attach to the correct tenant and job. Unknown contacts require identity confirmation. |
| Entry and access | Tenant permission is job specific. Pet precautions and restrictions stay attached to that repair. Staff cannot grant permission on a tenant's behalf. |
| Scheduling | Staff approves the actual visit or options. Tenant selection is tied to the current proposal version. The database enforces conflicts and permission at commit. |
| Manager review | Optional additions and property decisions wait for manager review. Inspection and work approvals carry distinct scopes. Explicit outward replies preserve their author and wording. |
| Progress and completion | Verified staff updates the job. Completion queues tenant and manager updates. Inspection completion returns to review. |
| Visit check-ins | The minute worker queues one maintenance check-in near the confirmed appointment, revalidating booking and access before delivery. Staff reports establish completion. |

## Scheduling and staff messages

The current dispatch gate holds routine maintenance requests until entry is
settled. Emergency escalation remains immediate. If unattended entry is refused,
management coordinates an attended visit. A confirmed attended appointment has
its own access flag and does not grant unattended entry.

For permitted entry, the recorded calendar can supply candidate openings to staff.
Maintenance chooses one or sends an exact visit time. That instruction books one
visit and queues the tenant confirmation. A vague approval of three candidate
openings asks staff which one to book.

For an attended visit, staff approves three options before the bot sends them to
the tenant. The current general tenant flow selects an option and confirms the
exact time before booking. Confirmation updates maintenance and management.

Maintenance receives the concise work order, access precautions and next action.
Additional tenant context and private manager notes have separate storage and
routing. Pending work orders coalesce before delivery. Replies stay bound to
their request even when several requests are open.

## Verification before the next live scenario

Run `npm test` from PropertyHQ-Bot with the sibling PropertyHQ checkout available.
The fixtures execute real SQL migrations and the request path. They control the
external model response to test application behavior and send no carrier SMS.

`test/photo-scheduling-replay.test.js` checks an ambiguous daypart, the correction
`Schedule for 2pm today`, polite approval and a pending staff-only calendar entry.
Full workflow tests cover identity, mixed replies, permission changes, review,
attended scheduling, delivery, progress and completion.

The next chat walkthrough should cover a permitted-entry repair through completion,
then an attended repair with three approved options. Compare the replies and
actions at each turn. General model interpretation and carrier delivery require
the subsequent controlled live scenario.

Voice, the legacy fallback SMS path, AgentPhone and Inkbox retain their existing
handlers. This runtime serves the coordinator-enabled Twilio SMS path.
