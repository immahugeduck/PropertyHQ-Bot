import {workingStaffJob} from './staff-context.js';

const pending=new Set(['awaiting_manager_response','awaiting_tenant_response']);
const open=job=>!['completed','cancelled'].includes(job.status);
export const isReviewPending=job=>pending.has(job?.coordinator_review_status);

export function requiresManagerReview(text='') {
  if(/\b(?:broken|leak(?:ing|s)?|dripping|repair|replace(?:ment)?|not working|won['’]?t (?:turn|start)|no (?:heat|hot water|ac))\b/i.test(text)) return false;
  const asset='(?:spigot|outside tap|outdoor faucet|fence|shed|ceiling fan)';
  const addition=new RegExp('\\b'+asset+'\\b','i').test(text);
  if(!addition) return false;
  return /\b(?:add|install|build|put in)\b/i.test(text)
    || (/\b(?:get|have)\b/i.test(text) && new RegExp("\\b(?:don['’]?t have|do not have|no existing|new|extra|additional)\\s+(?:(?:a|an|any|garden|outdoor|outside)\\s+){0,3}"+asset+'\\b','i').test(text));
}

function commandJob(context,number) {
  const jobs=(context.jobs||[]).filter(open);
  if(number) return jobs.find(j=>String(j.job_number)===number);
  return jobs.length===1?jobs[0]:undefined;
}

export function parseManagerCommand(text='') {
  const send=text.match(/^\s*SEND(?:\s+#(\d{4,}))?:[ \t]?([\s\S]*)$/i);
  if(send) return {type:'send_manager_reply',number:send[1],body:send[2]};
  const approval=text.match(/^\s*APPROVE\s+(INSPECTION|WORK)(?:\s+#(\d{4,}))?[.! ]*$/i);
  if(approval) return {type:'authorize_manager_request',number:approval[2],scope:approval[1].toLowerCase()};
}

export function tenantReviewJob(context) {
  const jobs=(context.jobs||[]).filter(j=>open(j) && j.tenant_id===context.identity.tenantId);
  const previous=context.messages?.find(m=>typeof m.reply==='string' && m.reply.trim());
  const id=previous?.jobId || context.state?.activeJobId;
  const current=id?jobs.find(j=>j.id===id):jobs.length===1?jobs[0]:undefined;
  return isReviewPending(current)?current:undefined;
}

function reviewAcknowledgement(text) {
  const value=text.toLowerCase().replace(/’/g,"'").replace(/[.!?,]/g,' ').replace(/\s+/g,' ').trim();
  const acknowledgement='(?:okay|ok|thanks|thank you|understood|got it|i understand|sounds good)';
  const followup="(?:i|we)(?: will|'ll) let you know(?: if (?:it is something we can afford|we can afford it|we decide to move forward))?";
  return new RegExp('^(?:'+acknowledgement+'(?: '+acknowledgement+'){0,3}(?: '+followup+')?|'+followup+')$').test(value);
}

export function interpretReviewMessage({context,text}) {
  const command=parseManagerCommand(text);
  if(command) {
    const job=commandJob(context,command.number);
    return {type:command.type,jobId:job?.id,fields:command.type==='send_manager_reply'?{body:command.body}:{scope:command.scope}};
  }
  if(context.identity.role==='tenant') {
    const job=tenantReviewJob(context);
    if(job && reviewAcknowledgement(text)) return {type:'acknowledge_review',jobId:job.id,fields:{description:text}};
    if(requiresManagerReview(text)) {
      const same=job && ['spigot','fence','shed','ceiling fan'].some(word=>text.toLowerCase().includes(word) && job.description?.toLowerCase().includes(word));
      return {type:same?'add_details':'request_manager_review',...(same?{jobId:job.id}:{}),fields:{description:text,facts:{issue:'other'}}};
    }
  }
}

export function managerInternalNote({context,text,intent}) {
  if(context.identity.role!=='manager' || !(context.jobs||[]).some(isReviewPending)) return;
  if(['request_status','staff_event'].includes(intent?.type)) return;
  if(/^(?:what|what's|when|where|show|list|check)\b|\bstatus\b/i.test(text)) return;
  const job=workingStaffJob(context,text,intent?.jobId,intent?.type);
  if(job && !isReviewPending(job)) return;
  return {type:'manager_review_note',jobId:job?.id,fields:{description:text}};
}

export function decideManagerCommand({context,intent,nextState}) {
  const result=(reply,actions=[])=>({reply,actions,nextState});
  if(context.identity.role!=='manager') return result('Only your property manager can send a manager decision or approve this request.');
  const job=context.jobs.find(j=>j.id===intent.jobId && open(j));
  if(!job) return result('Which request is this for? Include its request number: SEND #1001: your message, or APPROVE INSPECTION #1001.');
  nextState.activeJobId=job.id;
  if(intent.type==='manager_review_note') return result('I’ve kept that as an internal note. To respond to the tenant, use SEND: followed by your message.',[{type:'manager_review_note',jobId:job.id,fields:{description:context.inbound}}]);
  const command=parseManagerCommand(context.inbound);
  if(!command || command.type!==intent.type || (command.number && command.number!==String(job.job_number))) return result('Please send an explicit SEND: message or APPROVE INSPECTION / APPROVE WORK command for this request.');
  if(command.type==='send_manager_reply') {
    if(!command.body.trim() || [...command.body].length>1600 || command.body!==intent.fields?.body) return result('Please include the tenant’s message after SEND: and keep it within 1,600 characters. I won’t shorten your wording.');
    return result('Your exact message is saved and queued for the tenant.',[{type:'send_manager_reply',jobId:job.id,fields:{body:command.body}}]);
  }
  if(!job.coordinator_review_status || command.scope!==intent.fields?.scope) return result('This command needs a manager-review request and an explicit inspection or work approval.');
  const reply=command.scope==='inspection'
    ? 'Inspection only is approved. I’ll ask maintenance to coordinate a visit; installation still requires separate work approval.'
    : 'Work is approved. I’ll ask maintenance to coordinate the visit.';
  return result(reply,[{type:'authorize_manager_request',jobId:job.id,fields:{scope:command.scope}}]);
}

export function reviewStatus(job) {
  return job.coordinator_review_status==='awaiting_manager_response'
    ? 'Your request is with your property manager for review. I’ll pass along their response here.'
    : 'Your property manager has responded to this request. Send any new information here and I’ll pass it along for review.';
}
