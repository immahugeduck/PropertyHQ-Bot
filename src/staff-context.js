// Resolve staff follow-ups only against jobs already loaded in this account.
export function referencedStaffJobs(context, text = '', list = false) {
  const values=list ? text.match(/\b\d{4,}\b/g) || [] : [...text.matchAll(/(?:#|\bjobs?\b|\brequests?\b)\s*(\d{4,})/gi)].map(m=>m[1]);
  const bare=text.match(/^(?:for\s+)?#?(\d{4,})[.! ]*$/i);
  if(bare) values.push(bare[1]);
  const numbers=new Set(values);
  return context.jobs.filter(j=>numbers.has(String(j.job_number)));
}
export function namedStaffJobs(context,text = '') {
  const words=new Set(text.toLowerCase().match(/[a-z]+/g) || []);
  const input=text.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  return context.jobs.filter(j=>{
    const name=(j.tenant_name || '').toLowerCase().match(/[a-z]+/g) || [];
    const address=(j.address || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    return (name.length>=2 && name.every(w=>words.has(w))) || (address.length>=5 && input.includes(address));
  });
}
export function selectedStaffJob(context,text = '') {
  const refs=referencedStaffJobs(context,text),named=namedStaffJobs(context,text);
  const job=refs.length===1?refs[0]:!refs.length && named.length===1?named[0]:null;
  if(!job) return null;
  const allowed=new Set(`${job.job_number} ${job.tenant_name || ''} ${job.address || ''} for it is would be the tenant job request at this that number please`.toLowerCase().match(/[a-z0-9]+/g));
  const words=text.toLowerCase().match(/[a-z0-9]+/g) || [];
  return words.length && words.every(w=>allowed.has(w))?job:null;
}
export function workingStaffJob(context, text = '', explicitId, intentType) {
  const refs=referencedStaffJobs(context,text);
  if(refs.length) return refs.length===1?refs[0]:null;
  if(/(?:#|job|request)\s*\d{4,}/i.test(text) || /^\s*\d{4,}\s*$/.test(text) || /\b\d{4,}\s*(?:and|&|,)\s*\d{4,}\b/i.test(text)) return null;
  const explicit=context.jobs.find(j=>j.id===explicitId || String(j.job_number)===String(explicitId));
  if(explicitId && !explicit) return null;
  const named=namedStaffJobs(context,text);
  if(named.length) return named.length===1?named[0]:named.find(j=>j.id===explicit?.id) || null;
  const open=j=>j && !['completed','cancelled'].includes(j.status);
  const scheduling=/\b(?:schedule|book|confirm|tomorrow|today|to morrow|morning|afternoon|suggest|options?|times?)\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|^(?:[123]|yes(?:[, ]+please)?|go ahead)[.! ]*$/i.test(text.trim());
  const issues=text.toLowerCase().match(/\b(?:washer|dishwasher|sink|disposal|faucet|window|screen|door|electrical|tesla|toilet|leak|furnace|heater|spigot)\b/g)||[];
  const addressed=explicit && issues.some(issue=>new RegExp('\\b'+issue+'\\b','i').test(`${explicit.title||''} ${explicit.description||''} ${explicit.coordinator_details?.repairSummary||''}`));
  if(explicit && (['start_work','complete_work','report_progress','add_details'].includes(intentType) || addressed || (!scheduling && open(explicit)))) return explicit;
  const previous=(context.messages||[]).find(m=>typeof m.reply==='string' && m.reply.trim() && context.jobs.some(j=>j.id===m.jobId && open(j)));
  for(const id of [previous?.jobId,context.staffFocus?.jobId,context.state?.activeJobId]) {
    const job=context.jobs.find(j=>j.id===id && open(j));if(job) return job;
  }
  if(open(explicit)) return explicit;
  const jobs=context.jobs.filter(open);
  return jobs.length===1?jobs[0]:null;
}

export function shownStaffProposal(context,job) {
  if(!job) return;
  return (context.messages||[]).find(m=>m.scheduleProposal?.jobId===job?.id)?.scheduleProposal
    || (context.staffFocus?.jobId===job.id?context.staffFocus?.scheduleProposal:undefined);
}
