// Uppercase DONE must start its own completion clause. Work notes remain audit data.
export function parseCompletionCommand(text='') {
  const body=String(text).trim();
  if(!body || body.length>8000 || body.includes('?')) return null;
  const restricted=/\b(?:not(?: quite)?|never|isn['’]?t|aren['’]?t|wasn['’]?t|haven['’]?t|didn['’]?t|don['’]?t|couldn['’]?t|have not|cannot|can't|cant|won't|will not|almost|nearly|partially)\b[^.!;\n]*\b(?:done|finish(?:ed)?|complete(?:d)?|fix(?:ed)?|resolve(?:d)?)\b|\b(?:will|would|(?:i|we)['’]ll|going to|plan(?:ning)? to|hope to|intend to|expect to|have to|need to|unable to|not able to)\b[^.!;\n]*\b(?:done|finish(?:ed)?|complete(?:d)?|fix(?:ed)?|resolve(?:d)?)\b|\b(?:can|could|may|might|should)\s+(?:(?:still|be|have it|get it)\s+)?(?:done|finish|complete|fix|resolve)\b|\b(?:incomplete|unfinished|unresolved|unfixed|unable)\b|\b(?:still )?(?:waiting for|need to finish|need to complete)\b/i;
  const privateNote=/\b(?:internal|private|staff[- ]only)\s+(?:staff\s+)?(?:note|update)\b|\b(?:do not|don't|don’t|dont)\s+(?:send|share|forward|text|message|notify)\b[^.!;\n]*\btenant\b|\b(?:no|without) tenant (?:message|notification)\b/i;
  const quoted=/["“”\x60]|\b(?:example|sample|template|quoting|quoted)\b|\b(?:tenant|renter|resident|occupant|customer|they|he|she)\s+(?:said|sent|wrote)\b|(?:^|\n)\s*'/i;
  if(restricted.test(body) || privateNote.test(body) || quoted.test(body)) return null;
  const markers=[...body.matchAll(/(?:^|[.!;\n]\s*)DONE(?:[ \t]+#([1-9]\d*))?(?=$|[ \t]+(?![#\d])|[.!;\r\n])/g)];
  if(markers.length!==1) return null;
  const marker=markers[0];
  const following=body.slice(marker.index+marker[0].length).replace(/^[.!;\s]+/,'');
  if(/^(?:show|can|could|what|when|please|will|after|once|if|until|not|don't|do not)\b/i.test(following)) return null;
  const references=[...new Set([...body.matchAll(/#([1-9]\d*)\b/g)].map(match=>match[1]))];
  if(references.length>1) return null;
  return {jobNumber:marker[1] || references[0] || null};
}

export function looksLikeCompletionCommand(text='') {
  return /^(?:done|finished|complete(?:d)?|fixed|resolved|all set)(?:\b|(?=[0-9_]))|^(?:(?:job|request)\s+)?#?\d+[ \t]+(?:is[ \t]+)?(?:done|finished|complete(?:d)?|fixed|resolved)(?:\b|(?=[0-9_]))/i.test(String(text).trim());
}
