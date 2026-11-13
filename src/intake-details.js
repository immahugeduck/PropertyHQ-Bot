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
  for(const [key,limit] of [['repairSummary',240],['accessNotes',400]]) {
    if(typeof incoming?.[key]==='string' && incoming[key].trim()) {
      let value=incoming[key].replace(/\s+/g,' ').trim().slice(0,limit);
      const prior=typeof previous?.[key]==='string'?previous[key].trim():'';
      if(key==='accessNotes' && prior) {
        if(prior.toLowerCase().includes(value.toLowerCase())) value=prior;
        else if(!value.toLowerCase().includes(prior.toLowerCase())) value=prior+' '+value;
      }
      facts[key]=value;
    }
  }
  return facts;
}
export function inspectionReply({facts,scheduled=false,isNew=false,name,followUp=''}) {
  const greeting = isNew ? `Thanks for letting me know${name ? `, ${name}` : ''}.` : 'Thanks for the update!';
  const precaution = facts.issue === 'washer' ? ' Please leave the washer off until maintenance checks it.' : facts.issue === 'sink_disposal' ? ' Please avoid using the kitchen sink and disposal until maintenance checks it.' : '';
  if (scheduled) return `${greeting} We’ll keep the scheduled visit.${precaution}`;
  const update = facts.updateWhenHome ? ' Just update us when someone gets home. We’ll arrange an inspection either way.' : '';
  const scheduling = facts.entryPermission===undefined?' I’ve saved your request.':facts.entryPermission===false?' Your property manager will help arrange access.':' Maintenance will reach out to schedule a visit.';
  // Collect the separate door-safety fact while the repair remains saved.
  if (facts.issue === 'screen_door' && facts.mainDoorSecure === undefined && !isNew) return `${greeting}${scheduling} Is the main entry door still closing and locking securely?`;
  const entry = facts.entryPermission === undefined ? ' Before I send it to maintenance, does maintenance have permission to enter if nobody’s home?' : '';
  // Do not turn an appliance/drain report into a tenant diagnostic interview.
  const question = !['washer','screen_door','window_screen','sink_disposal'].includes(facts.issue) && !entry && followUp ? ` ${followUp}` : '';
  return `${greeting}${update}${scheduling}${entry}${precaution}${question}`;
}
