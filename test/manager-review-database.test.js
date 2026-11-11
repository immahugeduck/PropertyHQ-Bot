import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinatorFixture,contacts as c} from './helpers/coordinator-fixture.js';
import {SPIGOT_REQUEST,MANAGER_REPLY,AFFORDABILITY_ACK} from './helpers/manager-review-example.js';

const create=f=>f.run(c.tenantPhone,SPIGOT_REQUEST);
let sequence=0;
const rawCommit=async(f,phone,message,action)=>{
 const context=await f.context(phone);
 return f.db.query('select public.coordinator_commit($1,$2,$3,$4,$5,$6::jsonb)',[c.user,phone,'SMrawReview'+(++sequence),context.version,message,JSON.stringify({reply:'Fixture',nextState:context.state,actions:[action]})]);
};

test('the full accepted spigot conversation persists one review and sends the exact manager reply once',async()=>{
 const f=await coordinatorFixture();
 try {
  const intake=await create(f);assert.match(intake.reply,/property manager.*review/);
  assert.doesNotMatch(intake.reply,/permission.*enter|schedule/);
  let context=await f.context(c.tenantPhone);assert.equal(context.jobs.length,1);
  const id=context.jobs[0].id;
  assert.equal(context.jobs[0].coordinator_review_status,'awaiting_manager_response');
  assert.equal(context.jobs[0].scheduled_at,null);
  const alerts=await f.outbox(intake.sid);
  assert.equal(alerts.length,1);assert.equal(alerts[0].to_number,c.manager);
  assert.match(alerts[0].body,/How would you like me to respond\?/);
  assert.ok(alerts[0].body.includes(SPIGOT_REQUEST));
  const answer=await f.run(c.manager,'SEND: '+MANAGER_REPLY);
  const sent=await f.outbox(answer.sid);
  assert.equal(sent.length,1);assert.equal(sent[0].to_number,c.tenantPhone);
  assert.equal(sent[0].body,MANAGER_REPLY);assert.equal(sent[0].tenant_id,c.tenant);
  context=await f.context(c.tenantPhone);
  assert.equal(context.jobs[0].coordinator_manager_reply,MANAGER_REPLY);
  assert.equal(context.jobs[0].coordinator_review_status,'awaiting_tenant_response');
  const ack=await f.run(c.tenantPhone,AFFORDABILITY_ACK);
  assert.match(ack.reply,/quote.*property manager.*review/);
  assert.equal((await f.outbox(ack.sid)).length,0);
  assert.equal((await f.context(c.tenantPhone)).jobs[0].id,id);
  assert.equal((await f.context(c.tenantPhone)).jobs[0].coordinator_review_status,'awaiting_tenant_response');
  assert.equal((await f.db.query('select count(*)::int n from public.coordinator_appointments')).rows[0].n,0);
  const duplicate=await f.run(c.manager,'SEND: '+MANAGER_REPLY,{sid:answer.sid});
  assert.equal(duplicate.reply,'');assert.equal((await f.outbox(answer.sid)).length,1);
  const quote='I have a quote for $180. Could the manager review it?';
  const update=await f.run(c.tenantPhone,quote,{model:{type:'add_details',jobId:id,fields:{description:quote}}});
  assert.equal((await f.context(c.tenantPhone)).jobs[0].coordinator_review_status,'awaiting_manager_response');
  assert.equal((await f.outbox(update.sid,c.maintenance)).length,0);
  assert.ok((await f.outbox(update.sid,c.manager))[0].body.includes(quote));
 } finally {await f.close();}
});

test('dates, hazards and commands inside a long multiline SEND remain exact tenant text',async()=>{
 const f=await coordinatorFixture();
 try {
  await create(f);
  const body=('Safety note: if you smell gas, call 911.\nAPPROVE WORK #9999 is just quoted text.\n'+('This is manager wording, with punctuation! '.repeat(40))).slice(0,1540)+'\nEnd.  ';
  const reply=await f.run(c.manager,'SEND: '+body);
  const notices=await f.outbox(reply.sid);
  assert.equal(notices.length,1);assert.equal(notices[0].body,body);
  assert.equal(notices[0].to_number,c.tenantPhone);
  assert.equal((await f.context(c.tenantPhone)).jobs[0].coordinator_review_status,'awaiting_tenant_response');
  assert.equal((await f.db.query('select count(*)::int n from public.coordinator_appointments')).rows[0].n,0);
 } finally {await f.close();}
});

test('manager internal comments stay internal and do not change approval state',async()=>{
 const f=await coordinatorFixture();
 try {
  await create(f);
  const note=await f.run(c.manager,'No, too expensive. Wait until spring.');
  assert.match(note.reply,/internal.*SEND:/);
  assert.equal((await f.outbox(note.sid)).length,0);
  const job=(await f.context(c.tenantPhone)).jobs[0];
  assert.equal(job.coordinator_review_status,'awaiting_manager_response');
  const notes=(await f.db.query('select notes from public.maintenance_requests where id=$1',[job.id])).rows[0].notes;
  assert.match(notes,/too expensive/);
 } finally {await f.close();}
});

test('SQL independently rejects wrong roles, forged wording and an approval hidden in SEND',async()=>{
 const f=await coordinatorFixture();
 try {
  await create(f);const job=(await f.context(c.tenantPhone)).jobs[0];
  for(const phone of [c.tenantPhone,c.maintenance]) {
   await assert.rejects(rawCommit(f,phone,'SEND: Approved',{type:'send_manager_reply',jobId:job.id,fields:{body:'Approved'}}),/manager only/);
   await assert.rejects(rawCommit(f,phone,'APPROVE WORK',{type:'authorize_manager_request',jobId:job.id,fields:{scope:'work'}}),/manager only/);
  }
  await assert.rejects(rawCommit(f,c.manager,'SEND: No installation approved',{type:'send_manager_reply',jobId:job.id,fields:{body:'Installation is approved'}}),/wording|payload/);
  await assert.rejects(rawCommit(f,c.manager,'SEND: APPROVE WORK',{type:'authorize_manager_request',jobId:job.id,fields:{scope:'work'}}),/explicit.*approval|approval command/);
  await assert.rejects(rawCommit(f,c.manager,'SEND #9999: Wrong request',{type:'send_manager_reply',jobId:job.id,fields:{body:'Wrong request'}}),/request number/);
  await assert.rejects(rawCommit(f,c.manager,'SEND: '+'x'.repeat(1601),{type:'send_manager_reply',jobId:job.id,fields:{body:'x'.repeat(1601)}}),/1600/);
  const foreignUser='22222222-2222-4222-8222-222222222222';
  await f.db.query('insert into auth.users values($1)',[foreignUser]);
  const foreign=(await f.db.query("insert into public.maintenance_requests(user_id,property_id,title,description,source,coordinator_review_status) values($1,$2,'Foreign','Private','sms','awaiting_manager_response') returning id",[foreignUser,c.property])).rows[0];
  await assert.rejects(rawCommit(f,c.manager,'SEND: This must stay private',{type:'send_manager_reply',jobId:foreign.id,fields:{body:'This must stay private'}}),/no rows/);
  for(const role of ['anon','authenticated']) {
   await f.db.exec('set role '+role);
   await assert.rejects(f.db.query('select public.coordinator_review_prompt($1,$2)',[c.user,job.id]),/permission denied/);
   await assert.rejects(f.db.query('select public.coordinator_review_tenant_phone($1,$2)',[c.user,job.id]),/permission denied/);
   await f.db.exec('reset role');
  }
  assert.equal((await f.context(c.tenantPhone)).jobs[0].coordinator_review_status,'awaiting_manager_response');
 } finally {await f.close();}
});

test('two pending reviews need a number and SEND body numbers cannot change its recipient',async()=>{
 const f=await coordinatorFixture();
 try {
  await create(f);const first=(await f.context(c.tenantPhone)).jobs[0];
  const secondTenant='55555555-5555-4555-8555-555555555555',secondPhone='+13175552222';
  await f.db.query("insert into public.tenants(id,user_id,property_id,first_name,last_name,email,phone) values($1,$2,$3,'Alex','Fixture','other@example.invalid',$4)",[secondTenant,c.user,c.property,secondPhone]);
  await f.run(secondPhone,'Could we add a new fence?');
  const second=(await f.context(secondPhone)).jobs[0];
  const ambiguous=await f.run(c.manager,'SEND: No installation at this time.');
  assert.match(ambiguous.reply,/Which request/);assert.equal((await f.outbox(ambiguous.sid)).length,0);
  await assert.rejects(rawCommit(f,c.manager,'SEND: This must not guess',{type:'send_manager_reply',jobId:first.id,fields:{body:'This must not guess'}}),/request number|ambiguous/);
  const body='This is about request #'+second.job_number+' as a reference, but it is your reply.';
  const addressed=await f.run(c.manager,'SEND #'+first.job_number+': '+body);
  const notices=await f.outbox(addressed.sid);
  assert.equal(notices.length,1);assert.equal(notices[0].to_number,c.tenantPhone);assert.equal(notices[0].body,body);
  assert.equal((await f.context(secondPhone)).jobs[0].coordinator_review_status,'awaiting_manager_response');
 } finally {await f.close();}
});

test('one review and one ordinary open repair cannot receive an unnumbered manager command',async()=>{
 const f=await coordinatorFixture();
 try {
  await create(f);const job=(await f.context(c.tenantPhone)).jobs[0];
  await f.db.query("insert into public.maintenance_requests(user_id,tenant_id,property_id,title,description,source) values($1,$2,$3,'Faucet repair','The existing faucet is dripping','sms')",[c.user,c.tenant,c.property]);
  for(const [message,action] of [
   ['SEND: Do not guess',{type:'send_manager_reply',jobId:job.id,fields:{body:'Do not guess'}}],
   ['APPROVE WORK',{type:'authorize_manager_request',jobId:job.id,fields:{scope:'work'}}]
  ]) {
   const reply=await f.run(c.manager,message);assert.match(reply.reply,/Which request/);assert.equal((await f.outbox(reply.sid)).length,0);
   await assert.rejects(rawCommit(f,c.manager,message,action),/request number|ambiguous/);
  }
 } finally {await f.close();}
});

test('malformed staff routing cannot weaken the SQL manager-only check',async()=>{
 const f=await coordinatorFixture();
 try {
  await create(f);const job=(await f.context(c.tenantPhone)).jobs[0];
  const context=await f.context(c.tenantPhone);
  await f.db.query("update public.triage_settings set manager_phone='invalid' where user_id=$1",[c.user]);
  await assert.rejects(f.db.query('select public.coordinator_commit($1,$2,$3,$4,$5,$6::jsonb)',[c.user,c.tenantPhone,'SMmalformedReview',context.version,'An injected internal note',JSON.stringify({reply:'Fixture',nextState:context.state,actions:[{type:'manager_review_note',jobId:job.id,fields:{description:'An injected internal note'}}]})]),/staff configuration|manager only/);
 } finally {await f.close();}
});

test('pending review blocks forged scheduling and portal scheduling, even with entry permission',async()=>{
 const f=await coordinatorFixture();
 try {
  await create(f);const job=(await f.context(c.tenantPhone)).jobs[0];
  const options=[{start:'2035-01-02T15:00:00Z',end:'2035-01-02T16:00:00Z'}];
  for(const type of ['offer_times','book_visit','start_work','complete_work','add_details','report_progress','request_scheduling']) {
   await assert.rejects(rawCommit(f,c.maintenance,'Attempt '+type,{type,jobId:job.id,fields:{options,facts:{entryPermission:true},description:'Unapproved'}}),/manager.*approval|manager.*review/);
  }
  await assert.rejects(f.db.query('update public.maintenance_requests set scheduled_at=$2 where id=$1',[job.id,options[0].start]),/manager.*approval|manager.*review/);
  const check=await f.run(c.tenantPhone,'What is happening with the spigot?',{model:{type:'request_status',jobId:job.id,fields:{}}});
  assert.match(check.reply,/property manager/);assert.equal((await f.outbox(check.sid)).length,0);
 } finally {await f.close();}
});

test('inspection authorization starts access coordination, while completion returns to manager review',async()=>{
 const f=await coordinatorFixture();
 try {
  await create(f);
  const approved=await f.run(c.manager,'APPROVE INSPECTION');
  assert.match(approved.reply,/Inspection only/);
  let job=(await f.context(c.tenantPhone)).jobs[0];
  assert.equal(job.coordinator_review_status,'inspection_authorized');assert.equal(job.scheduled_at,null);
  assert.match((await f.outbox(approved.sid,c.maintenance))[0].body,/inspection only|inspection.*separate work approval/i);
  const prompt=(await f.outbox(approved.sid,c.tenantPhone))[0];assert.match(prompt.body,/permission.*enter.*\?/i);
  await f.db.query("update public.coordinator_outbox set status='sent' where id=$1",[prompt.id]);
  const grant=await f.run(c.tenantPhone,'Yes permission granted.');
  await f.db.query("update public.coordinator_outbox set status='sent' where event_sid=$1 and to_number=$2",[grant.sid,c.maintenance]);
  await f.run(c.maintenance,'1');
  job=(await f.context(c.tenantPhone)).jobs[0];assert.ok(job.scheduled_at);
  const finished=await f.run(c.maintenance,'Inspection complete, a plumber would need to install the line.',{model:{type:'complete_work',jobId:job.id,fields:{description:'Inspection complete; plumber needed for installation.'}}});
  job=(await f.context(c.tenantPhone)).jobs[0];
  assert.equal(job.coordinator_review_status,'awaiting_manager_response');assert.equal(job.scheduled_at,null);assert.equal(job.status,'open');
  assert.equal(job.coordinator_details.entryPermission,undefined,'an inspection grant must not become installation access');
  assert.ok((await f.outbox(finished.sid,c.manager)).some(n=>/plumber needed/.test(n.body)));
  assert.equal((await f.outbox(finished.sid,c.maintenance)).length,0);
  await f.run(c.manager,'APPROVE WORK');
  assert.equal((await f.context(c.tenantPhone)).jobs[0].coordinator_review_status,'work_authorized');
 } finally {await f.close();}
});

test('a revoked tenant contact cannot receive an exact manager reply',async()=>{
 const f=await coordinatorFixture();
 try {
  await create(f);const job=(await f.context(c.tenantPhone)).jobs[0];
  await f.db.query('insert into public.coordinator_contacts(user_id,phone,revoked) values($1,$2,true)',[c.user,c.tenantPhone]);
  await assert.rejects(rawCommit(f,c.manager,'SEND: A private decision',{type:'send_manager_reply',jobId:job.id,fields:{body:'A private decision'}}),/verified tenant/);
  assert.equal((await f.db.query('select coordinator_review_status from public.maintenance_requests where id=$1',[job.id])).rows[0].coordinator_review_status,'awaiting_manager_response');
 } finally {await f.close();}
});

test('an explicitly marked form request uses manager-only review routing',async()=>{
 const f=await coordinatorFixture();
 try {
  const row=(await f.db.query("insert into public.maintenance_requests(user_id,tenant_id,property_id,title,description,source,coordinator_review_status) values($1,$2,$3,'New fence','Please add a new fence','app','awaiting_manager_response') returning id",[c.user,c.tenant,c.property])).rows[0];
  const notices=await f.outbox('app-maintenance:'+row.id);
  assert.equal(notices.some(n=>n.to_number===c.maintenance),false);
  assert.ok(notices.some(n=>n.to_number===c.manager && /How would you like me to respond/.test(n.body)));
  const tenant=notices.find(n=>n.to_number===c.tenantPhone);assert.ok(tenant);assert.doesNotMatch(tenant.body,/permission.*enter|schedule.*visit/i);
 } finally {await f.close();}
});

test('an emergency form report bypasses an optional-review marker',async()=>{
 const f=await coordinatorFixture();
 try {
  const row=(await f.db.query("insert into public.maintenance_requests(user_id,tenant_id,property_id,title,description,source,urgency,coordinator_review_status) values($1,$2,$3,'Gas smell','I smell gas','app','emergency','awaiting_manager_response') returning id",[c.user,c.tenant,c.property])).rows[0];
  const saved=(await f.db.query('select coordinator_review_status from public.maintenance_requests where id=$1',[row.id])).rows[0];
  assert.equal(saved.coordinator_review_status,null);
  const notices=await f.outbox('app-maintenance:'+row.id);
  assert.ok(notices.some(n=>n.to_number===c.manager && /EMERGENCY/.test(n.body)));
  assert.ok(notices.some(n=>n.to_number===c.tenantPhone && /emergency services/.test(n.body)));
  assert.equal(notices.some(n=>/How would you like me to respond/.test(n.body)),false);
 } finally {await f.close();}
});

test('a tenant entry refusal during manager review is saved before inspection authorization',async()=>{
 const f=await coordinatorFixture();
 try {
  const text='Please add a wheelchair ramp. Maintenance can enter if nobody is home.';
  await f.run(c.tenantPhone,text,{model:{type:'request_manager_review',fields:{description:text,facts:{issue:'other',entryPermission:true}}}});
  const job=(await f.context(c.tenantPhone)).jobs[0];assert.equal(job.coordinator_details.entryPermission,true);
  const refusal=await f.run(c.tenantPhone,'Do not enter');
  let current=(await f.context(c.tenantPhone)).jobs[0];
  assert.equal(current.coordinator_details.entryPermission,false);assert.equal(current.coordinator_review_status,'awaiting_manager_response');
  assert.equal(current.scheduled_at,null);assert.equal((await f.outbox(refusal.sid,c.maintenance)).length,0);
  // The database must apply the patch independently of bot interpretation too.
  await f.db.query("update public.maintenance_requests set coordinator_details=coordinator_details||'{\"entryPermission\":true}'::jsonb where id=$1",[job.id]);
  await rawCommit(f,c.tenantPhone,'Do not enter',{type:'review_followup',jobId:job.id,fields:{facts:{entryPermission:false},notifyManager:true}});
  current=(await f.context(c.tenantPhone)).jobs[0];assert.equal(current.coordinator_details.entryPermission,false);
  const approval=await f.run(c.manager,'APPROVE INSPECTION');
  const order=(await f.outbox(approval.sid,c.maintenance))[0].body;
  assert.match(order,/NO; arrange access/);assert.doesNotMatch(order,/Entry is permitted|permission.*: YES/i);
  assert.equal((await f.context(c.tenantPhone)).jobs[0].scheduled_at,null);
 } finally {await f.close();}
});

test('an ordinary repair can be confirmed and receive manager progress while a review stays pending',async()=>{
 const f=await coordinatorFixture();
 try {
  await create(f);const review=(await f.context(c.tenantPhone)).jobs[0];
  const repair=(await f.db.query("insert into public.maintenance_requests(user_id,tenant_id,property_id,title,description,source,coordinator_details) values($1,$2,$3,'Faucet repair','Kitchen faucet leaking','sms','{\"issue\":\"sink_disposal\",\"entryPermission\":false}') returning *",[c.user,c.tenant,c.property])).rows[0];
  const options=[{start:'2035-01-02T15:00:00Z',end:'2035-01-02T16:00:00Z'}];
  await f.db.query("insert into public.coordinator_appointments(request_id,user_id,options,proposal_version,stage) values($1,$2,$3,1,'awaiting_selection')",[repair.id,c.user,JSON.stringify(options)]);
  assert.match((await f.run(c.tenantPhone,'1')).reply,/Does that time work for you/);
  assert.match((await f.run(c.tenantPhone,'Sounds good')).reply,/scheduled/);
  assert.ok((await f.context(c.tenantPhone)).jobs.find(j=>j.id===repair.id).scheduled_at);
  const progress=await f.run(c.manager,'The parts for Bree Fixture’s kitchen faucet are ordered.',{model:{type:'report_progress',jobId:repair.id,fields:{description:'The faucet parts are ordered.'}}});
  assert.ok((await f.outbox(progress.sid,c.tenantPhone)).some(n=>/faucet parts are ordered/.test(n.body)));
  const currentReview=(await f.context(c.tenantPhone)).jobs.find(j=>j.id===review.id);
  assert.equal(currentReview.coordinator_review_status,'awaiting_manager_response');assert.equal(currentReview.scheduled_at,null);
 } finally {await f.close();}
});

test('portal status writes cannot start or complete pending review, while cancellation remains available',async()=>{
 const f=await coordinatorFixture();
 try {
  await create(f);const job=(await f.context(c.tenantPhone)).jobs[0];
  for(const status of ['in_progress','completed']) await assert.rejects(f.db.query('update public.maintenance_requests set status=$2 where id=$1',[job.id,status]),/manager.*review|manager.*approval/);
  await f.db.query("update public.maintenance_requests set status='cancelled' where id=$1",[job.id]);
  assert.equal((await f.db.query('select status from public.maintenance_requests where id=$1',[job.id])).rows[0].status,'cancelled');
 } finally {await f.close();}
});

for(const grant of [true,false]) test('portal inspection completion returns findings to review and handles entry '+grant,async()=>{
 const f=await coordinatorFixture();
 try {
  await create(f);const job=(await f.context(c.tenantPhone)).jobs[0];
  await f.db.query('update public.maintenance_requests set coordinator_details=jsonb_build_object(\'entryPermission\',$2::boolean) where id=$1',[job.id,grant]);
  await f.run(c.manager,'APPROVE INSPECTION');
  const start='2035-01-02T15:00:00Z',end='2035-01-02T16:00:00Z';
  await f.db.query("update public.coordinator_appointments set stage='confirmed',start_at=$2,end_at=$3,selected=1 where request_id=$1",[job.id,start,end]);
  await f.db.query("update public.maintenance_requests set status='in_progress',scheduled_at=$2,scheduled_date='2035-01-02' where id=$1",[job.id,start]);
  const findings='Inspection found a plumber is needed to install the line.';
  await f.db.query("update public.maintenance_requests set status='completed',notes=$2 where id=$1",[job.id,findings]);
  const saved=(await f.context(c.tenantPhone)).jobs[0];
  assert.equal(saved.status,'open');assert.equal(saved.coordinator_review_status,'awaiting_manager_response');assert.equal(saved.scheduled_at,null);
  assert.equal(saved.coordinator_details.entryPermission,grant?undefined:false);
  const appointment=(await f.db.query('select stage,options,selected from public.coordinator_appointments where request_id=$1',[job.id])).rows[0];
  assert.equal(appointment.stage,'completed');assert.deepEqual(appointment.options,[]);assert.equal(appointment.selected,null);
  const notices=(await f.db.query("select to_number,body from public.coordinator_outbox where request_id=$1 and event_sid like 'portal-inspection:%'",[job.id])).rows;
  assert.equal(notices.length,2);assert.ok(notices.some(n=>n.to_number===c.manager && n.body.includes(findings)));
  assert.ok(notices.some(n=>n.to_number===c.tenantPhone && /completed the inspection.*manager will review/.test(n.body)));
  assert.equal(notices.some(n=>n.to_number===c.maintenance),false);
  await assert.rejects(f.db.query("update public.maintenance_requests set status='completed' where id=$1",[job.id]),/manager.*review|manager.*approval/);
 } finally {await f.close();}
});
