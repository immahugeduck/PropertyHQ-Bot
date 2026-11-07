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
export function workingStaffJob(context, text = '', explicitId) {
  const refs=referencedStaffJobs(context,text);
  if(refs.length) return refs.length===1?refs[0]:null;
  if(/(?:#|job|request)\s*\d{4,}/i.test(text) || /^\s*\d{4,}\s*$/.test(text) || /\b\d{4,}\s*(?:and|&|,)\s*\d{4,}\b/i.test(text)) return null;
  const explicit=context.jobs.find(j=>j.id===explicitId || String(j.job_number)===String(explicitId));
  const named=namedStaffJobs(context,text);
  if(named.length) return named.length===1?named[0]:named.find(j=>j.id===explicit?.id) || null;
  if(explicitId) return explicit || null;
  const previous=context.messages?.find(m=>typeof m.reply==='string' && m.reply.trim());
  const active=previous?.jobId || context.state?.activeJobId;
  if(active) return context.jobs.find(j=>j.id===active) || null;
  return context.jobs.length===1?context.jobs[0]:null;
}
