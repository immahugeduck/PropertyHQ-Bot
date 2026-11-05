# Agent HQ conversation guide

Agent HQ helps tenants and maintenance staff keep repairs and appointments
organized for First Call Maintenance. He is calm, kind, direct, and honest about
what has been saved or sent. This guide describes the intended conversation and
the current deterministic implementation; it is not an LLM system prompt.

## Voice and tone

Introduce yourself as “Agent HQ with First Call Maintenance.” Use everyday words,
short sentences, and one useful next step. Acknowledge the person’s concern
without repeating a long intake checklist. Use a tenant’s name when already known.
Give the request number so the person can refer back to it. Never invent an
arrival time, a diagnosis, a successful notification, or a reminder subscription.

## Maintenance flow

1. Check the new message for urgent hazards before handling scheduling or small talk.
2. Use the matched tenant and property context instead of asking again for known details.
3. File the issue, or attach a follow-up to the recent open request. Existing
   follow-up matching uses the latest SMS/voice request opened within 24 hours;
   it cannot reliably distinguish multiple repairs in a free-form conversation.
4. Give the relevant safety guidance. Ask for the missing location, symptoms,
   or photo when needed. Do not tell someone to approach unsafe equipment.
5. Confirm the saved request number. Say a notification succeeded only when its
   send result supports that claim. If a service fails, keep the safety guidance.

“Hello” → “Hi, I’m Agent HQ with First Call Maintenance. What can I help you
with today—a repair or an existing appointment?”

“The kitchen faucet is dripping” → prioritize the water issue, ask where it is
and whether it is getting worse, and provide the request number after filing.

“When will you come? I smell gas” → give gas safety guidance immediately; the
scheduling question must not hide the emergency.

## Schedule flow and examples

Staff messages are recognized only from configured maintenance/manager numbers.
Tenant availability is not authority to confirm an appointment.

| Message | Agent HQ behavior |
| --- | --- |
| `1003 tomorrow 2pm` | Save the appointment and confirm the resolved date/time; report tenant notification outcome. |
| `When is job 1003 scheduled?` | Read the saved appointment and status without changing the job or sending another tenant message. |
| `remind me about job 1003` | Recall now; do not claim a future reminder was created. |
| `1003 maybe tomorrow 2pm` | Ask for a confirmed day and time; leave the saved appointment unchanged. |
| `1003 tomorrow afternoon` | Ask for a specific confirmed time. |
| `1003 not done` | Do not mark the job completed. |
| Tenant: `When is my appointment?` | Read only that matched tenant’s open requests, including appointments older than the 24-hour intake window. |
| Tenant with no saved time | “Request #1003 has no confirmed appointment saved yet.” |

Times use `triage_settings.timezone` (default America/Indiana/Indianapolis).
Bare hours follow the existing working-hours convention: 7–11 morning,
12–6 afternoon. A time without a date that has passed means tomorrow. A weekday
name means its next occurrence. Confirm the interpreted date/time in the reply.
Invalid calendar dates and explicitly past times are not saved.

## Memory boundaries and next steps

The durable memory is the existing Property HQ request and message history.
Appointment recall reads the database each time; it does not depend on an
in-process cache. Staff updates replace the request’s current appointment; the
inbound/outbound message log preserves the conversation history.

This implementation supports job-linked appointments. General personal tasks,
recurring schedules, proactive reminders, conflict detection, and cancellation
need dedicated storage/workflows and are not enabled here. Do not imply that
saving an appointment schedules a future outbound message.

The runtime remains deterministic and does not understand every phrasing. When
context is unclear, use the job number and an explicit day/time. The existing
staff relay can still route unstructured messages to the most recent tenant;
prefer explicit job numbers when several conversations are active.
