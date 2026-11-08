import test from 'node:test';
import assert from 'node:assert/strict';
import {decideConversation} from '../src/coordinator.js';
import {interpretMessage} from '../src/assistant.js';
const now=new Date('2030-01-01T12:00:00Z');
const options=[1,2,3].map(n=>({start:`2030-01-0${n+1}T15:00:00Z`,end:`2030-01-0${n+1}T16:00:00Z`,flexible:false}));
const base=(permission)=>({identity:{role:'maintenance',state:'known'},settings:{timezone:'America/Indiana/Indianapolis'},state:{},messages:[],availableSlots:options,jobs:[{id:'j',job_number:1001,tenant_id:'t',tenant_name:'Sarah',title:'Washer',status:'open',coordinator_details:permission===undefined?{}:{entryPermission:permission},options:permission===true?[options[0]]:options,stage:'awaiting_staff',proposal_version:4}],inbound:''});
const decide=(context,intent)=>decideConversation({context,intent,now});
test('all ordinary tenant intakes acknowledge scheduling and ask absent-entry permission',()=>{const c=base();c.identity={role:'tenant',state:'known',tenantId:'t',propertyId:'p',name:'Sarah'};for(const facts of [{},{issue:'screen_door'},{issue:'washer'}]){const d=decide(c,{type:'new_request',fields:{description:'A repair is needed',facts}});assert.match(d.reply,/maintenance will reach out.*schedule/i);assert.match(d.reply,/permission.*enter/i);}});
test('permission granted: staff approval books one visit without asking the tenant to choose',()=>{const c=base(true);const d=decide(c,{type:'approve_suggestions',jobId:'j',fields:{options:[options[0]],proposalVersion:4}});assert.equal(d.actions[0]?.type,'book_visit');assert.match(d.reply,/scheduled|booked/i);assert.equal(d.actions[0].fields.options.length,1);});
test('permission refused: staff approves three options for tenant choice',()=>{const c=base(false);const d=decide(c,{type:'approve_suggestions',jobId:'j',fields:{options,proposalVersion:4}});assert.equal(d.actions[0]?.type,'offer_times');assert.equal(d.actions[0].fields.options.length,3);});
test('unknown permission does not book or send options to the tenant',()=>{const c=base();const d=decide(c,{type:'offer_times',jobId:'j',fields:{options:[options[0]]}});c.state=d.nextState;const approved=decide(c,{type:'confirm_options',jobId:'j',fields:{options:[options[0]]}});assert.equal(approved.actions.length,0);assert.match(approved.reply,/permission.*pending|await.*permission/i);});
test('a tenant requiring presence cannot receive fewer than three approved options',()=>{const d=decide(base(false),{type:'offer_times',jobId:'j',fields:{options:[options[0]]}});assert.equal(d.actions.length,0);assert.match(d.reply,/three|3/);});
test('private suggestions require the latest suggestion question and current proposal version',async()=>{const c=base(true);c.messages=[{reply:'Suggested visit: Wednesday at 10. Shall I book this visit?',jobId:'j',scheduleProposal:{jobId:'j',options:[options[0]],proposalVersion:4}}];const i=await interpretMessage({context:c,text:'Yes, please.',env:{}});assert.equal(i.type,'approve_suggestions');assert.equal(decide(c,i).actions[0]?.type,'book_visit');assert.equal(decide(c,{...i,fields:{...i.fields,proposalVersion:3}}).actions.length,0);});
test('tenants cannot approve private staff suggestions or obtain staff calendar openings',()=>{const c=base(true);c.identity={role:'tenant',state:'known',tenantId:'t',propertyId:'p'};for(const type of ['approve_suggestions','request_times']) assert.equal(decide(c,{type,jobId:'j',fields:{options:[options[0]],proposalVersion:4}}).actions.length,0);});
test('permission change invalidates a pending manual staff approval',()=>{const c=base(false);c.state.pendingOptions={jobId:'j',options,entryPermission:true};const d=decide(c,{type:'confirm_options',jobId:'j',fields:{options}});assert.equal(d.actions.length,0);assert.match(d.reply,/permission.*changed|entry preference.*changed/i);});
test('no free openings remains a staff conversation without invented availability',()=>{const c=base(false);c.jobs[0].options=[];c.availableSlots=[];const d=decide(c,{type:'request_times',jobId:'j',fields:{}});assert.equal(d.actions.length,0);assert.match(d.reply,/couldn’t|cannot|no.*open|not.*find/i);});
test('a manual visit review takes precedence over a different stored calendar suggestion',async()=>{const c=base(true);c.state.pendingOptions={jobId:'j',options:[options[1]],entryPermission:true};c.messages=[{reply:'For Sarah: Thursday at 10. Entry is permitted while nobody is home. Shall I book this visit?',jobId:'j'}];const i=await interpretMessage({context:c,text:'Yes',env:{}});assert.equal(i.type,'confirm_options');assert.deepEqual(i.fields.options,[options[1]]);});
test('tenant numeric reply selects only staff-approved choices, never confirmed or private slots',async()=>{const c=base(false);c.identity={role:'tenant',state:'known',tenantId:'t',propertyId:'p'};c.jobs[0].stage='awaiting_selection';c.jobs.push({...c.jobs[0],id:'already',stage:'confirmed'},{...c.jobs[0],id:'private',stage:'awaiting_staff'});const i=await interpretMessage({context:c,text:'2',env:{}});assert.equal(i.type,'choose_time');assert.equal(i.jobId,'j');});
test('approval uses the suggestion actually shown, not a replacement generated later',async()=>{const c=base(true);c.jobs[0].options=[options[1]];c.jobs[0].proposal_version=5;c.messages=[{reply:'Suggested visit: Wednesday at 10. Shall I book this visit?',jobId:'j',scheduleProposal:{jobId:'j',options:[options[0]],proposalVersion:4}}];const i=await interpretMessage({context:c,text:'Yes',env:{}});const d=decide(c,i);assert.equal(d.actions.length,0);assert.match(d.reply,/changed|current/i);});
test('asking for suggestions after expiry uses current free openings instead of the expired proposal',()=>{const c=base(true);c.jobs[0].options=[{start:'2020-01-01T15:00:00Z',end:'2020-01-01T16:00:00Z'}];const d=decide(c,{type:'request_times',jobId:'j',fields:{}});assert.deepEqual(d.nextState.pendingOptions.options,[options[0]]);assert.equal(d.actions.length,0);});

test('requesting alternative times saves new availability and clears the pending choice',()=>{
 const c=base(false);c.identity={role:'tenant',state:'known',tenantId:'t',propertyId:'p'};
 c.state.pendingSelection={jobId:'j',choice:1,proposalVersion:4};
 const d=decide(c,{type:'request_alternatives',jobId:'j',fields:{description:'Those times do not work; weekdays after 4.',facts:{availability:'Weekdays after 4 PM',entryPermission:null}}});
 assert.equal(d.nextState.pendingSelection,undefined);
 assert.equal(d.actions[0]?.type,'request_alternatives');
 assert.deepEqual(d.actions[0].fields.facts,{availability:'Weekdays after 4 PM'});
});

test('an explicit access change carried with alternative times is not discarded',()=>{
 const c=base(true);c.identity={role:'tenant',state:'known',tenantId:'t',propertyId:'p'};
 const d=decide(c,{type:'request_alternatives',jobId:'j',fields:{description:'Arrange an attended visit after 4.',facts:{availability:'After 4 PM',entryPermission:false}}});
 assert.equal(d.actions[0]?.fields.facts?.entryPermission,false);
 assert.equal(d.actions[0].fields.facts.availability,'After 4 PM');
});
