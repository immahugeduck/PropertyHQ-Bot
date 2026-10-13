// Carrier-compliance keywords (STOP / START / HELP).
//
// Twilio answers these keywords itself, using its defaults or the Advanced
// Opt-Out replies configured on the Messaging Service, and still forwards the
// message to our webhook. So the webhook must recognise them, keep them out of
// maintenance triage, and send nothing back; a TwiML reply here would reach
// the customer as a second, conflicting text (and is blocked after a STOP).
//
// Twilio only treats a message as a keyword when the whole body is the
// keyword, ignoring case ("stop" counts, "stop please" does not). We match the
// same way so a real maintenance request is never swallowed.

const KEYWORDS = {
  STOP: ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'REVOKE'],
  START: ['START', 'YES', 'UNSTOP'],
  HELP: ['HELP', 'INFO']
};

const LOOKUP = new Map(
  Object.entries(KEYWORDS).flatMap(([type, words]) => words.map((word) => [word, type]))
);

/**
 * Identify a compliance keyword message.
 * Prefers Twilio's own OptOutType (sent when Advanced Opt-Out is enabled,
 * which also covers any custom keywords configured there).
 * @returns {'STOP'|'START'|'HELP'|null}
 */
export function classifyKeyword(body, optOutType) {
  const reported = String(optOutType ?? '').trim().toUpperCase();
  if (KEYWORDS[reported]) return reported;
  return LOOKUP.get(String(body ?? '').trim().toUpperCase()) ?? null;
}
