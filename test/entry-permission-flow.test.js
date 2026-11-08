import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretMessage} from '../src/assistant.js';
import {decideConversation} from '../src/coordinator.js';
const question='Thanks for letting me know, Randy. We’ll follow up with appointment options from maintenance. Does maintenance have permission to enter if nobody’s home?';
const job={id:'original',tenant_id:'t',job_number:1010,title:'Kitchen faucet and disposal',status:'open',coordinator_details:{issue:'sink_disposal'}};
const base=()=>({identity:{role:'tenant',state:'known',tenantId:'t',propertyId:'p',name:'Randy'},settings:{timezone:'America/Indiana/Indianapolis'},state:{activeJobId:'original'},jobs:[job],messages:[{reply:question,jobId:'original'}]});
for(const text of ['Yes that is fine with me.','Yes lol','Sure, thank you!','Yes, you can.','Yes permission granted.','Yes, permission granted!','YES PERMISSION IS GRANTED.','Permission granted.']) test(`permission answer updates the original repair: ${text}`,async()=>{
 const context=base();context.inbound=text;
 const intent=await interpretMessage({context,text,env:{}});
 const decision=decideConversation({context,intent});
 assert.equal(decision.actions.length,1);assert.equal(decision.actions[0].type,'add_details');assert.equal(decision.actions[0].jobId,'original');assert.equal(decision.actions[0].fields.facts?.entryPermission,true);
 assert.doesNotMatch(decision.reply,/what.*maintenance|\?/i);
});
test('a permission-only answer acknowledges the saved fact without repeating appliance precautions',async()=>{
 const context=base();context.inbound='Yes permission granted.';
 const intent=await interpretMessage({context,text:context.inbound,env:{}});
 const decision=decideConversation({context,intent});
 assert.match(decision.reply,/recorded.*permission/i);
 assert.doesNotMatch(decision.reply,/\?|avoid using|leave.*off/i);
});
test('a passive refusal is saved as refused, rather than asking for the same answer',async()=>{
 const context=base();context.inbound='Permission not granted.';
 const intent=await interpretMessage({context,text:context.inbound,env:{}});
 const decision=decideConversation({context,intent});
 assert.equal(decision.actions[0]?.fields.facts?.entryPermission,false);
 assert.doesNotMatch(decision.reply,/\?/);
});
for(const text of ['Yes permission granted, but call me first.','Permission granted only if I am home.','Permission granted?','Yes permission granted after 5.']) test(`permission wording must not erase a restriction or question: ${text}`,async()=>{
 const context=base();context.inbound=text;
 const intent=await interpretMessage({context,text,env:{}});
 assert.notEqual(intent.fields?.facts?.entryPermission,true);
});
test('passive permission and a short yes are not answers to a scheduling question',async()=>{
 const context=base();context.messages=[{reply:'Does Tuesday work for you?',jobId:'original'}];
 for(const text of ['Permission granted.','Yes']) {
  const intent=await interpretMessage({context,text,env:{}});
  assert.notEqual(intent.fields?.facts?.entryPermission,true);
 }
});
for(const text of ['You can enter if nobody is home, but only after 5 PM.','You have my permission to enter. But call me first.']) test(`an absence condition does not erase another access restriction: ${text}`,async()=>{
 const context=base();context.inbound=text;
 const intent=await interpretMessage({context,text,env:{}});
 assert.notEqual(intent.fields?.facts?.entryPermission,true);
});
test('a reply to a repeated permission question uses the active repair when its log has no job id',async()=>{
 const context=base();context.messages=[{message:'Unrelated previous inbound'},{reply:question,jobId:null}];
 const intent=await interpretMessage({context,text:'Yes that is fine with me.',env:{}});
 assert.equal(intent.type,'add_details');assert.equal(intent.jobId,'original');assert.equal(intent.fields.facts.entryPermission,true);
});
for(const text of ['Yes, but call me first.','Yes, only after 5.','Maybe, I need to check.']) test(`unclear entry restrictions do not become a new request: ${text}`,async()=>{
 const context=base();context.inbound=text;
 const intent=await interpretMessage({context,text,env:{OPENAI_API_KEY:'fixture'},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({type:'new_request',fields:{description:text}})}}]})})});
 const decision=decideConversation({context,intent});
 assert.ok(decision.actions.every(a=>a.type!=='new_request' && a.fields?.facts?.entryPermission!==true));
 assert.match(decision.reply,/permission|enter/i);
});
test('an unrelated new repair after an entry question is still allowed',async()=>{
 const context=base();context.inbound='Also, my bedroom window is broken.';
 const intent=await interpretMessage({context,text:context.inbound,env:{OPENAI_API_KEY:'fixture'},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({type:'new_request',fields:{description:context.inbound,facts:{issue:'window_screen'}}})}}]})})});
 assert.equal(decideConversation({context,intent}).actions[0].type,'new_request');
});
test('a mixed permission answer and new repair cannot copy permission to the new repair',async()=>{
 const context=base();context.inbound='You have my permission to enter. Also, the bedroom window screen is torn.';
 const intent=await interpretMessage({context,text:context.inbound,env:{OPENAI_API_KEY:'fixture'},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({type:'new_request',fields:{description:'Bedroom window screen is torn',facts:{issue:'window_screen',entryPermission:true}}})}}]})})});
 const decision=decideConversation({context,intent});
 assert.equal(decision.actions[0]?.type,'new_request');
 assert.notEqual(decision.actions[0].fields.facts.entryPermission,true);
});
test('entry permission is not copied to an unrelated tenant or completed repair',async()=>{
 for(const replacement of [{...job,tenant_id:'someone-else'},{...job,status:'completed'}]) {
  const context=base();context.jobs=[replacement];
  const intent=await interpretMessage({context,text:'Yes that is fine with me.',env:{}});
  assert.notEqual(intent.fields?.facts?.entryPermission,true);
 }
});
test('a rephrased issue cannot create another job when the model loses the pending-question thread',async()=>{
 const context=base();context.inbound="? It's still leaking? I'm not sure where. Garbage disowwl won't turn on.";
 const intent=await interpretMessage({context,text:context.inbound,env:{OPENAI_API_KEY:'fixture'},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({type:'new_request',fields:{description:context.inbound,facts:{leakPattern:'uncertain'}}})}}]})})});
 const decision=decideConversation({context,intent});
 assert.equal(decision.actions.length,0);assert.match(decision.reply,/same repair|different repair/i);
 context.state=decision.nextState;context.messages=[{reply:decision.reply,jobId:'original'}];context.inbound='Yes, same repair.';
 const confirmed=await interpretMessage({context,text:context.inbound,env:{}});
 const update=decideConversation({context,intent:confirmed});
 assert.equal(update.actions[0]?.type,'add_details');assert.equal(update.actions[0].jobId,'original');assert.match(update.actions[0].fields.description,/still leaking/);assert.notEqual(update.actions[0].fields.facts?.entryPermission,true);
});
test('the parenthetical debug reference does not create a repair even if the model would',async()=>{
 const context=base();context.inbound='(test 123 fix above)';
 const intent=await interpretMessage({context,text:context.inbound,env:{OPENAI_API_KEY:'fixture'},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({type:'new_request',fields:{description:context.inbound}})}}]})})});
 assert.equal(decideConversation({context,intent}).actions.length,0);
});
for(const text of ['I have a broken bedroom window.','I need my bedroom window repaired.']) test(`a distinct repair is not consumed by permission clarification: ${text}`,async()=>{
 const context=base();context.inbound=text;
 const intent=await interpretMessage({context,text,env:{OPENAI_API_KEY:'fixture'},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({type:'new_request',fields:{description:text,facts:{issue:'window_screen'}}})}}]})})});
 const decision=decideConversation({context,intent});assert.equal(decision.actions[0]?.type,'new_request');
});
