import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretMessage} from '../src/assistant.js';
import {decideConversation} from '../src/coordinator.js';
import {SPIGOT_REQUEST,MANAGER_REPLY,AFFORDABILITY_ACK} from './helpers/manager-review-example.js';

const now=new Date('2030-01-01T12:00:00Z');
const job=(extra={})=>({id:'review-1',job_number:1001,tenant_id:'t',tenant_name:'Bree',address:'508 Fixture St',title:'Outdoor spigot request',description:SPIGOT_REQUEST,status:'open',coordinator_details:{issue:'other'},coordinator_review_status:'awaiting_manager_response',...extra});
const context=(role='tenant',jobs=[job()])=>({scope:{userId:'u'},identity:{role,state:'known',tenantId:'t',propertyId:'p',name:'Bree'},settings:{timezone:'America/Indiana/Indianapolis'},jobs,state:{activeJobId:jobs[0]?.id},messages:jobs.length?[{reply:'Manager review requested.',jobId:jobs[0].id}]:[],inbound:''});
const decide=(context,intent)=>decideConversation({context,intent,now});
const interpret=async(c,text,model)=>interpretMessage({context:c,text,env:model?{OPENAI_API_KEY:'fixture'}:{},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(model)}}]})})});
const run=async(c,text,model)=>{c.inbound=text;return decide(c,await interpret(c,text,model));};

test('the exact spigot request goes to manager review before asking access or promising a visit',async()=>{
 const c=context('tenant',[]);const d=await run(c,SPIGOT_REQUEST);
 assert.equal(d.actions[0]?.type,'request_manager_review');
 assert.equal(d.actions[0].fields.description,SPIGOT_REQUEST);
 assert.match(d.reply,/property manager.*review|manager.*respond/i);
 assert.doesNotMatch(d.reply,/permission.*enter|schedule.*visit|where.*outside/i);
});

for(const text of ['My kitchen faucet is broken.','The existing garden spigot is dripping.',"I don't have any water at my spigot. Could someone get it working?"]) test(`an ordinary broken fixture retains the maintenance path: ${text}`,async()=>{
 const c=context('tenant',[]);
 const d=await run(c,text,{type:'new_request',fields:{description:text,facts:{issue:'other'}}});
 assert.equal(d.actions[0]?.type,'new_request');
 assert.match(d.reply,/schedule.*visit/i);
});

test('manager SEND preserves the full accepted wording without interpreting conditional approval',async()=>{
 const c=context('manager');const d=await run(c,'SEND: '+MANAGER_REPLY);
 assert.equal(d.actions.length,1);
 assert.equal(d.actions[0].type,'send_manager_reply');
 assert.equal(d.actions[0].jobId,'review-1');
 assert.equal(d.actions[0].fields.body,MANAGER_REPLY);
 assert.equal(d.actions[0].fields.scope,undefined);
});

test('SEND header selects the recipient while numbers, commands and whitespace inside its body stay literal',async()=>{
 const c=context('manager',[job(),job({id:'review-2',job_number:1002,tenant_id:'other'})]);
 const body='Line one\nAPPROVE WORK #1002 at 9 AM.\nKeep this punctuation!  ';
 const d=await run(c,'SEND #1001: '+body);
 assert.equal(d.actions[0]?.type,'send_manager_reply');
 assert.equal(d.actions[0].jobId,'review-1');
 assert.equal(d.actions[0].fields.body,body);
});

for(const text of ['SEND:','SEND:   \n']) test('an empty manager SEND does not create an outbound action: '+JSON.stringify(text),async()=>{
 const d=await run(context('manager'),text);
 assert.equal(d.actions.length,0);assert.match(d.reply,/message|wording/i);
});
test('an overlong exact reply is rejected instead of truncated or queued beyond the SMS limit',async()=>{
 const d=await run(context('manager'),'SEND: '+'x'.repeat(1601));
 assert.equal(d.actions.length,0);assert.match(d.reply,/1,600|1600|shorter/i);
});

for(const role of ['tenant','maintenance']) test(`${role} cannot send a manager decision or approve reviewed work`,async()=>{
 for(const text of ['SEND: Approved for installation.','APPROVE WORK #1001']) {
  const d=await run(context(role),text);
  assert.equal(d.actions.length,0);assert.match(d.reply,/manager/i);
 }
});

test('two pending reviews require a request number for an unnumbered SEND',async()=>{
 const c=context('manager',[job(),job({id:'review-2',job_number:1002,tenant_id:'other'})]);
 const d=await run(c,'SEND: This should not reach the wrong tenant.');
 assert.equal(d.actions.length,0);assert.match(d.reply,/which request|request number/i);
});

test('a review and an ordinary open repair also require a number for manager commands',async()=>{
 const jobs=[job(),job({id:'repair-2',job_number:1002,tenant_id:'other',coordinator_review_status:null})];
 for(const text of ['SEND: Please call me.','APPROVE WORK']) {
  const d=await run(context('manager',jobs),text);
  assert.equal(d.actions.length,0);assert.match(d.reply,/which request|request number/i);
 }
});

test('ordinary manager comments on a review stay internal even if a model would call them progress',async()=>{
 const text='No, too expensive. Wait until spring.';
 const d=await run(context('manager'),text,{type:'report_progress',jobId:'review-1',fields:{description:text}});
 assert.equal(d.actions[0]?.type,'manager_review_note');
 assert.equal(d.actions[0].fields.description,text);
 assert.match(d.reply,/internal.*SEND:/i);
});

for(const scope of ['INSPECTION','WORK']) test(`a separate manager command explicitly authorizes ${scope.toLowerCase()}`,async()=>{
 const d=await run(context('manager'),'APPROVE '+scope+' #1001');
 assert.equal(d.actions[0]?.type,'authorize_manager_request');
 assert.equal(d.actions[0].fields.scope,scope.toLowerCase());
 assert.equal(d.actions[0].fields.options,undefined);
});

test('the affordability acknowledgement stays on the same review without another manager alert',async()=>{
 const c=context('tenant',[job({coordinator_review_status:'awaiting_tenant_response',coordinator_manager_reply:MANAGER_REPLY})]);
 const d=await run(c,AFFORDABILITY_ACK,{type:'new_request',fields:{description:AFFORDABILITY_ACK}});
 assert.equal(d.actions[0]?.type,'review_followup');
 assert.equal(d.actions[0].jobId,'review-1');
 assert.equal(d.actions[0].fields.notifyManager,false);
 assert.match(d.reply,/quote.*property manager.*review/i);
 assert.doesNotMatch(d.reply,/\?|schedule|permission/i);
});
test('an acknowledgement while a submitted quote awaits review does not ask for the quote again',async()=>{
 const c=context('tenant',[job({coordinator_review_status:'awaiting_manager_response',coordinator_manager_reply:MANAGER_REPLY})]);
 const d=await run(c,'Thanks');
 assert.equal(d.actions[0]?.type,'review_followup');
 assert.equal(d.actions[0].fields.notifyManager,false);
 assert.doesNotMatch(d.reply,/send the quote/i);
});
for(const text of ['Okay thanks!','Thanks, I understand.','Sounds good.','Okay I will let you know.']) test('a short acknowledgement stays quiet: '+text,async()=>{
 const c=context('tenant',[job({coordinator_review_status:'awaiting_tenant_response',coordinator_manager_reply:MANAGER_REPLY})]);
 const d=await run(c,text,{type:'new_request',fields:{description:text}});
 assert.equal(d.actions[0]?.type,'review_followup');assert.equal(d.actions[0].fields.notifyManager,false);
});
test('an acknowledgement followed by a new concern still reaches the manager',async()=>{
 const c=context('tenant');const text='Thanks, but I have a quote for $180 now.';
 const d=await run(c,text,{type:'add_details',jobId:'review-1',fields:{description:text}});
 assert.equal(d.actions[0]?.type,'review_followup');assert.equal(d.actions[0].fields.notifyManager,true);
});
test('a manager status question remains a read rather than an internal-note instruction',async()=>{
 const c=context('manager');
 const d=await run(c,'What is the status of request #1001?',{type:'request_status',jobId:'review-1',fields:{}});
 assert.equal(d.actions.length,0);
 assert.match(d.reply,/awaiting manager/i);
 assert.doesNotMatch(d.reply,/internal.*SEND:/i);
});

test('a new quote returns to the manager instead of starting maintenance',async()=>{
 const c=context('tenant',[job({coordinator_review_status:'awaiting_tenant_response',coordinator_manager_reply:MANAGER_REPLY})]);
 const text='I have a quote for $180. Can the manager review it?';
 const d=await run(c,text,{type:'add_details',jobId:'review-1',fields:{description:text}});
 assert.equal(d.actions[0]?.type,'review_followup');
 assert.equal(d.actions[0].fields.notifyManager,true);
 assert.doesNotMatch(d.reply,/permission.*enter|schedule.*visit/i);
});

test('status of a pending review does not request maintenance scheduling',()=>{
 const d=decide(context(),{type:'request_status',jobId:'review-1',fields:{}});
 assert.equal(d.actions.length,0);assert.match(d.reply,/property manager/i);
 assert.doesNotMatch(d.reply,/ask maintenance.*times/i);
});

test('pending manager review cannot receive staff scheduling proposals',()=>{
 const d=decide(context('maintenance'),{type:'offer_times',jobId:'review-1',fields:{options:[{start:'2030-01-02T15:00:00Z',end:'2030-01-02T16:00:00Z'}]}});
 assert.equal(d.actions.length,0);assert.match(d.reply,/manager.*approval|manager.*review/i);
});

test('completing an authorized inspection returns the request to the manager for a work decision',()=>{
 const c=context('maintenance',[job({coordinator_review_status:'inspection_authorized'})]);
 c.inbound='Inspection complete; installation is possible.';
 const d=decide(c,{type:'complete_work',jobId:'review-1',fields:{description:c.inbound}});
 assert.equal(d.actions[0]?.type,'complete_inspection');
 assert.match(d.reply,/manager.*review/i);
});
