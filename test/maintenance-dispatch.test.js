import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretMessage} from '../src/assistant.js';
import {decideConversation} from '../src/coordinator.js';

const context=(role='tenant')=>({identity:{role,state:'known',tenantId:'t',propertyId:'p',name:'Bree'},settings:{timezone:'America/Indiana/Indianapolis'},jobs:[{id:'j',job_number:1013,tenant_id:'t',tenant_name:'Bree Fixture',title:'Hot water repair',description:'No hot water',status:'open',coordinator_details:{issue:'other'}}],state:{activeJobId:'j'},messages:[],inbound:''});
async function run(c,text,model) {
 c.inbound=text;
 const intent=await interpretMessage({context:c,text,env:{OPENAI_API_KEY:'fixture'},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(model)}}]})})});
 return decideConversation({context:c,intent});
}
test('a new report cannot inherit old access instructions from a model response',async()=>{
 const c=context();c.jobs[0].coordinator_details={entryPermission:true,accessNotes:'Old permission; sneaky cat.'};
 const d=await run(c,'My water is not getting hot at all',{type:'new_request',fields:{description:'No hot water',facts:{issue:'other',repairSummary:'No hot water',accessNotes:'Maintenance allowed to enter; tenant has a sneaky cat.'}}});
 assert.equal(d.actions[0]?.type,'new_request');assert.equal(d.actions[0].fields.facts.accessNotes,undefined);assert.equal(d.actions[0].fields.facts.entryPermission,undefined);
 assert.doesNotMatch(d.reply,/Maintenance will reach out/i);assert.match(d.reply,/before.*send|permission.*enter/i);
});
test('a new manager-review report cannot inherit old access instructions either',async()=>{
 const c=context();c.jobs[0].coordinator_details={entryPermission:true,accessNotes:'Old lockbox code 1234; sneaky cat.'};
 const d=await run(c,'Could I get a dedicated outlet for an EV?',{type:'request_manager_review',fields:{description:'New EV outlet requested',facts:{issue:'other',accessNotes:'Old lockbox code 1234; sneaky cat.'}}});
 assert.equal(d.actions[0]?.type,'request_manager_review');assert.equal(d.actions[0].fields.facts.accessNotes,undefined);assert.equal(d.actions[0].fields.facts.entryPermission,undefined);
});
test('a manager comment cannot become a fabricated tenant preference or maintenance alert',async()=>{
 const c=context('manager');const text='Please leave me alone lol. Figure out your hot water by yourself';
 const d=await run(c,text,{type:'add_details',jobId:'j',fields:{description:'Tenant prefers no contact and to resolve the hot water issue independently.'}});
 assert.equal(d.actions[0]?.type,'manager_review_note');assert.equal(d.actions[0].fields.description,text);assert.match(d.reply,/internal/i);
});
for(const role of ['manager','maintenance']) test(role+' acknowledgement stays quiet instead of requesting the full notes',async()=>{
 const c=context(role);c.jobs[0].scheduled_at='2035-01-02T15:00:00Z';c.messages=[{reply:'The visit is scheduled.',jobId:'j'}];
 const d=await run(c,'Got it',{type:'request_status',jobId:'j',fields:{}});
 assert.equal(d.reply,'');assert.deepEqual(d.actions,[]);
});
test('a tenant status question while permission is unknown does not promise a staff scheduling ping',async()=>{
 const d=await run(context(),'Any update on the hot water?',{type:'request_status',jobId:'j',fields:{}});
 assert.equal(d.actions.length,0);assert.doesNotMatch(d.reply,/ask maintenance.*times|ask maintenance.*visit/i);
 assert.match(d.reply,/permission.*enter/i);
});
