import { referencedStaffJobs, selectedStaffJob, workingStaffJob, shownStaffProposal } from './staff-context.js';
import {parseScheduleTime} from './staff.js';
import {interpretReviewMessage,managerInternalNote} from './manager-review.js';
import { entryConsent, entryAccessNotes, isEntryPermissionQuestion, isPassiveEntryGrant, isStandaloneEntryReply } from './entry-consent.js';
import {interpretStaffStatus} from './staff-status.js';
import {intentTypes as TYPES,intentSchema as schema} from './agent/contract.js';
import {agentInstructions} from './agent/instructions.js';
export async function interpretMessage({context,text,fetchImpl=globalThis.fetch,env=process.env,signal,now=new Date()}) {
  let fallback={type:'clarify',fields:{}};
  const jobs=context.jobs || [];
  const staff=['manager','maintenance'].includes(context.identity.role);
  const review=interpretReviewMessage({context,text});
  if(review) return review;
  if(staff && /\b(?:mock|sample|example)\b.*\bschedule\b/i.test(text)) return {type:'mock_schedule',fields:{}};
  if(staff && /(?:can|could|may) i add (?:something|an? (?:entry|event)) to my (?:schedule|calendar)/i.test(text)) return {type:'staff_event',fields:{}};
  if(/(?:what|show|check).*(?:schedule|appointments|visits).*(?:next|coming) week/i.test(text)) return {type:'request_status',fields:{filter:'next_week'}};
  const previous=context.messages?.find(m=>typeof m.reply==='string' && m.reply.trim());
  const answer=text.trim().toLowerCase().replace(/[,.!]+/g,' ').replace(/\s+/g,' ').trim();
  const staffApproval=/^(?:yes(?: please| that works)?|approve|confirm|go ahead|book it|send it|send them|that works)(?: thanks| thank you)?$/.test(answer);
  const status=interpretStaffStatus({context,text});
  if(status) return status;
  if(staff) {
    const job=workingStaffJob(context,text),shown=shownStaffProposal(context,job);
    const selection=text.trim().match(/^(?:(?:book|schedule|choose|option)\s+(?:option\s+)?)?([123])[.! ]*$/i);
    const manual=context.state?.pendingOptions?.jobId===job?.id && previous?.jobId===job?.id && /^For /.test(previous?.reply||'');
    const answering=previous?.jobId===job?.id && /Potential schedule times|Which visit should I book|Suggested visit/i.test(previous?.reply||'');
    if(shown && !manual && !context.state?.pendingStaffEvent && (selection || (answering && staffApproval))) return {type:'approve_suggestions',jobId:job.id,fields:{options:shown.options,proposalVersion:shown.proposalVersion,...(selection?{choice:Number(selection[1])}:{})}};
    const normalized=text.trim().replace(/^(?:okay|ok)[,.! ]+/i,'').replace(/\bto morrow\b/gi,'tomorrow').replace(/\bst\s+(?=\d{1,2}\s*(?:am|pm))/gi,'at ');
    const day='(?:today|tomorrow|(?:this\\s+|next\\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this (?=morning|afternoon|evening))';
    const clock='(?:1[0-2]|0?[1-9])(?::[0-5]\\d)?\\s*(?:am|pm)';
    const exact=new RegExp('^(?:#\\d{4,}\\s+)?(?:schedule|book)(?:\\s+(?:it|this|the visit))?\\s+(?:for\\s+)?(?:'+day+'(?:\\s*(?:morning|afternoon|evening))?\\s+(?:at\\s+)?'+clock+'|'+clock+'\\s+(?:today|tomorrow))[.! ]*$','i').test(normalized);
    if(exact) {
      const start=parseScheduleTime(normalized.replace(/\bthis (?:morning|afternoon|evening)\b/i,'today'),now,context.settings.timezone);
      const part=normalized.match(/\b(morning|afternoon|evening)\b/i)?.[1].toLowerCase();
      const hour=start?Number(new Intl.DateTimeFormat('en-GB',{timeZone:context.settings.timezone,hour:'numeric',hourCycle:'h23'}).format(start)):null;
      if(part && start && (part==='morning'?hour>=12:part==='afternoon'?hour<12 || hour>=17:hour<17)) return {type:'clarify',jobId:job?.id,fields:{scheduleClarification:'daypart',scheduleClock:new Intl.DateTimeFormat('en-US',{timeZone:context.settings.timezone,hour:'numeric',minute:'2-digit'}).format(start),scheduleDaypart:part}};
      if(!start) return {type:'clarify',fields:{scheduleClarification:'future'}};
      if(context.state?.pendingStaffEvent && !/^#\d{4,}\b/.test(normalized)) return {type:'staff_event',fields:{appointmentStart:start.toISOString(),appointmentEnd:new Date(+start+3600000).toISOString()}};
      return {type:job?'schedule_visit':'offer_times',jobId:job?.id,fields:{options:[{start:start.toISOString(),end:new Date(+start+3600000).toISOString(),flexible:false}]}};
    }
  }
  if(staff && /\b(?:suggest|recommend|available openings|free times)\b/i.test(text)) return {type:'request_times',jobId:workingStaffJob(context,text)?.id,fields:{}};
  if(staff && staffApproval && /(?:Shall I book this visit|Shall I send these three visit options to the tenant)\?$/.test(previous?.reply || '')) {
    const job=context.jobs.find(j=>j.id===previous?.jobId);
    if(job?.stage==='awaiting_staff' && /Suggested visit(?: options)?:/i.test(previous?.reply || '')) {
      const shown=previous?.scheduleProposal;
      return {type:'approve_suggestions',jobId:job.id,fields:{options:shown?.jobId===job.id?shown.options:[],proposalVersion:shown?.proposalVersion}};
    }
  }
  if(staff && /\b(?:same (?:job|repair|request)|duplicates?)\b/i.test(text) && !/\b(?:not|aren['’]?t|isn['’]?t|different|separate|never|maybe|possibly|perhaps|think|might|could)\b|\?/i.test(text)) {
    const refs=referencedStaffJobs(context,text,true),numbers=new Set(text.match(/\b\d{4,}\b/g) || []);
    if(numbers.size>=2) return {type:'related_jobs',fields:{jobIds:refs.length===numbers.size?refs.map(j=>j.id):[]}};
  }
  if(staff && context.state?.pendingStaffOffer && !/\b(?:cancel|ignore|forget|instead|change|reschedule)\b/i.test(text)) {
    const job=selectedStaffJob(context,text);
    if(job) return {type:'offer_times',jobId:job.id,fields:{options:context.state.pendingStaffOffer.options}};
  }

  if(context.identity.role==='tenant' && /^\((?:test|debug)\b[^)]*\b(?:above|below|previous|conversation|message)\b[^)]*\)$/i.test(text.trim())) return {type:'conversation_note',fields:{}};
  const issuePending=context.state?.pendingIssue;
  if(context.identity.role==='tenant' && issuePending && previous?.reply?.startsWith('Are you following up on the same repair') && (!previous.jobId || previous.jobId===issuePending.jobId) && /^(?:yes(?:[, ]+(?:same repair|that(?:'|’)s right|that is right))?|same repair|correct)[.! ]*$/i.test(text.trim()) && jobs.some(j=>j.id===issuePending.jobId && j.tenant_id===context.identity.tenantId && j.status!=='completed')) return {type:'add_details',jobId:issuePending.jobId,fields:{description:issuePending.description,facts:issuePending.facts}};
  let consentReply=context.identity.role==='tenant'?entryConsent(text,previous?.reply || ''):undefined;
  const accessNotes=context.identity.role==='tenant'?entryAccessNotes(text):undefined;
  const entryJobId=previous?.jobId || context.state?.activeJobId;
  const entryJob=jobs.find(j=>j.id===entryJobId && j.tenant_id===context.identity.tenantId && j.status!=='completed');
  const alternatives=context.identity.role==='tenant' && entryJob && /\b(?:those|these|the|offered|proposed) (?:times|options|visits) (?:do not|don't|dont|won't|will not) work\b|\b(?:other|different|alternative|new) (?:times|options)\b|\breschedul/i.test(text);
  if(alternatives) fallback={type:'request_alternatives',jobId:entryJob.id,fields:{description:text,facts:{}}};
  if(context.identity.role==='tenant' && entryJob) {
    // A repetition can reaffirm an already-saved grant on this job. It cannot
    // create permission after a different question or copy it from another job.
    if(consentReply===undefined && entryJob.coordinator_details?.entryPermission===true && isPassiveEntryGrant(text)) consentReply=true;
    if(consentReply!==undefined) {
      fallback={type:alternatives?'request_alternatives':'add_details',jobId:entryJob.id,fields:{description:text,facts:{entryPermission:consentReply,...(accessNotes?{accessNotes}:{})}}};
      if(isStandaloneEntryReply(text)) return fallback;
    }
    // An ambiguous answer to our entry question stays a follow-up, never a job.
    if(consentReply===undefined && isEntryPermissionQuestion(previous?.reply) && /^(?:yes|no|sure|okay|ok|maybe|perhaps|only|but)\b/i.test(text.trim()) && !/\b(?:also|another|new|separate)\b/i.test(text)) return {type:'clarify_entry',jobId:entryJob.id,fields:{description:text}};
  }
  const proposed=jobs.filter(j=>j.options?.length && j.tenant_id===context.identity.tenantId && (!j.stage || j.stage==='awaiting_selection') && j.status!=='completed');
  if (context.identity.role==='tenant' && /^[123]$/.test(text.trim()) && proposed.length===1) return {type:'choose_time',jobId:proposed[0].id,fields:{choice:Number(text),proposalVersion:proposed[0].proposal_version}};
  const pending=context.state?.pendingSelection;
  const answeringVisit=previous?.reply?.startsWith('Maintenance can come by ') && previous.reply.endsWith('Does that time work for you?') && (!previous.jobId || previous.jobId===pending?.jobId);
  const confirmsVisit=/^confirm(?:ed)?[.!]*$/i.test(text.trim()) || (answeringVisit && /^(?:yes(?:[,.]?\s+(?:please|that works(?: for me)?|that(?:'|’)s fine|that is fine))?|that works(?: for me)?|sounds good)[.!]*$/i.test(text.trim()));
  if (context.identity.role==='tenant' && confirmsVisit && pending) return {type:'select_time',jobId:context.state.pendingSelection.jobId,fields:{choice:context.state.pendingSelection.choice,proposalVersion:context.state.pendingSelection.proposalVersion,appointmentStart:context.state.pendingSelection.appointmentStart}};
  if (['manager','maintenance'].includes(context.identity.role)) {
    if ((/^confirm options$/i.test(text.trim()) || (/(?:Shall I send these (?:three )?visit options to the tenant|Shall I book this visit)\?$/.test(previous?.reply || '') && (!previous.jobId || previous.jobId===context.state?.pendingOptions?.jobId) && staffApproval)) && context.state?.pendingOptions) return {type:'confirm_options',jobId:context.state.pendingOptions.jobId,fields:{options:context.state.pendingOptions.options}};
    const approval=text.match(/^approve\s+(\+\d{8,15})\s+tenant\s+([0-9a-f-]{36})$/i);
    if (approval) return {type:'approve_contact',fields:{phone:approval[1],tenantId:approval[2]}};
    const unlink=text.match(/^unlink\s+(\+\d{8,15})$/i);
    if (unlink) return {type:'unlink_contact',fields:{phone:unlink[1]}};
  }
  if(staff && /^(?:got it|thanks|thank you|understood|ok|okay)[.! ]*$/i.test(text.trim())) return {type:'staff_acknowledgement',fields:{}};
  // Minimal identity capture also works during an AI outage.
  if (context.identity.role==='unknown' && context.state?.awaiting==='name' && !context.state?.name) return {type:'collect_contact',fields:{name:text.trim().slice(0,150)}};
  if (context.identity.role==='unknown' && context.state?.awaiting==='address' && !context.state?.address && /\d/.test(text)) return {type:'collect_contact',fields:{address:text.trim().slice(0,300)}};
  const internal=managerInternalNote({context,text});
  if(internal) fallback=internal;
  // API keys contain no whitespace; tolerate copy/paste wrapping without changing storage.
  const apiKey=String(env.OPENAI_API_KEY || '').replace(/\s+/g,'');
  if (!apiKey) return fallback;
  const safe={identity:context.identity,state:context.state,staffFocus:staff?context.staffFocus:undefined,timezone:context.settings.timezone,open_time:context.settings.open_time,close_time:context.settings.close_time,staffEvents:staff?(context.staffEvents||[]):[],jobs:jobs.map(j=>({id:j.id,job_number:j.job_number,coordinator_details:j.coordinator_details,coordinator_category:j.coordinator_category,coordinator_review_status:j.coordinator_review_status,coordinator_manager_reply:!staff && (j.id===context.state?.activeJobId || jobs.length===1)?j.coordinator_manager_reply:undefined,title:j.title,description:j.description,notes:staff?j.notes:undefined,stage:j.stage,status:j.status,scheduled_at:j.scheduled_at,tenant_name:j.tenant_name,address:j.address,contact_phone:j.contact_phone,options:j.options,proposal_version:j.proposal_version})),messages:(context.messages||[]).slice(-12)};
  try {
    const res=await fetchImpl('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},signal:signal || AbortSignal.timeout(6000),body:JSON.stringify({model:env.COORDINATOR_MODEL || 'gpt-4.1-mini',max_completion_tokens:600,messages:[{role:'system',content:agentInstructions},{role:'user',content:JSON.stringify({now:new Date().toISOString(),context:safe,text:String(text).slice(0,4000)})}],response_format:{type:'json_schema',json_schema:{name:'maintenance_intent',strict:true,schema}}})});
    if (!res.ok) return fallback;
    const data=await res.json();const intent=JSON.parse(data.choices?.[0]?.message?.content || '{}');
    if (!TYPES.includes(intent.type) || !intent.fields || typeof intent.fields!=='object' || Array.isArray(intent.fields)) return fallback;
    const reviewNote=managerInternalNote({context,text,intent});
    if(reviewNote) return reviewNote;
    // The schema also carries appointmentStart for tenant choices. Recover a
    // single explicit staff visit if the model placed it there instead of options.
    // Reserve one internal hour from the start; no end time was promised by staff.
    const singleExactVisit=/^(?:(?:schedule(?: (?:it|this|the visit))?|i can (?:visit|come(?: by)?|stop by))\s+)?(?:for\s+)?(?:(?:this|next)\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|\d{4}-\d{2}-\d{2})\s+(?:at\s+)?(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*(?:am|pm)[.! ]*$/i.test(text.trim());
    if(staff && intent.type==='offer_times' && !intent.fields.options?.length && singleExactVisit) {
      const start=intent.fields.appointmentStart,ms=Date.parse(start);
      if(Number.isFinite(ms) && /(?:Z|[+-]\d\d:\d\d)$/.test(start)) intent.fields.options=[{start,end:new Date(ms+3600000).toISOString()}];
    }
    const consent=consentReply ?? entryConsent(text,previous?.reply || '');
    const facts=intent.fields.facts && typeof intent.fields.facts==='object' ? {...intent.fields.facts} : {};
    if(accessNotes) facts.accessNotes=accessNotes;
    if(['new_request','request_manager_review'].includes(intent.type) && !accessNotes) delete facts.accessNotes;
    if(consent===undefined) delete facts.entryPermission;
    else facts.entryPermission=consent;
    if(intent.type==='new_request' && entryJob && isEntryPermissionQuestion(previous?.reply)) delete facts.entryPermission;
    if(intent.fields.facts || consent!==undefined) intent.fields.facts=facts;
    if(fallback.type==='request_alternatives') return {...fallback,fields:{...intent.fields,description:text,facts}};
    if(consentReply!==undefined && entryJob && (intent.type==='clarify' || (intent.type==='new_request' && /^(?:yes|no|sure|okay|ok|only|but)\b/i.test(text.trim()) && !/\b(?:also|another|new|separate)\b/i.test(text)))) return fallback;
    // A back-reference after our entry question cannot silently open a second job.
    // When the model disagrees about the issue, ask rather than guess its scope.
    if(intent.type==='new_request' && context.identity.role==='tenant' && entryJob && isEntryPermissionQuestion(previous?.reply) && /\b(?:still|same|it['’]s|it is|that (?:issue|problem))\b/i.test(text) && !/\b(?:also|another|new|separate)\b/i.test(text)) return {type:'clarify_issue',jobId:entryJob.id,fields:{description:text,facts}};
    return intent;
  } catch { return fallback; }
}
