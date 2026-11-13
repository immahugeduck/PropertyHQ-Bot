import { decideStaffScheduling } from './staff-scheduling.js';
import {isReviewPending,decideManagerCommand,reviewStatus} from './manager-review.js';
import { workingStaffJob } from './staff-context.js';
import { repairLabel } from './tenant-language.js';
import { mergeFacts, inspectionReply } from './intake-details.js';
import { validOptions, optionText, formatWhen, summarizeJobs } from './appointments.js';
const staffTypes = new Set(['request_times','approve_suggestions','schedule_visit','related_jobs','staff_event','mock_schedule','offer_times','confirm_options','start_work','report_progress','complete_work','approve_contact','unlink_contact']);
const clean = value => typeof value === 'string' ? value.trim().slice(0,1500) : '';
export function decideConversation({ context: original, intent, safety, now = new Date() }) {
  const staff = ['maintenance','manager'].includes(original.identity.role);
  const context = {...original,jobs: original.jobs.filter(j => staff || (original.identity.state==='known' && j.tenant_id===original.identity.tenantId))};
  const nextState = {...context.state};
  const result = (reply,actions=[]) => ({reply,actions,nextState});
  if (safety?.severity === 'EMERGENCY') {
    const active=context.jobs.find(j=>j.id===context.state?.activeJobId && j.status!=='completed' && j.coordinator_category===safety.category);
    return result(safety.response.replace(/Maintenance is being alerted now\./g,'').trim()+' I’ll try to pass this to the manager. If you need immediate help, contact emergency services.',[{type:'emergency',jobId:active?.id,fields:{description:clean(context.inbound),category:safety.category}}]);
  }
  const type = intent?.type || 'clarify', fields = intent?.fields || {};
  if(['send_manager_reply','authorize_manager_request','manager_review_note'].includes(type)) return decideManagerCommand({context,intent,nextState});
  if (staffTypes.has(type) && !staff) return result('I can help with your maintenance request. Only our staff can make that change.');
  if(staff && type==='clarify' && fields.scheduleClarification) return result(fields.scheduleClarification==='daypart'?'Please confirm whether you mean morning or evening, and the exact visit time.':'Please give me a future day and exact time for that visit.');
  if (!staff && context.identity.state !== 'known') {
    if (clean(fields.name)) nextState.name = clean(fields.name);
    if (clean(fields.address)) nextState.address = clean(fields.address);
    if (!nextState.name) { nextState.awaiting='name'; return result('Hi! I’m here to help with maintenance. What’s your full name?'); }
    if (!nextState.address) { nextState.awaiting='address'; return result(`Thanks, ${nextState.name}. What’s the property address, including your unit?`); }
    if (!nextState.approvalRequested) {
      nextState.approvalRequested = true; delete nextState.awaiting;
      return result('Thanks! I’ll ask our team to confirm your contact details. What maintenance problem can I help with?',[{type:'request_link_approval',fields:{name:nextState.name,address:nextState.address}}]);
    }
    return result('Your contact details are awaiting staff confirmation. I’ll keep your message with this conversation for the team.',[{type:'pending_note',fields:{description:clean(context.inbound)}}]);
  }
  if(type==='related_jobs') {
    const ids=fields.jobIds || [];
    const related=context.jobs.filter(j=>ids.includes(j.id));
    if(ids.length<2 || related.length!==ids.length || related.some(j=>!j.tenant_id || j.tenant_id!==related[0].tenant_id || j.status==='completed')) return result('I need our team to review those records in PropertyHQ before treating them as the same repair.');
    const primary=[...related].sort((a,b)=>Number(a.job_number)-Number(b.job_number))[0];
    nextState.activeJobId=primary.id;
    const pending=context.state?.pendingStaffOffer || (ids.includes(context.state?.pendingOptions?.jobId)?context.state.pendingOptions:null);
    const note=`Staff identified ${related.map(j=>'#'+j.job_number).join(' and ')} as the same repair. Use #${primary.job_number} for this visit; original records retained.`;
    const actions=[{type:'add_details',jobId:primary.id,fields:{description:note,requestScheduling:false}}];
    const ack=`I’ve noted that ${related.map(j=>'#'+j.job_number).join(' and ')} describe the same repair for ${primary.tenant_name || 'this tenant'}. For this visit, I’ll use #${primary.job_number}.`;
    if(pending && validOptions(pending.options,now)) {
      const proposal=decideStaffScheduling({context,job:primary,type:'offer_times',fields:{options:pending.options},nextState,now});
      return result(`${ack} ${proposal.reply}`,actions);
    }
    return result(`${ack} What visit times are available?`,actions);
  }
  if(type==='conversation_note') return result('I’ve kept that note with this conversation.');
  if(type==='staff_acknowledgement' && staff) return result('');
  if(type==='mock_schedule') return result('Example only — not saved: Monday 9 AM, property check; Tuesday 1 PM, maintenance follow-ups. To add a real staff-only entry, send the task, day and time.');
  if(type==='staff_event') {
    const pending=nextState.pendingStaffEvent || {};
    const title=clean(fields.eventTitle) || pending.title;
    const start=fields.appointmentStart || pending.start;
    nextState.pendingStaffEvent={...(title?{title}:{}),...(start?{start}:{})};
    if(!title) return result('Of course—what would you like to add, and when? I’ll keep it staff-only.');
    if(!start) return result(`When should I put “${title}” on the staff calendar?`);
    const startMs=Date.parse(start),endMs=fields.appointmentEnd?Date.parse(fields.appointmentEnd):startMs+3600000;
    if(!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs<=+now || endMs<=startMs || endMs-startMs>86400000 || !/(?:Z|[+-]\d\d:\d\d)$/.test(start)) return result('Please give me a future day and time for that entry.');
    delete nextState.pendingStaffEvent;
    return result(`Added “${title}” to the staff calendar for ${formatWhen(start,context.settings.timezone)}. No tenant will be notified.`,[{type:'staff_event',fields:{eventTitle:title,appointmentStart:new Date(startMs).toISOString(),appointmentEnd:new Date(endMs).toISOString()}}]);
  }
  if(type==='request_status') {
    const matching=intent.jobId?context.jobs.filter(j=>j.id===intent.jobId || String(j.job_number)===String(intent.jobId)):context.jobs;
    const open=matching.filter(j=>j.status!=='completed');
    if(!staff && open.length===1 && isReviewPending(open[0])) return result(reviewStatus(open[0]));
    if(!staff && open.length===1 && !open[0].scheduled_at) {
      const job=open[0];nextState.activeJobId=job.id;
      if(job.stage==='awaiting_selection' && job.options?.some(o=>Date.parse(o.flexible?o.end:o.start)>+now)) return result(`Maintenance has offered these times for the ${repairLabel(job)}: ${optionText(job.options,context.settings.timezone)}. Which option works for you?`);
      if(job.status==='in_progress') return result(summarizeJobs({context,filter:fields.filter,jobId:job.id,now}));
      if(job.coordinator_details?.entryPermission===undefined) return result(`Thanks for checking in${context.identity.name?`, ${context.identity.name}`:''}. Your request for the ${repairLabel(job)} is saved. Before I send it to maintenance, does maintenance have permission to enter if nobody is home?`);
      if(job.coordinator_details?.entryPermission===false) return result('Your request is saved. Your property manager will help arrange access before maintenance is notified.');
      return result(`Thanks for checking in${context.identity.name?`, ${context.identity.name}`:''}. Your request for the ${repairLabel(job)} is with maintenance. We’re waiting for a confirmed visit time, and I’ll keep you updated here.`,[{type:'request_scheduling',jobId:job.id,fields:{description:clean(context.inbound)||'Tenant requested available visit times.'}}]);
    }
    return result(summarizeJobs({context,filter:fields.filter,jobId:intent.jobId,now}));
  }
  if (type==='approve_contact' || type==='unlink_contact') {
    if (!/^\+[1-9]\d{7,14}$/.test(fields.phone||'') || (type==='approve_contact' && !clean(fields.tenantId))) return result('Please provide the pending phone number and PropertyHQ tenant ID to approve the link.');
    return result(type==='approve_contact'?'Contact link recorded. Future messages will use that tenant’s property.':'Contact link removed. Future messages will require verification.',[{type,fields:{phone:fields.phone,tenantId:fields.tenantId || null}}]);
  }
  const followUp={when_started:'When did this start?',where_in_home:'Where in your home is this happening?',photo:'Could you send a photo if it’s safe to take one?'}[fields.nextQuestion] || '';
  if (type==='new_request' || type==='request_manager_review') {
    if (staff) return result('Please ask the tenant to report the issue, or use PropertyHQ to create it for them.');
    if (!context.identity.propertyId) return result('I need our team to confirm which property belongs to your contact before filing this request.');
    if (!clean(fields.description)) return result(`Hi ${context.identity.name || 'there'}! What’s happening with the maintenance issue?`);
    const facts=mergeFacts({},fields.facts);
    if(type==='request_manager_review') return result('Thanks! I’ll pass your request to your property manager for review and get back to you.',[{type,fields:{description:clean(fields.description),facts}}]);
    const reply=inspectionReply({facts,isNew:true,name:context.identity.name,followUp});
    return result(reply,[{type,fields:{description:clean(fields.description),category:safety?.category || 'general_maintenance',facts,requestScheduling:true}}]);
  }
  const job = staff ? workingStaffJob(context,context.inbound,intent?.jobId,type) : intent?.jobId ? context.jobs.find(j=>j.id===intent.jobId || String(j.job_number)===String(intent.jobId)) : context.jobs.length===1 ? context.jobs[0] : null;
  if(staff && type==='offer_times' && !job && validOptions(fields.options,now)) {
    nextState.pendingStaffOffer={options:fields.options};
    return result(`I have ${optionText(fields.options,context.settings.timezone)}. Which repair should I use? You can give me the tenant’s name, address or job number.`);
  }
  if (!job) return result(context.jobs.length ? (staff?'Which request is this about? Please include its job number, or tell me it’s a new issue.':'Which repair are you following up on, or is this something new?') : `Hi ${context.identity.name || 'there'}! What maintenance problem can I help with?`);
  nextState.activeJobId=job.id;
  if(staff && nextState.pendingOptions?.jobId && nextState.pendingOptions.jobId!==job.id) delete nextState.pendingOptions;
  const action = f=>[{type,jobId:job.id,fields:f}];
  if(isReviewPending(job)) {
    if(!staff && type==='acknowledge_review') {
      const reply=job.coordinator_review_status==='awaiting_tenant_response' && /\b(?:quote|estimate)\b/i.test(job.coordinator_manager_reply||'')
        ? 'You’re welcome. If you decide to move forward, send the quote here and I’ll pass it along to your property manager for review.'
        : 'You’re welcome. Just message us here if you have another update.';
      return result(reply,[{type:'review_followup',jobId:job.id,fields:{description:clean(context.inbound),notifyManager:false}}]);
    }
    if(!staff && ['add_details','request_alternatives'].includes(type)) return result('Thanks, I’ll pass that update to your property manager for review.',[{type:'review_followup',jobId:job.id,fields:{description:clean(context.inbound)||clean(fields.description),facts:mergeFacts({},fields.facts),notifyManager:true}}]);
    return result('This request is awaiting manager review and approval before maintenance can arrange a visit.');
  }
  if(type==='clarify_issue' && !staff) {
    const facts=mergeFacts({},fields.facts);delete facts.entryPermission;
    nextState.pendingIssue={jobId:job.id,description:clean(fields.description),facts};
    return result(`Are you following up on the same repair—the ${repairLabel(job)}?`);
  }
  if(type==='clarify_entry' && !staff) return result('I want to make sure I record your entry preference correctly. Does maintenance have permission to enter while nobody is home?',[{type:'add_details',jobId:job.id,fields:{description:clean(context.inbound)||clean(fields.description),requestScheduling:false,notifyMaintenance:false}}]);
  if(['offer_times','confirm_options','request_times','approve_suggestions','schedule_visit'].includes(type)) return decideStaffScheduling({context,job,type,fields,nextState,now});
  if (type==='choose_time' || type==='select_time') {
    if (staff) return result('The tenant needs to choose one of the proposed options.');
    if (fields.proposalVersion!==job.proposal_version || !Number.isInteger(fields.choice) || !job.options?.[fields.choice-1] || Date.parse(job.options[fields.choice-1].start)<=+now) return result('That option is no longer available. Please choose from the current proposal or ask for alternatives.');
    const option=job.options[fields.choice-1];
    const updates=Object.keys(mergeFacts({},fields.facts)).length ? [{type:'add_details',jobId:job.id,fields:{description:clean(context.inbound),facts:mergeFacts({},fields.facts)}}] : [];
    const start=fields.appointmentStart || option.start;
    if (option.flexible && !fields.appointmentStart) return result('What time within that availability window works for you?',updates);
    if (!Number.isFinite(Date.parse(start))) return result('Please choose a valid time within the offered availability.');
    const duration=60*60*1000; // Internal capacity reservation, not a promised repair duration.
    const end=option.flexible ? new Date(Math.min(Date.parse(start)+duration,Date.parse(option.end))).toISOString() : option.end;
    if (!Number.isFinite(Date.parse(start)) || Date.parse(start)<Date.parse(option.start) || Date.parse(start)>=Date.parse(option.end) || Date.parse(start)<=+now || (!option.flexible && Date.parse(start)!==Date.parse(option.start))) return result('That time is outside the current options. Please choose a listed time or ask for alternatives.');
    if (type==='choose_time') {
      nextState.pendingSelection={jobId:job.id,choice:fields.choice,proposalVersion:fields.proposalVersion,...(option.flexible?{appointmentStart:start,appointmentEnd:end}:{})};
      return result(`Maintenance can come by ${formatWhen(start,context.settings.timezone)} for the ${repairLabel(job)}. Does that time work for you?`,updates);
    }
    const pending=context.state?.pendingSelection;
    if (!pending || pending.jobId!==job.id || pending.choice!==fields.choice || pending.proposalVersion!==fields.proposalVersion || Date.parse(pending.appointmentStart || option.start)!==Date.parse(start)) return result('Please choose a current option first so I can confirm the exact date with you.');
    delete nextState.pendingSelection;
    return result(`You’re scheduled for ${formatWhen(start,context.settings.timezone)} for the ${repairLabel(job)}. We’ll keep you updated here.`,action({choice:fields.choice,proposalVersion:fields.proposalVersion,...(option.flexible?{appointmentStart:start,appointmentEnd:end}:{}),facts:mergeFacts({},fields.facts)}));
  }
  if (type==='request_alternatives') {
    if(nextState.pendingSelection?.jobId===job.id) delete nextState.pendingSelection;
    return result('Thanks! I’ll pass your availability to the team for new options.',action({description:clean(fields.description)||clean(context.inbound),facts:mergeFacts({},fields.facts)}));
  }
  if (type==='start_work' || type==='complete_work' || type==='report_progress') {
    if (job.status==='completed' && type!=='complete_work') return result('That job is completed. Please clarify whether a new request is needed.');
    if(type==='complete_work' && job.coordinator_review_status==='inspection_authorized') return result('Inspection recorded. I’ll send the findings to the manager for review before any installation or work is approved.',[{type:'complete_inspection',jobId:job.id,fields:{description:clean(fields.description)||clean(context.inbound)}}]);
    return result(`Recorded for #${job.job_number}. Notifications are queued for the manager and any verified tenant contact.`,action({description:clean(fields.description)}));
  }
  if (type==='add_details') {
    if(nextState.pendingIssue?.jobId===job.id) delete nextState.pendingIssue;
    if(staff) {
      if(context.identity.role==='manager') return result(`I’ve saved that as an internal manager note for #${job.job_number}.`,[{type:'manager_review_note',jobId:job.id,fields:{description:clean(context.inbound)}}]);
      const facts=mergeFacts({},fields.facts);delete facts.entryPermission;delete facts.availability;
      return result(`Noted for ${job.tenant_name || 'the tenant'}’s ${repairLabel(job)} (#${job.job_number}).`,action({description:clean(fields.description)||clean(context.inbound),facts,requestScheduling:false}));
    }
    const facts=mergeFacts(job.coordinator_details,fields.facts);
    const incoming=mergeFacts({},fields.facts);
    if(typeof incoming.entryPermission==='boolean' && Object.keys(incoming).every(k=>['entryPermission','accessNotes'].includes(k))) {
      const acknowledgement=incoming.entryPermission
        ? 'Thanks, I’ve recorded your permission to enter while nobody is home.'
        : 'Thanks, I’ve recorded that maintenance must arrange entry permission with you.';
      const scheduling=job.scheduled_at
        ? (incoming.entryPermission?' Your visit remains scheduled.':' I’ll let maintenance know to arrange access for your scheduled visit.')
        : incoming.entryPermission?' I’ll coordinate the visit with maintenance.':' Your property manager will help arrange access before maintenance is notified.';
      return result(acknowledgement+scheduling,action({description:clean(fields.description)||clean(context.inbound),facts:incoming,requestScheduling:!job.scheduled_at}));
    }
    return result(Object.keys(facts).length ? inspectionReply({facts,scheduled:!!job.scheduled_at,followUp}) : `Thanks for the update. I’ll pass that along to maintenance. ${followUp}`,action({description:clean(fields.description)||clean(context.inbound),facts:mergeFacts({},fields.facts),requestScheduling:!job.scheduled_at}));
  }
  return result(job.options?.length ? `${staff?`For #${job.job_number}`:`For the ${repairLabel(job)}`}, which option works for you? ${optionText(job.options,context.settings.timezone)}` : staff?`How can I help with request #${job.job_number}?`:`What would you like to know about the ${repairLabel(job)}?`);
}
