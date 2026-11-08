// This field means permission to enter while nobody is home, not permission for
// an accompanied visit. Keep the tenant's restrictions in the original message.
export function isEntryPermissionQuestion(reply = '') {
  return /permission.*enter|may.*enter/i.test(reply) && (reply.match(/\?/g) || []).length === 1;
}
export function entryConsent(text, priorReply = '') {
  text = text.replace(/’/g,"'");
  const asked = isEntryPermissionQuestion(priorReply);
  const clauses = text.match(/[^.!?;\n]+[.!?;\n]?/g) || [];
  const relevant = clauses.filter(c => /\bpermission\b|\benter\b|let (?:yourself|themselves) in/i.test(c));
  const denied = /\b(?:do not|don't|dont|never)\s+(?:enter|let (?:yourself|themselves) in)\b|\b(?:do not|don't|dont)\s+(?:have|give|grant)\s+(?:you\s+)?(?:(?:my|our)\s+)?permission\b|\b(?:cannot|can't|cant|may not|not allowed to)\s+enter\b|\bno permission\b|\b(?:never said|didn't say|did not say|no longer|not anymore|not now)\b/i;
  const conditional = /\b(?:if|unless|when|provided|only|after|before)\b/i;
  const absent = /\b(?:if|when)\s+(?:nobody|no one)(?:\s+is)?\s+(?:at\s+)?home\b/i;
  if (relevant.some(c => denied.test(c))) return false;
  if (relevant.some(c => /\bpermission(?: is)? (?:not granted|denied|revoked)\b/i.test(c))) return false;
  if ((asked || relevant.length) && /\b(?:need|have|want) to be (?:there|home)|\bonly (?:if|when).*(?:home|there)\b/i.test(text)) return false;
  if (relevant.some(c => conditional.test(c) && !absent.test(c))) return false;
  if (asked && /^no[.! ]*$/i.test(text.trim())) return false;
  const positive = /\b(?:you|maintenance|they)\s+(?:have|has)\s+(?:my\s+)?permission\b|\b(?:i|we)\s+(?:give|grant)\s+(?:you\s+)?permission\b|\b(?:you|maintenance|they)\s+(?:can|may)\s+enter\b/i;
  if (relevant.some(c => !c.trim().endsWith('?') && positive.test(c))) return true;
  // A bounded, unqualified answer to one explicit permission question is enough.
  const answer=text.trim().replace(/’/g,"'").replace(/[,!.]+/g,' ').replace(/\s+/g,' ').trim();
  // Passive grants are an answer to this job's explicit entry question, not a
  // general authorization inferred from a mention of permission elsewhere.
  if (asked && /^(?:yes )?permission(?: is)? granted(?: (?:thanks|thank you))?$/i.test(answer)) return true;
  if (asked && /^(?:yes(?: (?:that's|that is) fine(?: with me)?| you (?:can|may)| please)?(?: whenever you can)?|sure|absolutely|of course|go ahead|that's fine(?: with me)?|that is fine(?: with me)?)(?: (?:lol|thanks|thank you))?$/i.test(answer)) return true;
  if (asked && /^no(?: thanks| thank you)?$/i.test(answer)) return false;
  return undefined;
}
