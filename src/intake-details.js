// Persist structured, job-specific facts; null means not supplied, never revoke
// earlier consent or certainty merely because a later text omits it.
export function mergeFacts(previous = {}, incoming = {}) {
  const facts = { ...previous };
  if (['washer','screen_door','window_screen','sink_disposal','other'].includes(incoming?.issue)) facts.issue = incoming.issue;
  if (['only_when_used','continuous','uncertain','none'].includes(incoming?.leakPattern)) facts.leakPattern = incoming.leakPattern;
  for (const key of ['entryPermission','mainDoorSecure','updateWhenHome']) {
    if (typeof incoming?.[key] === 'boolean') facts[key] = incoming[key];
  }
  if (typeof incoming?.availability === 'string' && incoming.availability.trim()) facts.availability = incoming.availability.trim().slice(0,500);
  return facts;
}
export function inspectionReply({facts,scheduled=false,isNew=false,name,followUp=''}) {
  const greeting = isNew ? `Thanks for letting me know${name ? `, ${name}` : ''}.` : 'Thanks for the update!';
  const precaution = facts.issue === 'washer' ? ' Please leave the washer off until maintenance checks it.' : facts.issue === 'sink_disposal' ? ' Please avoid using the kitchen sink and disposal until maintenance checks it.' : '';
  if (scheduled) return `${greeting} We’ll keep the scheduled visit.${precaution}`;
  const update = facts.updateWhenHome ? ' Just update us when someone gets home. We’ll arrange an inspection either way.' : '';
  const scheduling = ' We’ll follow up with appointment options from maintenance.';
  // The inspection and staff referral never wait for this safety question.
  if (facts.issue === 'screen_door' && facts.mainDoorSecure === undefined) return `${greeting}${scheduling} Is the main entry door still closing and locking securely?`;
  const entry = facts.entryPermission === undefined && facts.issue !== 'screen_door' ? ' Does maintenance have permission to enter if nobody’s home?' : '';
  // Do not turn an appliance/drain report into a tenant diagnostic interview.
  const question = !['washer','screen_door','window_screen','sink_disposal'].includes(facts.issue) && !entry && followUp ? ` ${followUp}` : '';
  return `${greeting}${update}${scheduling}${entry}${precaution}${question}`;
}
