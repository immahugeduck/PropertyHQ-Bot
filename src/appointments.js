export function validOptions(options, now = new Date()) {
  return Array.isArray(options) && [2,3].includes(options.length) && options.every((o,i) => {
    const start = Date.parse(o.start), end = Date.parse(o.end);
    return /(?:Z|[+-]\d\d:\d\d)$/.test(o.start) && /(?:Z|[+-]\d\d:\d\d)$/.test(o.end) && start > +now && end > start && end-start <= 8*3600000 && !options.slice(0,i).some(p=>Date.parse(p.start)<end && Date.parse(p.end)>start);
  });
}
export function formatWhen(value, timezone) {
  return new Intl.DateTimeFormat('en-US',{timeZone:timezone || 'America/Indiana/Indianapolis',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));
}
export function optionText(options, timezone) {
  return options.map((o,i)=>`${i+1}) ${formatWhen(o.start,timezone)} – ${formatWhen(o.end,timezone)}`).join('; ');
}
export function summarizeJobs({context,filter,jobId,now=new Date()}) {
  let jobs=context.jobs;
  if (jobId) jobs=jobs.filter(j=>j.id===jobId || String(j.job_number)===String(jobId));
  if (['open','in_progress','completed'].includes(filter)) jobs=jobs.filter(j=>j.status===filter);
  if (filter==='awaiting_scheduling') jobs=jobs.filter(j=>j.status!=='completed' && !j.scheduled_at);
  if (filter==='scheduled') jobs=jobs.filter(j=>j.status!=='completed' && j.scheduled_at);
  if (filter==='today') { const date=d=>new Intl.DateTimeFormat('en-CA',{timeZone:context.settings.timezone}).format(new Date(d)); jobs=jobs.filter(j=>j.scheduled_at && date(j.scheduled_at)===date(now)); }
  return jobs.length ? jobs.slice(0,15).map(j=>`#${j.job_number}: ${j.title || 'Maintenance'} — ${j.status}${j.tenant_name ? `, ${j.tenant_name}` : ''}${j.address ? `, ${j.address}` : ''}${['manager','maintenance'].includes(context.identity.role) && j.contact_phone ? `, ${j.contact_phone}` : ''}${j.status==='completed' ? '' : j.scheduled_at ? `, scheduled ${formatWhen(j.scheduled_at,context.settings.timezone)}` : j.stage==='rescheduling' ? ', awaiting new options' : j.options?.length ? ', awaiting tenant selection' : ', awaiting scheduling'}${jobId && j.description ? `\nIssue: ${j.description}` : ''}${jobId && j.notes ? `\nProgress: ${j.notes.slice(-1200)}` : ''}`).join('\n') + (jobs.length > 15 ? '\nShowing the first 15 matching jobs. Ask by job number for more detail.' : '') : 'There are no matching requests on file.';
}
