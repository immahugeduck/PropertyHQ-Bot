// This field means permission to enter while nobody is home, not permission for
// an accompanied visit. Keep the tenant's restrictions in the original message.
export function entryConsent(text, priorReply = '') {
  const asked = /permission.*enter|may.*enter/i.test(priorReply) && (priorReply.match(/\?/g) || []).length === 1;
  const clauses = text.match(/[^.!?;\n]+[.!?;\n]?/g) || [];
  const relevant = clauses.filter(c => /\bpermission\b|\benter\b|let (?:yourself|themselves) in/i.test(c));
  const denied = /\b(?:do not|don't|dont|never)\s+(?:enter|let (?:yourself|themselves) in)\b|\b(?:do not|don't|dont)\s+(?:have|give|grant)\s+(?:you\s+)?(?:(?:my|our)\s+)?permission\b|\b(?:cannot|can't|cant|may not|not allowed to)\s+enter\b|\bno permission\b|\b(?:never said|didn't say|did not say|no longer|not anymore|not now)\b/i;
  const conditional = /\b(?:if|unless|when|provided|only|after|before)\b/i;
  const absent = /\b(?:if|when)\s+(?:nobody|no one)(?:\s+is)?\s+(?:at\s+)?home\b/i;
  if (relevant.some(c => denied.test(c))) return false;
  if ((asked || relevant.length) && /\b(?:need|have|want) to be (?:there|home)|\bonly (?:if|when).*(?:home|there)\b/i.test(text)) return false;
  if (relevant.some(c => conditional.test(c) && !absent.test(c))) return false;
  if (asked && /^no[.! ]*$/i.test(text.trim())) return false;
  const positive = /\b(?:you|maintenance|they)\s+(?:have|has)\s+(?:my\s+)?permission\b|\b(?:i|we)\s+(?:give|grant)\s+(?:you\s+)?permission\b|\b(?:you|maintenance|they)\s+(?:can|may)\s+enter\b/i;
  if (relevant.some(c => !c.trim().endsWith('?') && positive.test(c))) return true;
  // A bounded, unqualified answer to one explicit permission question is enough.
  if (asked && /^yes(?:,?\s+(?:that's|that is) fine)?(?:,?\s+whenever you can)?[.! ]*$/i.test(text.trim())) return true;
  return undefined;
}
