import {validOptions,optionText} from './appointments.js';
import {isReviewPending} from './manager-review.js';
export function decideStaffScheduling({context,job,type,fields,nextState,now}) {
 const result=(reply,actions=[])=>({reply,actions,nextState});
 if(isReviewPending(job)) return result('This request is awaiting manager review and approval before maintenance scheduling.');
 const permission=job.coordinator_details?.entryPermission;
 const label=`${job.tenant_name || 'the tenant'} (#${job.job_number})${job.address?` at ${job.address}`:''}`;
 const expected=permission===true?1:3;
 let options=fields.options;
 if(type==='request_times') {
  options=job.stage==='awaiting_staff' && validOptions(job.options,now)?job.options:context.availableSlots;
  if(permission===undefined) return result(`Entry permission for ${label} is still pending. I’ll wait for the tenant’s answer before arranging the visit.`);
  if(!options || options.length<expected || !validOptions(options.slice(0,expected),now)) return result(`I couldn’t find ${expected===1?'a free visit':'three free visit options'} for ${label} in the recorded calendar. Please provide suitable times.`);
  options=options.slice(0,expected);type='offer_times';
 }
 if(type==='approve_suggestions') {
  const same=JSON.stringify(job.options)===JSON.stringify(options);
  if(job.stage!=='awaiting_staff' || fields.proposalVersion!==job.proposal_version || !same) return result('Those suggestions have changed. Please ask me for the current suggested times.');
 }
 if(!validOptions(options,now)) return result('Please send future visit times, including the day and available hours.');
 if(job.status==='completed' || job.status==='cancelled') return result('That repair is closed. Which open repair should I use?');
 if(type==='confirm_options') {
  const pending=context.state?.pendingOptions;
  if(!pending || pending.jobId!==job.id || JSON.stringify(pending.options.map(o=>[Date.parse(o.start),Date.parse(o.end),!!o.flexible,o.label||null]))!==JSON.stringify(options.map(o=>[Date.parse(o.start),Date.parse(o.end),!!o.flexible,o.label||null]))) return result('Please provide the visit time or options first so I can confirm them with you.');
  if(pending.entryPermission!==permission) {delete nextState.pendingOptions;return result('The tenant’s entry preference has changed. Please review the current scheduling plan with me.');}
 }
 if(permission===undefined) {
  nextState.pendingOptions={jobId:job.id,options,entryPermission:undefined};
  return result(`I’ve kept ${optionText(options,context.settings.timezone)} for ${label}. Entry permission is still pending; I’ll wait for the tenant’s answer before arranging the visit.`);
 }
 if(permission===false && options.length!==3) return result(`${label} needs to be home, so I need three visit options to offer them. You can ask me to suggest times from the recorded calendar.`);
 if(permission===true && (options.some(o=>o.flexible) || options.length!==1)) {
  if(options.some(o=>o.flexible)) return result('Entry is permitted. Please confirm one exact visit time within that availability.');
  options=[...options].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)).slice(0,1);
  type='offer_times'; // A reduced proposal needs a new staff review, never silent approval.
 }
 if(type==='offer_times') {
  delete nextState.pendingStaffOffer;
  nextState.pendingOptions={jobId:job.id,options,entryPermission:permission};
  return result(`For ${label}: ${optionText(options,context.settings.timezone)}. ${permission?'Entry is permitted while nobody is home. Shall I book this visit?':'Shall I send these three visit options to the tenant?'}`);
 }
 delete nextState.pendingOptions;
 const action={type:permission?'book_visit':'offer_times',jobId:job.id,fields:{options,...(type==='approve_suggestions'?{proposalVersion:fields.proposalVersion}:{})}};
 return result(permission?`The visit for ${label} is scheduled. I’ll notify the tenant and keep you updated.`:`I’ve recorded the three options for ${label}. I’ll send them to the tenant to choose.`,[action]);
}
