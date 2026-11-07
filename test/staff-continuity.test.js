import test from 'node:test';
import assert from 'node:assert/strict';
import {decideConversation} from '../src/coordinator.js';
import {interpretMessage} from '../src/assistant.js';
const now=new Date('2026-11-07T17:00:00Z');
const options=[{start:'2026-11-09T14:30:00Z',end:'2026-11-09T15:30:00Z'}];
const one={id:'one',job_number:1007,tenant_id:'t',tenant_name:'Randy Random',address:'12 Oak',title:'Kitchen faucet and disposal',status:'open',coordinator_details:{issue:'sink_disposal'}};
const two={...one,id:'two',job_number:1008,title:'Test note'};
const base=()=>({identity:{role:'maintenance',state:'known'},settings:{timezone:'America/Indiana/Indianapolis'},jobs:[one,two],state:{},messages:[],inbound:''});
const decide=(context,intent)=>decideConversation({context,intent,now});
test('staff offer uses the job in the latest delivered alert, then waits for staff confirmation',()=>{
 const c=base();c.messages=[{reply:'New request #1007 for Randy. Please provide visit options.',jobId:'one'}];
 const d=decide(c,{type:'offer_times',fields:{options}});
 assert.equal(d.nextState.pendingOptions?.jobId,'one');assert.equal(d.actions.length,0);assert.match(d.reply,/Randy/);assert.match(d.reply,/9:30 AM/);
});
test('an explicitly named job overrides the latest staff alert',()=>{
 const c=base();c.messages=[{reply:'New request #1008',jobId:'two'}];
 const d=decide(c,{type:'offer_times',jobId:'one',fields:{options}});assert.equal(d.nextState.pendingOptions.jobId,'one');
});
test('a missing job keeps staff availability until a later job clarification',async()=>{
 const c=base();c.inbound='Schedule for Monday at 9:30 am';let d=decide(c,{type:'offer_times',fields:{options}});
 assert.deepEqual(d.nextState.pendingStaffOffer?.options,options);assert.match(d.reply,/9:30 AM/);assert.equal(d.actions.length,0);
 c.state=d.nextState;c.messages=[{reply:d.reply}];c.inbound='1007';
 const i=await interpretMessage({context:c,text:c.inbound,env:{}});d=decide(c,i);
 assert.equal(d.nextState.pendingOptions?.jobId,'one');assert.deepEqual(d.nextState.pendingOptions.options,options);assert.equal(d.actions.length,0);
});
test('staff add-details replies stay in the staff role and never ask the sender for tenant entry consent',()=>{
 const c=base();c.inbound='The two reports refer to the same kitchen repair.';
 const d=decide(c,{type:'add_details',jobId:'one',fields:{description:c.inbound,facts:{issue:'sink_disposal',entryPermission:true},requestScheduling:true}});
 assert.match(d.reply,/noted|recorded/i);assert.match(d.reply,/Randy/);assert.doesNotMatch(d.reply,/Does maintenance.*permission|follow up with appointment options from maintenance|avoid using the kitchen sink/i);
 assert.equal(d.actions[0].fields.requestScheduling,false);assert.notEqual(d.actions[0].fields.facts?.entryPermission,true);
});
test('duplicate-job clarification retains pending availability and proposes one primary job without merging records',async()=>{
 const c=base();c.state.pendingStaffOffer={options};c.inbound='1007 and 1008 are the same job. It would be for Random Randy';
 const i=await interpretMessage({context:c,text:c.inbound,env:{}});const d=decide(c,i);
 assert.match(d.reply,/1007/);assert.match(d.reply,/1008/);assert.match(d.reply,/Randy/);assert.match(d.reply,/9:30 AM/);
 assert.doesNotMatch(d.reply,/Does maintenance.*permission|merged|deleted/i);assert.equal(d.nextState.pendingOptions?.jobId,'one');assert.deepEqual(d.nextState.pendingOptions.options,options);
 assert.ok(d.actions.every(a=>a.type==='add_details'));
});
test('a natural staff yes confirms only the options just displayed, without changing tenant consent',async()=>{
 const c=base();c.jobs[0].coordinator_details.entryPermission=true;c.state.pendingOptions={jobId:'one',options,entryPermission:true};c.messages=[{reply:'For Randy: Monday at 9:30 AM. Shall I send these visit options to the tenant?',jobId:'one'}];
 const i=await interpretMessage({context:c,text:'Yes, please.',env:{}});const d=decide(c,i);
 assert.equal(d.actions[0]?.type,'book_visit');assert.equal(d.actions[0].jobId,'one');assert.equal(d.actions[0].fields.facts,undefined);
 c.messages=[{reply:'Did the supplier call you?',jobId:'one'}];assert.notEqual((await interpretMessage({context:c,text:'Yes',env:{}})).type,'confirm_options');
});
test('staff cannot attach an offer to an absent job from history',()=>{
 const c=base();c.messages=[{reply:'Foreign account job',jobId:'foreign'}];const d=decide(c,{type:'offer_times',fields:{options}});
 assert.equal(d.nextState.pendingOptions,undefined);assert.ok(d.nextState.pendingStaffOffer);assert.equal(d.actions.length,0);
});
test('staff duplicate handling rejects unrelated tenants and is unavailable to tenants',async()=>{
 const c=base();c.jobs=[one,{...two,tenant_id:'other'}];c.inbound='1007 and 1008 are the same job';
 let i=await interpretMessage({context:c,text:c.inbound,env:{}});let d=decide(c,i);assert.equal(d.actions.length,0);assert.doesNotMatch(d.reply,/I’ve noted/);
 c.identity={role:'tenant',state:'known',tenantId:'t',propertyId:'p'};d=decide(c,{type:'related_jobs',fields:{jobIds:['one','two']}});assert.equal(d.actions.length,0);
});
test('an unknown explicit job reference never falls back to the latest alert',()=>{
 const c=base();c.inbound='For job 9999';c.messages=[{reply:'New request #1008',jobId:'two'}];
 const d=decide(c,{type:'offer_times',fields:{options}});assert.equal(d.nextState.pendingOptions,undefined);assert.equal(d.actions.length,0);
});
test('a duplicate note does not transfer an offer already associated with another tenant',()=>{
 const c=base();c.jobs.push({...one,id:'unrelated',job_number:1009,tenant_id:'other',tenant_name:'Other Tenant'});c.state.pendingOptions={jobId:'unrelated',options};
 const d=decide(c,{type:'related_jobs',fields:{jobIds:['one','two']}});
 assert.doesNotMatch(d.reply,/9:30 AM/);assert.equal(d.nextState.pendingOptions.jobId,'unrelated');
});
test('a negated duplicate statement cannot write an opposite relationship note',async()=>{
 const c=base();c.inbound='1007 and 1008 are not the same job.';
 const i=await interpretMessage({context:c,text:c.inbound,env:{}});const d=decide(c,i);assert.notEqual(i.type,'related_jobs');assert.equal(d.actions.length,0);
});
for(const text of ['Schedule job 1007 for Tuesday at 11 am','Job 1007 is completed']) test(`pending availability does not override a new staff instruction: ${text}`,async()=>{
 const c=base();c.state.pendingStaffOffer={options};
 const expected=text.includes('completed')?{type:'complete_work',jobId:'one',fields:{}}:{type:'offer_times',jobId:'one',fields:{options:[{start:'2026-11-10T16:00:00Z',end:'2026-11-10T17:00:00Z'}]}};
 const i=await interpretMessage({context:c,text,env:{OPENAI_API_KEY:'fixture'},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(expected)}}]})})});
 assert.equal(i.type,expected.type);assert.deepEqual(i.fields.options,expected.fields.options);
});
test('address clarification does not confuse a street number with someone else’s job number',async()=>{
 const c=base();c.jobs=[{...one,tenant_name:'Alice Smith',address:'99 Elm'},{...two,address:'1007 Oak'}];c.state.pendingStaffOffer={options};
 const i=await interpretMessage({context:c,text:'1007 Oak',env:{}});const d=decide(c,i);assert.equal(d.nextState.pendingOptions.jobId,'two');
});
test('a single exact staff time parsed outside options becomes one consistent internal reservation',async()=>{
 const c=base();const i=await interpretMessage({context:c,text:'Schedule for Monday at 9:30 am',env:{OPENAI_API_KEY:'fixture'},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({type:'offer_times',jobId:'one',fields:{appointmentStart:'2026-11-09T09:30:00-05:00',appointmentEnd:'2026-11-07T10:30:00-05:00',options:null}})}}]})})});
 assert.equal(Date.parse(i.fields.options[0].start),Date.parse('2026-11-09T14:30:00Z'));assert.equal(Date.parse(i.fields.options[0].end),Date.parse('2026-11-09T15:30:00Z'));
});
for(const text of ['I can visit Monday after 9:30 am','Monday or Tuesday at 9:30 am']) test(`broad or alternative staff availability is not recovered as an exact appointment: ${text}`,async()=>{
 const c=base();const i=await interpretMessage({context:c,text,env:{OPENAI_API_KEY:'fixture'},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({type:'offer_times',jobId:'one',fields:{appointmentStart:'2026-11-09T09:30:00-05:00',options:null}})}}]})})});
 assert.ok(!i.fields.options?.length);const d=decide(c,i);assert.equal(d.actions.length,0);assert.equal(d.nextState.pendingOptions,undefined);
});
