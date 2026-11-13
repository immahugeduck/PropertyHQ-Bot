# Tenant closings and exact completion commands

The November 13 live test confirmed that #1013's visit reminder and tenant updates
worked. The tenant's `Okay thank you!` was classified as a status request, which
repeated a scheduled visit instead of ending the conversation. The maintenance
message with `DONE` plus repair details was classified as progress; a later
completion command correctly completed #1013.

The user's final instruction is authoritative: **only `DONE` or `DONE #1013`**
may complete a request. The number changes for other requests. Lowercase/mixed-case
variants, synonyms, a number without `#`, punctuation or extra words are ignored
as completion commands. They do not update the repair or notify either party.
An audit of the inbound text is still retained. Ordinary progress updates remain
separate from completion commands.

The native parser, decision layer, fallback staff handler and SQL commit enforce
this policy. SQL also checks that an explicit number matches the targeted repair,
including inspection completion. A model-produced completion intent alone cannot
authorize a status change. New visit check-ins advertise the exact formats.
Malformed completion attempts are stopped before schedule/event heuristics,
alternate model intents and fallback relays. SQL independently discards alternate
actions and preserves the prior conversation state. Genuine emergency escalation
retains precedence.

Pure tenant thanks and farewells now close with:

> You’re welcome! If anything else comes up let us know, thank you. Have a good day!

Completion notices, inspection completion notices and completed-request status answers end with the same
requested sign-off. Thanks with a real repair update continues through the normal
workflow. The closing does not grant entry, book a visit, reopen a completed
request or send new maintenance alerts. Exact manager-authored `SEND:` wording
is preserved.

The regression examples use fictional contacts and execute the actual SQL/RPC
workflow. They cover the reported thank-you, strict command grammar, a misleading
model response, database enforcement, inspection scope, matching request numbers
and fallback handlers. Previously permissive completion examples now use the
approved explicit command, retaining lifecycle and isolation coverage.

One independent read-only review found joined malformed commands (`DONE1013`),
alternate-action bypasses and common thank-you modifiers. Each was reproduced
before a fix, then covered by passing regressions. The review also found an
inspection notice missing the sign-off; this falls within the requested final
message wording and was fixed for both SMS completion and Property HQ inspection
updates. The focused fix-pass run passed all 127 examples. No product findings
were deferred.

Verification before integration: **449 bot tests and 28 Property HQ tests passed**,
along with bot syntax and both diff checks. A concurrent update on bot `main`
introduced the separated agent runtime and scheduling-context fixes; those
changes are retained and the combined release is verified before deployment.

Final combined verification: **453 bot tests and 28 Property HQ tests passed**.
Bot syntax and both diff checks passed. The original photographed scheduling
correction tests and the new strict-command/tenant-closing regressions all run
through the retained agent runtime.

Apply `20261113195720_tenant_closing_strict_done.sql` before the matching bot
release. It changes future message generation and command validation only;
historical messages are not replayed and #1013's completed state is preserved.
