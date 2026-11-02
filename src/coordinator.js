import { validOptions, optionText, formatWhen, summarizeJobs } from './appointments.js';
const staffTypes = new Set(['offer_times','confirm_options','start_work','report_progress','complete_work','approve_contact','unlink_contact']);
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
  if (staffTypes.has(type) && !staff) return result('I can help with your maintenance request. Only our staff can make that change.');
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
  if (type==='request_status') return result(summarizeJobs({context,filter:fields.filter,jobId:intent.jobId,now}));
  if (type==='approve_contact' || type==='unlink_contact') {
    if (!/^\+[1-9]\d{7,14}$/.test(fields.phone||'') || (type==='approve_contact' && !clean(fields.tenantId))) return result('Please provide the pending phone number and PropertyHQ tenant ID to approve the link.');
    return result(type==='approve_contact'?'Contact link recorded. Future messages will use that tenant’s property.':'Contact link removed. Future messages will require verification.',[{type,fields:{phone:fields.phone,tenantId:fields.tenantId || null}}]);
  }
  const followUp={when_started:'When did this start?',where_in_home:'Where in your home is this happening?',photo:'Could you send a photo if it’s safe to take one?'}[fields.nextQuestion] || '';
  if (type==='new_request') {
    if (staff) return result('Please ask the tenant to report the issue, or use PropertyHQ to create it for them.');
    if (!context.identity.propertyId) return result('I need our team to confirm which property belongs to your contact before filing this request.');
    if (!clean(fields.description)) return result(`Hi ${context.identity.name || 'there'}! What’s happening with the maintenance issue?`);
    return result(`Thanks, ${context.identity.name || 'there'}! I’ve recorded your maintenance request. ${followUp || 'Our team will provide appointment options here.'}`,[{type,fields:{description:clean(fields.description),category:safety?.category || 'general_maintenance'}}]);
  }
  const job = intent?.jobId ? context.jobs.find(j=>j.id===intent.jobId || String(j.job_number)===String(intent.jobId)) : context.jobs.length===1 ? context.jobs[0] : null;
  if (!job) return result(context.jobs.length ? 'Which request is this about? Please include its job number, or tell me it’s a new issue.' : `Hi ${context.identity.name || 'there'}! What maintenance problem can I help with?`);
  nextState.activeJobId=job.id;
  const action = f=>[{type,jobId:job.id,fields:f}];
  if (type==='offer_times' || type==='confirm_options') {
    if (!validOptions(fields.options,now)) return result('Please send two or three future appointment windows with dates and start/end times.');
    if (type==='offer_times') {
      nextState.pendingOptions={jobId:job.id,options:fields.options};
      return result(`For #${job.job_number}: ${optionText(fields.options,context.settings.timezone)}. Reply CONFIRM OPTIONS to send these to the tenant.`);
    }
    const pending=context.state?.pendingOptions;
    if (!pending || pending.jobId!==job.id || JSON.stringify(pending.options)!==JSON.stringify(fields.options)) return result('Please provide the appointment options first.');
    delete nextState.pendingOptions;
    return result(`I’ve recorded the options for #${job.job_number}. I’ll send them to the tenant.`,[{type:'offer_times',jobId:job.id,fields:{options:fields.options}}]);
  }
  if (type==='choose_time' || type==='select_time') {
    if (staff) return result('The tenant needs to choose one of the proposed options.');
    if (fields.proposalVersion!==job.proposal_version || !Number.isInteger(fields.choice) || !job.options?.[fields.choice-1] || Date.parse(job.options[fields.choice-1].start)<=+now) return result('That option is no longer available. Please choose from the current proposal or ask for alternatives.');
    if (type==='choose_time') {
      nextState.pendingSelection={jobId:job.id,choice:fields.choice,proposalVersion:fields.proposalVersion};
      return result(`You chose ${formatWhen(job.options[fields.choice-1].start,context.settings.timezone)} for #${job.job_number}. Reply CONFIRM to book that time, or ask for other options.`);
    }
    const pending=context.state?.pendingSelection;
    if (!pending || pending.jobId!==job.id || pending.choice!==fields.choice || pending.proposalVersion!==fields.proposalVersion) return result('Please choose a current option first so I can confirm the exact date with you.');
    delete nextState.pendingSelection;
    return result(`You’re confirmed for ${formatWhen(job.options[fields.choice-1].start,context.settings.timezone)} for #${job.job_number}. We’ll keep you updated here.`,action({choice:fields.choice,proposalVersion:fields.proposalVersion}));
  }
  if (type==='request_alternatives') return result('Thanks! I’ll pass your availability to the team for new options.',action({description:clean(fields.description)}));
  if (type==='start_work' || type==='complete_work' || type==='report_progress') {
    if (job.status==='completed' && type!=='complete_work') return result('That job is completed. Please clarify whether a new request is needed.');
    return result(`Recorded for #${job.job_number}. Notifications are queued for the manager and any verified tenant contact.`,action({description:clean(fields.description)}));
  }
  if (type==='add_details') return result(`Thanks, I’ve added that to #${job.job_number}. ${followUp}`,action({description:clean(fields.description)||clean(context.inbound)}));
  return result(job.options?.length ? `For #${job.job_number}, which option works for you? ${optionText(job.options,context.settings.timezone)}` : `How can I help with request #${job.job_number}?`);
}
