import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretMessage} from '../src/assistant.js';
import {decideConversation} from '../src/coordinator.js';
import {workingStaffJob} from '../src/staff-context.js';

const now=new Date('2030-01-01T17:00:00Z');
const options=[14,15,16].map(h=>({start:`2030-01-02T${h}:00:00Z`,end:`2030-01-02T${h+1}:00:00Z`,flexible:false}));
const current={id:'tesla',tenant_id:'t',job_number:1011,title:'Electrical repair',description:'Kitchen outlets and dishwasher lose power while charging a Tesla.',status:'open',coordinator_details:{issue:'other'},options,proposal_version:2,stage:'awaiting_staff'};
const old={id:'old',tenant_id:'t',job_number:1005,title:'Window screen',status:'completed',coordinator_details:{}};
const context=role=>({identity:{role,state:'known',tenantId:'t',propertyId:'p',name:'Randy'},settings:{timezone:'America/Indiana/Indianapolis'},jobs:[current,old],state:{activeJobId:current.id},messages:[{reply:'Does maintenance have permission to enter if nobody’s home?',jobId:current.id}],inbound:''});
async function run(c,text,model,at=now) {
 c.inbound=text;
 const intent=await interpretMessage({context:c,text,now:at,env:model?{OPENAI_API_KEY:'fixture'}:{},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(model)}}]})})});
 return decideConversation({context:c,intent,now:at});
}

test('the exact permission reply with a cat precaution records consent and the access note without verification',async()=>{
 const d=await run(context('tenant'),"Yes that's fine. Just watch out for my cat. He can be sneaky");
 assert.equal(d.actions[0]?.type,'add_details');assert.equal(d.actions[0].jobId,current.id);
 assert.equal(d.actions[0].fields.facts.entryPermission,true);
 assert.match(d.actions[0].fields.facts.accessNotes,/cat.*sneaky/i);assert.doesNotMatch(d.reply,/\?/);
});
for(const text of ['Sure, the dog is crated.','Yes that is fine. Please keep the cat inside.']) test('an entry agreement can include a pet precaution: '+text,async()=>{
 const d=await run(context('tenant'),text);
 assert.equal(d.actions[0]?.fields.facts?.entryPermission,true);assert.doesNotMatch(d.reply,/\?/);
});
for(const text of ["Yes that's fine. But call me first.",'Yes, only after 5 PM.']) test('access restrictions remain saved without unrestricted unattended entry: '+text,async()=>{
 const d=await run(context('tenant'),text);
 assert.notEqual(d.actions[0]?.fields.facts?.entryPermission,true);assert.match(d.actions[0]?.fields.facts?.accessNotes||'',/first|after 5/i);
});
test('initial report captures summary, explicit access and a pet note before asking any question again',async()=>{
 const c=context('tenant');c.jobs=[];c.messages=[];c.state={};
 const text='My washer will not turn on. You can enter while I am away. Please keep my cat inside.';
 const d=await run(c,text,{type:'new_request',fields:{description:text,facts:{issue:'washer',repairSummary:'Washer will not turn on.',accessNotes:'Keep the cat inside.'}}});
 assert.equal(d.actions[0]?.fields.facts?.entryPermission,true);
 assert.equal(d.actions[0].fields.facts.repairSummary,'Washer will not turn on.');
 assert.match(d.actions[0].fields.facts.accessNotes,/cat/i);assert.doesNotMatch(d.reply,/permission.*\?/i);
});
test('a stale closed model job cannot override the staff request in the latest delivered alert',()=>{
 const c=context('maintenance');c.state={activeJobId:old.id};c.messages=[];c.staffFocus={jobId:current.id,scheduleProposal:{jobId:current.id,proposalVersion:2,options}};
 assert.equal(workingStaffJob(c,'Schedule for to morrow morning st 9 am',old.id)?.id,current.id);
});
test('the exact misspelled scheduling instruction books the current permitted request',async()=>{
 const c=context('maintenance');c.jobs=[{...current,coordinator_details:{entryPermission:true}},old];
 c.messages=[];c.state={activeJobId:old.id,pendingOptions:{jobId:old.id,options}};c.staffFocus={jobId:current.id,scheduleProposal:{jobId:current.id,proposalVersion:2,options}};
 const d=await run(c,'Schedule for to morrow morning st 9 am',{type:'clarify',jobId:old.id,fields:{}});
 assert.equal(d.actions[0]?.type,'book_visit');assert.equal(d.actions[0].jobId,current.id);
 assert.equal(d.actions[0].fields.options[0].start,'2030-01-02T14:00:00.000Z');
 assert.equal(d.nextState.pendingOptions,undefined);
});
test('maintenance can select the second displayed slot for a permitted request',async()=>{
 const c=context('maintenance');c.jobs=[{...current,coordinator_details:{entryPermission:true}},old];
 c.messages=[];c.staffFocus={jobId:current.id,scheduleProposal:{jobId:current.id,proposalVersion:2,options}};
 const d=await run(c,'2');
 assert.equal(d.actions[0]?.type,'book_visit');assert.equal(d.actions[0].jobId,current.id);
 assert.equal(d.actions[0].fields.options[0].start,options[1].start);
});
test('a vague yes cannot silently select one of three displayed suggestions',async()=>{
 const c=context('maintenance');c.jobs=[{...current,coordinator_details:{entryPermission:true}}];
 c.messages=[{reply:'Potential schedule times based on your schedule: 1) Jan 2 at 9 AM; 2) Jan 2 at 10 AM; 3) Jan 2 at 11 AM. Reply 1, 2 or 3.',jobId:current.id,scheduleProposal:{jobId:current.id,proposalVersion:2,options}}];
 const d=await run(c,'Yes');assert.equal(d.actions.length,0);assert.match(d.reply,/which|1.*2.*3/i);
});

for(const text of ['Yes, but you need to wait for me to put my dog away.',"Yes that's fine. Don't come in with my cat loose."]) test('a pet restriction cannot authorize unattended entry: '+text,async()=>{
 const d=await run(context('tenant'),text);
 assert.notEqual(d.actions[0]?.fields.facts?.entryPermission,true);assert.match(d.actions[0]?.fields.facts?.accessNotes||'',/dog|cat/i);
});
test('a time reply for a pending private calendar entry cannot book a tenant visit',async()=>{
 const c=context('maintenance');c.jobs=[{...current,coordinator_details:{entryPermission:true}}];
 c.state={activeJobId:current.id,pendingStaffEvent:{title:'Parts pickup'}};
 c.messages=[{reply:'When should I put Parts pickup on the staff calendar?'}];
 const d=await run(c,'Schedule for tomorrow at 9 am');
 assert.equal(d.actions[0]?.type,'staff_event');assert.equal(d.actions[0].fields.eventTitle,'Parts pickup');
});
test('this Wednesday at 9 AM books today when it is Wednesday at 8 AM',async()=>{
 const c=context('maintenance');c.jobs=[{...current,coordinator_details:{entryPermission:true}}];
 const d=await run(c,'Schedule for this Wednesday at 9 am',undefined,new Date('2030-01-02T13:00:00Z'));
 assert.equal(d.actions[0]?.type,'book_visit');assert.equal(d.actions[0].fields.options[0].start,'2030-01-02T14:00:00.000Z');
});
test('a contradictory morning and PM time requires clarification rather than booking',async()=>{
 const c=context('maintenance');c.jobs=[{...current,coordinator_details:{entryPermission:true}}];
 const d=await run(c,'Schedule for tomorrow morning at 9 pm');
 assert.equal(d.actions.length,0);assert.match(d.reply,/confirm.*morning|morning.*evening/i);
});
test('completion addressed to a closed repair cannot be redirected to the current open repair',async()=>{
 const c=context('maintenance');c.jobs=[current,{...old,title:'Window screen repair'}];
 c.messages=[{reply:'New electrical repair request',jobId:current.id}];
 const d=await run(c,'The window screen repair is finished.',{type:'complete_work',jobId:old.id,fields:{description:'Window screen repaired.'}});
 assert.ok(d.actions.every(a=>a.jobId!==current.id));
});
test('a short time follow-up cannot recover a stale closed scheduling target',async()=>{
 const c=context('maintenance');c.jobs=[{...current,coordinator_details:{entryPermission:true}},old];
 c.messages=[{reply:'Current electrical maintenance request',jobId:current.id}];c.state={activeJobId:old.id};
 const d=await run(c,'9 am',{type:'offer_times',jobId:old.id,fields:{options:[options[0]]}});
 assert.equal(d.nextState.pendingOptions?.jobId,current.id);assert.equal(d.nextState.activeJobId,current.id);
});
