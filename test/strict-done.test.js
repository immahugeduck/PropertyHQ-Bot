import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretMessage} from '../src/assistant.js';
import {decideConversation} from '../src/coordinator.js';

const context=()=>({identity:{role:'maintenance',state:'known'},settings:{timezone:'America/Indiana/Indianapolis'},jobs:[{id:'j',job_number:1013,title:'Hot water',tenant_id:'t',status:'open'}],state:{activeJobId:'j'},staffFocus:{jobId:'j'},messages:[{reply:'Visit check-in #1013',jobId:'j'}],inbound:''});
const run=async(text,model={type:'complete_work',jobId:'j',fields:{description:'Finished repair'}})=>{const c=context();c.inbound=text;const intent=await interpretMessage({context:c,text,env:{OPENAI_API_KEY:'fixture'},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(model)}}]})})});return decideConversation({context:c,intent});};
for(const text of ['DONE','DONE #1013','DONE Replaced water heater elements.','DONE #1013 Replaced water heater elements.','DONE!','I got it with my little drain tool. I am finished. Thank you. DONE'])test('uppercase DONE can accompany a completed repair note: '+text,async()=>{
 const d=await run(text);assert.equal(d.actions[0]?.type,'complete_work');assert.equal(d.actions[0].jobId,'j');
});
for(const text of ['done','Done','done #1013','DONE 1013','DONE1013','done1013','1013 DONE','DONE#1013','Finished','FINISHED','complete','COMPLETED','DONE show my schedule next week','DONE can I add an event to my schedule'])test('invalid completion text is quiet and creates no actions: '+text,async()=>{
 const d=await run(text,{type:'report_progress',jobId:'j',fields:{description:'A misleading model update'}});assert.equal(d.actions.length,0);assert.equal(d.reply,'');assert.deepEqual(d.nextState,context().state);
});
for(const type of ['report_progress','add_details','staff_event','request_status'])test('invalid completion text cannot bypass the decision guard through '+type,()=>{
 const c=context();c.inbound='done';const d=decideConversation({context:c,intent:{type,jobId:'j',fields:{description:'Wrong update',eventTitle:'Wrong event'}}});assert.equal(d.actions.length,0);assert.equal(d.reply,'');assert.deepEqual(d.nextState,c.state);
});
for(const text of ['done','DONE 1013','The repair is finished.'])test('the decision layer independently blocks a non-command completion: '+text,()=>{
 const c=context();c.inbound=text;const d=decideConversation({context:c,intent:{type:'complete_work',jobId:'j',fields:{description:'Finished'}}});assert.equal(d.actions.length,0);
});
