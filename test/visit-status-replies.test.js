import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretMessage} from '../src/assistant.js';
import {decideConversation} from '../src/coordinator.js';

const context=()=>({identity:{role:'maintenance',state:'known'},settings:{timezone:'America/Indiana/Indianapolis'},jobs:[{id:'hot',job_number:1013,title:'Hot water',status:'open',tenant_id:'t',coordinator_details:{repairSummary:'No hot water.'}},{id:'screen',job_number:1005,title:'Window screen',status:'open',tenant_id:'t'}],state:{activeJobId:'screen'},staffFocus:{jobId:'hot'},messages:[{reply:'Visit check-in #1013: No hot water. Reply DONE or DONE #1013 when finished, or send a progress update.',jobId:'hot'}]});
const run=async(c,text)=>{c.inbound=text;const intent=await interpretMessage({context:c,text,env:{},fetchImpl:async()=>{throw Error('No model needed');}});return decideConversation({context:c,intent});};
for(const text of ['DONE','DONE #1013']) test('staff completion stays on the prompted repair: '+text,async()=>{
 const c=context(),d=await run(c,text);assert.equal(d.actions[0]?.type,'complete_work');assert.equal(d.actions[0].jobId,'hot');
});
test('an unknown explicit completion number never closes the focused request',async()=>{
 const d=await run(context(),'DONE #9999');assert.equal(d.actions.length,0);assert.match(d.reply,/which|find|request|number/i);
});
test('a negative completion reply remains progress and leaves the request open',async()=>{
 const d=await run(context(),'Not finished yet. I need a replacement part.');assert.equal(d.actions[0]?.type,'report_progress');assert.equal(d.actions[0].jobId,'hot');assert.match(d.actions[0].fields.description,/replacement part/);
});
test('a tenant cannot complete a repair with the maintenance command',async()=>{
 const c=context();c.identity={role:'tenant',state:'known',tenantId:'t',propertyId:'p'};const d=await run(c,'DONE #1013');assert.equal(d.actions.length,0);
});
test('repeating completion acknowledges the already finished repair without new notifications',async()=>{
 const c=context();c.jobs[0].status='completed';const d=await run(c,'DONE #1013');assert.equal(d.actions.length,0);assert.match(d.reply,/already.*complete/i);
});
test('ambiguous completion without a delivered focus asks which repair',async()=>{
 const c=context();c.messages=[];c.staffFocus=undefined;c.state={};const d=await run(c,'DONE');assert.equal(d.actions.length,0);assert.match(d.reply,/which.*request|which.*repair/i);
});
for(const text of ['DONE','Not finished yet. I need a replacement part.']) test('a reply to a cancelled check-in never updates the other open repair: '+text,async()=>{
 const c=context();c.jobs[0].status='cancelled';const d=await run(c,text);assert.equal(d.actions.length,0);assert.match(d.reply,/cancelled|which|no longer/i);
});
for(const text of ['DONE','Not finished yet. I need a replacement part.']) test('a deleted prompted request never redirects a status reply to another repair: '+text,async()=>{
 const c=context();c.jobs=c.jobs.filter(j=>j.id!=='hot');const d=await run(c,text);assert.equal(d.actions.length,0);assert.match(d.reply,/which|find|no longer|request/i);
});
for(const text of ['DONE','Not finished yet.']) test('a deleted check-in with a cleared SMS job link still blocks retargeting: '+text,async()=>{
 const c=context();c.jobs=c.jobs.filter(j=>j.id!=='hot');c.messages[0].jobId=null;c.staffFocus={jobId:'screen'};const d=await run(c,text);assert.equal(d.actions.length,0);
});
for(const text of ['Internal staff note, do not send to tenant: not finished; manager needs to review the contractor dispute.','Not finished yet. Do not text the tenant about this internal update.']) test('explicit private progress stays a staff note: '+text,async()=>{
 const d=await run(context(),text);assert.equal(d.actions[0]?.type,'add_details');assert.equal(d.actions[0].fields.description,text);
});
test('an unrelated sentence containing not-finished wording is not automatically tenant-facing progress',async()=>{
 const d=await run(context(),'We should discuss how requests marked not finished are reviewed by the company.');assert.equal(d.actions.length,0);
});
test('a pending staff-only calendar task cannot turn not-finished into a tenant update',async()=>{
 const c=context();c.state.pendingStaffEvent={title:'Parts pickup'};c.messages=[{reply:'When should I put parts pickup on your staff calendar?'}];const d=await run(c,'Not finished yet.');assert.equal(d.actions.length,0);
});
