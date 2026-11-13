import {workingStaffJob} from './staff-context.js';

function statusJobId(context,text) {
  if(/(?:#|\b(?:job|request)\b)\s*\d{4,}/i.test(text)) return workingStaffJob(context,text)?.id || 'unresolved';
  if(context.state?.pendingStaffEvent) return 'unresolved';
  const previous=context.messages?.find(m=>typeof m.reply==='string' && m.reply.trim());
  // A closed or deleted prompted request must not fall through to another job.
  if(previous?.jobId) return previous.jobId;
  const promptedNumber=previous?.reply?.match(/^Visit check-in #(\d{4,})\b/i)?.[1];
  if(promptedNumber) return context.jobs.find(j=>String(j.job_number)===promptedNumber)?.id || promptedNumber;
  return context.staffFocus?.jobId || context.state?.activeJobId || workingStaffJob(context,text)?.id || 'unresolved';
}

// Bounded replies to a maintenance check-in should not depend on model access.
export function interpretStaffStatus({context,text}) {
  if(!['maintenance','manager'].includes(context.identity.role)) return;
  const answer=text.trim();
  const privateNote=/^(?:internal(?: staff)?|private(?: staff)?|staff[- ]only) (?:note|update)\b|\b(?:do not|don't|don’t|dont)\s+(?:send|share|forward|text|message|notify)\b[^.!?;\n]*\btenant\b|\b(?:no|without) tenant (?:message|notification)\b/i.test(answer);
  if(privateNote) return {type:'add_details',jobId:statusJobId(context,text),fields:{description:text}};
  const first=answer.match(/^(?:(?:job|request)\s+)?#?(\d{4,})\s+(?:is\s+)?(?:done|finished|complete(?:d)?)[.! ]*$/i);
  const last=answer.match(/^(?:done|finished|complete(?:d)?)(?:\s+(?:(?:job|request)\s+)?#?(\d{4,}))?[.! ]*$/i);
  if(first || last) {
    const number=first?.[1] || last?.[1];
    const id=number?context.jobs.find(j=>String(j.job_number)===number)?.id || number:statusJobId(context,text);
    return {type:'complete_work',jobId:id,fields:{description:text}};
  }
  if(context.identity.role==='maintenance' && /^(?:(?:i(?:['’]m| am)|we(?:['’]re| are))\s+)?(?:still\s+)?not(?: quite)? (?:done|finished|complete(?:d)?)\b|^(?:(?:i|we)\s+)?(?:haven['’]?t|have not) finished\b/i.test(answer)) {
    return {type:'report_progress',jobId:statusJobId(context,text),fields:{description:text}};
  }
}
