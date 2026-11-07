export function validOptions(options, now = new Date()) {
  return Array.isArray(options) && [1,2,3].includes(options.length) && options.every((o,i) => {
    if (!o || typeof o !== 'object') return false;
    const start = Date.parse(o.start), end = Date.parse(o.end);
    return /(?:Z|[+-]\d\d:\d\d)$/.test(o.start) && /(?:Z|[+-]\d\d:\d\d)$/.test(o.end) && start > +now && end > start && end-start <= (o.flexible ? 24 : 8)*3600000 && !options.slice(0,i).some(p=>Date.parse(p.start)<end && Date.parse(p.end)>start);
  });
}
export function formatWhen(value, timezone) {
  return new Intl.DateTimeFormat('en-US',{timeZone:timezone || 'America/Indiana/Indianapolis',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));
}
export function optionText(options, timezone) {
  return options.map((o,i)=>`${i+1}) ${o.flexible && o.label ? o.label : formatWhen(o.start,timezone)}${o.flexible && o.label ? '' : ` – ${formatWhen(o.end,timezone)}`}`).join('; ');
}
export function dateKey(value, timezone = 'America/Indiana/Indianapolis') {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function weekBounds(now,timezone,next) {
  const day=new Date(`${dateKey(now,timezone)}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate()-((day.getUTCDay()+6)%7)+(next?7:0));
  const start=day.toISOString().slice(0,10);day.setUTCDate(day.getUTCDate()+7);
  return {start,end:day.toISOString().slice(0,10)};
}
export function summarizeJobs({context,filter,jobId,now=new Date()}) {
  const staff=['manager','maintenance'].includes(context.identity.role);
  let all=context.jobs.filter(j=>staff || j.tenant_id===context.identity.tenantId);
  if(jobId) all=all.filter(j=>j.id===jobId || String(j.job_number)===String(jobId));
  const timezone=context.settings.timezone || 'America/Indiana/Indianapolis';
  let jobs=all;
  if(['open','in_progress','completed'].includes(filter)) jobs=jobs.filter(j=>j.status===filter);
  if(filter==='awaiting_scheduling') jobs=jobs.filter(j=>j.status!=='completed' && !j.scheduled_at);
  if(filter==='scheduled') jobs=jobs.filter(j=>j.status!=='completed' && j.scheduled_at);
  const bounds=['this_week','next_week'].includes(filter)?weekBounds(now,timezone,filter==='next_week'):null;
  const within=value=>value && (bounds ? dateKey(value,timezone)>=bounds.start && dateKey(value,timezone)<bounds.end : filter==='today' ? dateKey(value,timezone)===dateKey(now,timezone) : true);
  if(bounds || filter==='today') jobs=jobs.filter(j=>j.status!=='completed' && within(j.scheduled_at));
  if(!staff) return jobs.length ? jobs.slice(0,5).map(j=>j.status==='completed' ? `Your request #${j.job_number} is marked complete. Please let us know if it still needs attention.` : j.scheduled_at ? `Your visit for ${(j.title || 'maintenance').toLowerCase()} (#${j.job_number}) is scheduled ${formatWhen(j.scheduled_at,timezone)}.` : `Your ${(j.title || 'maintenance').toLowerCase()} request (#${j.job_number}) is waiting for a visit time.`).join(' ') : 'I don’t see a confirmed visit for that period yet. Which repair are you checking on?';
  const events=(context.staffEvents || []).filter(e=>e.status!=='cancelled' && within(e.start_at));
  const lines=jobs.slice(0,15).map(j=>`#${j.job_number}: ${j.title || 'Maintenance'} — ${j.status}${j.tenant_name?`, ${j.tenant_name}`:''}${j.address?`, ${j.address}`:''}${j.contact_phone?`, ${j.contact_phone}`:''}${j.status==='completed'?'':j.scheduled_at?`, scheduled ${formatWhen(j.scheduled_at,timezone)}`:', needs a time'}${jobId&&j.description?`\nIssue: ${j.description}`:''}${jobId&&j.notes?`\nProgress: ${j.notes.slice(-1200)}`:''}`);
  if(!jobId && !['completed','awaiting_scheduling'].includes(filter)) lines.push(...events.slice(0,10).map(e=>`Staff-only: ${e.title} — ${formatWhen(e.start_at,timezone)}`));
  if(!lines.length) {
    const period=filter==='next_week'?'next week':filter==='this_week'?'this week':filter==='today'?'today':'for that period';
    let reply=`No confirmed visits are scheduled ${period} yet.`;
    const pending=all.filter(j=>j.status!=='completed' && !j.scheduled_at);
    if(pending.length) reply+=` Waiting for a time: ${pending.slice(0,5).map(j=>`#${j.job_number} ${j.title}`).join('; ')}. You can offer visit options for one of these.`;
    else reply+=' You can add a staff-only entry by sending the task, day and time.';
    return reply;
  }
  return lines.join('\n')+(jobs.length>15?'\nShowing the first 15 jobs; ask by job number for details.':'');
}
