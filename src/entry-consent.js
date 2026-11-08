// This field means permission to enter while nobody is home, not permission for
// an accompanied visit. Keep the tenant's restrictions in the original message.
const normalizeAnswer = text => text.trim().replace(/’/g,"'").replace(/[,!.]+/g,' ').replace(/\s+/g,' ').trim();
const shortAgreement = /^(?:yes(?: (?:that's|that is) fine(?: with me)?| you (?:can|may)| please)?(?: whenever you can)?|sure|absolutely|of course|go ahead|that's fine(?: with me)?|that is fine(?: with me)?)(?: (?:lol|thanks|thank you))?$/i;
export function isPassiveEntryGrant(text) {
  return /^(?:yes )?permission(?: is)? granted(?: (?:thanks|thank you))?$/i.test(normalizeAnswer(text));
}
export function isStandaloneEntryReply(text) {
  const answer=normalizeAnswer(text);
  if(isPassiveEntryGrant(text) || shortAgreement.test(answer) || /^no(?: thanks| thank you)?$/i.test(answer) || /^permission(?: is)? (?:not granted|denied|revoked)$/i.test(answer)) return true;
  // Only bounded access answers bypass extraction. A second request, location,
  // availability or other instruction must still be interpreted in full.
  return /^(?:(?:yes|no) )?(?:(?:you|maintenance|they) (?:(?:do not|don't|dont) )?(?:have|has) (?:(?:my|our) )?permission(?: to enter)?|(?:i|we) (?:(?:do not|don't|dont) )?(?:give|grant) (?:you )?permission(?: to enter)?|(?:you|maintenance|they) (?:can|may|cannot|can't|cant|may not) enter|(?:please )?(?:do not|don't|dont|never) enter)(?: (?:if|when|while) (?:(?:nobody|no one)(?: is)?(?: at)? home|(?:i am|i'm|we are|we're) (?:away|not home)))?$/i.test(answer);
}
export function isEntryPermissionQuestion(reply = '') {
  return /permission.*enter|may.*enter/i.test(reply) && (reply.match(/\?/g) || []).length === 1;
}
export function entryConsent(text, priorReply = '') {
  text = text.replace(/’/g,"'");
  const asked = isEntryPermissionQuestion(priorReply);
  const clauses = text.match(/[^.!?;\n]+[.!?;\n]?/g) || [];
  const relevant = clauses.filter(c => /\bpermission\b|\benter\b|let (?:yourself|themselves) in/i.test(c));
  const denied = /\b(?:do not|don't|dont|never)\s+(?:enter|let (?:yourself|themselves) in)\b|\b(?:do not|don't|dont)\s+(?:have|give|grant)\s+(?:you\s+)?(?:(?:my|our)\s+)?permission\b|\b(?:cannot|can't|cant|may not|not allowed to)\s+enter\b|\bno permission\b|\b(?:never said|didn't say|did not say|no longer|not anymore|not now)\b/i;
  const conditional = /\b(?:if|unless|when|provided|only|after|before|until)\b/i;
  const absent = /\b(?:if|when)\s+(?:nobody|no one)(?:\s+is)?\s+(?:at\s+)?home\b/gi;
  if (relevant.some(c => denied.test(c))) return false;
  if (relevant.some(c => /\bpermission(?: is)? (?:not granted|denied|revoked)\b/i.test(c))) return false;
  if ((asked || relevant.length) && /\b(?:need|have|want) to be (?:there|home)|\bonly (?:if|when).*(?:home|there)\b/i.test(text)) return false;
  if ((asked || relevant.length) && /\b(?:call|text|contact|notify|ask|check with)\b[^.!?;\n]*\b(?:first|before)\b/i.test(text)) return false;
  const restrictions=clauses.filter(c=>relevant.includes(c) || /^\s*(?:(?:but|and|please)\s+)*(?:only|unless|provided|after|before|wait|not until)\b/i.test(c) || (asked && /^\s*(?:yes|sure|of course|only|but)\b/i.test(text)));
  // Exempt the absence condition itself, never another restriction in the same
  // clause (for example "if nobody is home, but only after 5 PM").
  if (restrictions.some(c => conditional.test(c.replace(absent,' ')))) return false;
  if (asked && /^no[.! ]*$/i.test(text.trim())) return false;
  const positive = /\b(?:you|maintenance|they)\s+(?:have|has)\s+(?:my\s+)?permission\b|\b(?:i|we)\s+(?:give|grant)\s+(?:you\s+)?permission\b|\b(?:you|maintenance|they)\s+(?:can|may)\s+enter\b/i;
  if (relevant.some(c => !c.trim().endsWith('?') && positive.test(c))) return true;
  // A bounded, unqualified answer to one explicit permission question is enough.
  const answer=normalizeAnswer(text);
  // Passive grants are an answer to this job's explicit entry question, not a
  // general authorization inferred from a mention of permission elsewhere.
  if (asked && isPassiveEntryGrant(text)) return true;
  if (asked && shortAgreement.test(answer)) return true;
  if (asked && /^no(?: thanks| thank you)?$/i.test(answer)) return false;
  return undefined;
}
