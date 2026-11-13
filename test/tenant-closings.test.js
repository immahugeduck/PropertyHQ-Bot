import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretMessage} from '../src/assistant.js';
import {decideConversation} from '../src/coordinator.js';
import {summarizeJobs} from '../src/appointments.js';

const ending='If anything else comes up let us know, thank you. Have a good day!';
const context=(status='open')=>({identity:{role:'tenant',state:'known',tenantId:'t',propertyId:'p',name:'Bree'},settings:{timezone:'America/Indiana/Indianapolis'},jobs:[{id:'j',job_number:1013,tenant_id:'t',title:'Hot water',status,scheduled_at:'2026-11-13T15:00:00Z',coordinator_details:{issue:'other',entryPermission:true}}],state:{activeJobId:'j'},messages:[{reply:'Here’s the latest: Replaced water heater elements.',jobId:'j'}],inbound:''});
const run=async(c,text,model)=>{c.inbound=text;const intent=await interpretMessage({context:c,text,env:{OPENAI_API_KEY:'fixture'},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(model)}}]})})});return decideConversation({context:c,intent});};
for(const status of ['open','completed'])for(const text of ['Okay thank you!','Thanks!','Thank you, have a good day!','Thank you so much!','Have a good day! Thank you!','Thanks for the update.','Much appreciated, take care!'])test('tenant closing stays warm without a status recap: '+status+' '+text,async()=>{
 const d=await run(context(status),text,{type:'request_status',jobId:'j',fields:{}});assert.ok(d.reply.endsWith(ending));assert.doesNotMatch(d.reply,/scheduled|which|\?|#1013|Fri|November/i);assert.equal(d.actions.length,0);assert.equal(d.replyJobId,'j');
});
test('thanks with a real repair update is not swallowed as a closing',async()=>{
 const d=await run(context(),'Thanks, but the water is still cold.',{type:'add_details',jobId:'j',fields:{description:'Water is still cold.',facts:{issue:'other'}}});assert.equal(d.actions[0]?.type,'add_details');
});
test('a completed tenant status answer ends with the requested sign-off',()=>{
 assert.ok(summarizeJobs({context:context('completed'),jobId:'j'}).endsWith(ending));
});
