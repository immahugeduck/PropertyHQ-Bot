# Manager review and exact tenant replies

The user approved this focused update after the outdoor-spigot walkthrough. The agreed approach is to send requests for additions or management decisions straight to the manager, ask how to respond, and forward only the manager's explicit `SEND:` wording. Native execution and local tests are authorized. Second Brain remains excluded; production rollout is pending.

## Behavior

1. A verified tenant's clear request for a new addition creates one Property HQ request with `coordinator_review_status=awaiting_manager_response`. Acknowledge manager review without asking location, entry permission, or scheduling a visit first. Send the manager the tenant, property and original request plus a request for tenant-facing wording. Maintenance receives no alert.
2. A verified manager can reply `SEND: <message>` when the request is unambiguous, or `SEND #1001: <message>` when several requests are pending. Remove the command and one optional separating space/tab; preserve all remaining text, punctuation, capitalization, line breaks and trailing text. Empty replies and SMS bodies over 1,600 characters are rejected rather than truncated. Never infer an action, approval or date from the message body.
3. Save the exact tenant-facing reply on the request and queue it for its verified tenant. Move blocked review requests to `awaiting_tenant_response`. All other manager comments about a pending review remain internal and receive a reminder to use `SEND:` for outward wording.
4. Tenant acknowledgements, including the user's exact affordability response, are saved on the same request, receive a brief acknowledgement and generate no staff alert. If the manager's saved reply requested a quote, the acknowledgement may mention sending the quote for review. A new substantive update/quote goes back to the manager and restores `awaiting_manager_response`.
5. Conditional offers in `SEND:` never authorize maintenance. Separate explicit manager commands `APPROVE INSPECTION [#1001]` or `APPROVE WORK [#1001]` release the request to the existing scheduling flow. Approval alone never books a time or changes tenant entry permission. Inspection approval is visibly limited to inspection in maintenance work orders. Completing that inspection returns the request and findings to manager review; it does not complete an installation. A grant used for the completed inspection is cleared before later installation access is requested; an explicit refusal remains in force.
6. Pending manager review blocks maintenance suggestions, booking, work-start/completion actions and portal scheduling/status changes; intentional cancellation remains available. Inspection completion through either the bot or existing portal returns findings to manager review. Tenant access updates remain saved while scheduling is blocked. Review handling must respect another request's current question and ordinary manager updates. Request status describes the saved review state rather than promising maintenance will provide times.
7. Ordinary broken-fixture requests retain the existing maintenance flow. Inbound emergency guidance and routing always take precedence over request classification. A verified manager’s explicit SEND body is outward text, so references to hazards inside it are relayed rather than treated as a new emergency.

## Boundaries

- Keep verified identities, account/tenant isolation, transactional commits, retry deduplication and delivery outbox semantics. Only the configured manager can send manager replies or authorize a reviewed request. Maintenance and tenants cannot impersonate the manager.
- Derive exact reply text and approval scope from the original inbound command again in SQL; model output cannot forge either. Require the header's request number to agree with the selected database record.
- An unnumbered command with multiple open requests asks which request, including a mix of reviews and ordinary repairs; it must not guess the latest tenant. Numbers inside a `SEND:` body never select its recipient.
- Store review state and the last outward manager reply as request fields. Include the saved reply in model context only for the tenant's active/requested job, preserving the existing limited conversation context.
- Classification uses narrow deterministic recognition for clear addition requests such as the exact spigot example, plus the existing structured AI interpreter for wider management decisions. Existing repair symptoms and hazards must not be reclassified as optional upgrades.
- Form requests explicitly marked for manager review use the same routing. Automatic classification of unmarked portal form descriptions is outside this SMS-bot change; no portal UI changes are included.
- Tests use fictional contacts and an in-memory database; no live messages, live data edits or deployment. External AI extraction remains a controlled boundary fixture where needed.

## Approaches

The user selected exact manager wording instead of model paraphrasing. The existing progress-update route adds wrappers and cannot provide that guarantee. A dedicated deterministic command with saved review state fits the existing coordinator and outbox. General agent memory or a new agent framework is unnecessary.

## Accepted example

Tenant: `Hello is there anyway I could get a garden Spigot out here? I'm trying to wash my car and I realized I don't have a Spigot and j don't ha E a long enough hose to hook it up to my sink`

Manager: `SEND: I see that is a big pain but unfortunately we will not be able to install a Spigot at this time. Since it is not affecting your day to day stay we are going to leave things how they are. If it is something that you would like to have and you would pay for, submit a quote and we will approve by accepting a check and maintenance will install for you or contact the issuer of the quote and send them my number to schedule an install. Thanks. Let me know if you need anything else.`

The tenant receives the exact text after `SEND: `. Review remains blocked for maintenance even though the message mentions approval and installation.

Tenant: `Okay i understand i will let you know if it is something we can afford`

Bot: `You’re welcome. If you decide to move forward, send the quote here and I’ll pass it along to your property manager for review.`

One request, one exact manager reply, no maintenance alert or booking, and no new manager alert for the acknowledgement.
