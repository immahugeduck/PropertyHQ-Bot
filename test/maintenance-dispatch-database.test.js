import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinatorFixture,contacts as c} from './helpers/coordinator-fixture.js';

const intake=f=>f.run(c.tenantPhone,'My water is not getting hot at all',{model:{type:'new_request',fields:{description:'Tenant reports no hot water.',facts:{issue:'other',repairSummary:'No hot water in the home.'}}}});
const notices=async(f,id)=>(await f.db.query('select * from public.coordinator_outbox where user_id=$1 and request_id=$2 and to_number=$3 order by created_at,id',[c.user,id,c.maintenance])).rows;
const sent=async(f,id)=>f.db.query("update public.coordinator_outbox set status='sent' where id=$1",[id]);
let seq=0;
async function raw(f,phone,text,action){const context=await f.context(phone);return f.db.query('select public.coordinator_commit($1,$2,$3,$4,$5,$6::jsonb)',[c.user,phone,'SMdispatchRaw'+(++seq),context.version,text,JSON.stringify({reply:'Fixture',nextState:context.state,actions:[action]})]);}

test('ordinary intake waits for permission and sends exactly one complete maintenance request',async()=>{
 const f=await coordinatorFixture();try {
  const created=await intake(f);const job=(await f.context(c.tenantPhone)).jobs[0];
  assert.equal((await f.outbox(created.sid,c.maintenance)).length,0);assert.equal((await f.outbox(created.sid,c.manager)).length,1);
  const granted=await f.run(c.tenantPhone,'Yes. I should be home but you do have permission');
  let rows=await notices(f,job.id);assert.equal(rows.length,1);assert.match(rows[0].body,/New maintenance request/);assert.match(rows[0].body,/permission to enter.*YES/);
  assert.equal(rows[0].schedule_proposal.options.length,3);assert.equal((await f.context(c.tenantPhone)).jobs.length,1);
  const repeat=await f.run(c.tenantPhone,'Yes permission granted.');rows=await notices(f,job.id);assert.equal(rows.length,1);assert.equal((await f.outbox(repeat.sid,c.maintenance)).length,0);assert.equal((await f.outbox(repeat.sid,c.manager)).length,0,'unchanged consent must not repeat a manager alert');
  const duplicate=await f.run(c.tenantPhone,'Yes. I should be home but you do have permission',{sid:granted.sid});assert.equal(duplicate.reply,'');assert.equal((await notices(f,job.id)).length,1);
 } finally {await f.close();}
});
test('an explicit grant in the initial report sends one request immediately',async()=>{
 const f=await coordinatorFixture();try {
  const text='The washer will not turn on. Maintenance may enter if nobody is home.';
  const created=await f.run(c.tenantPhone,text,{model:{type:'new_request',fields:{description:'Washer will not turn on.',facts:{issue:'washer'}}}});
  const job=(await f.context(c.tenantPhone)).jobs[0];assert.equal(job.coordinator_details.entryPermission,true);
  assert.equal((await notices(f,job.id)).length,1);assert.doesNotMatch(created.reply,/permission.*\?/i);
 } finally {await f.close();}
});
test('details arriving before delivery update the pending request instead of queuing another text',async()=>{
 const f=await coordinatorFixture();try {
  await intake(f);await f.run(c.tenantPhone,'Yes permission granted.');const job=(await f.context(c.tenantPhone)).jobs[0];
  await f.run(c.tenantPhone,'You can enter. Please keep my cat inside.');
  const rows=(await notices(f,job.id)).filter(n=>n.status!=='cancelled');assert.equal(rows.length,1);assert.equal(rows[0].status,'queued');assert.match(rows[0].body,/cat inside/i);
  const audit=(await f.db.query("select body from public.sms_messages where user_id=$1 and status like $2",[c.user,'outbox:'+rows[0].id+':%'])).rows[0];assert.equal(audit.body,rows[0].body);
 } finally {await f.close();}
});
test('repair details collected while waiting for permission survive in the single dispatch',async()=>{
 const f=await coordinatorFixture();try {
  await intake(f);const job=(await f.context(c.tenantPhone)).jobs[0];
  const detail='The upstairs bathroom has cold water; the kitchen is warm.';
  await f.run(c.tenantPhone,detail,{model:{type:'add_details',jobId:job.id,fields:{description:detail,facts:{issue:'other'}}}});
  assert.equal((await notices(f,job.id)).length,0);
  await f.run(c.tenantPhone,'Yes permission granted.');
  const rows=await notices(f,job.id);assert.equal(rows.length,1);assert.match(rows[0].body,/upstairs bathroom.*kitchen is warm/i);
 } finally {await f.close();}
});
test('multiple material updates coalesce without losing a queued repair detail',async()=>{
 const f=await coordinatorFixture();try {
  await intake(f);await f.run(c.tenantPhone,'Yes permission granted.');const job=(await f.context(c.tenantPhone)).jobs[0];await sent(f,(await notices(f,job.id))[0].id);
  const detail='The hot tap in the upstairs bathroom is also dripping.';
  await f.run(c.tenantPhone,detail,{model:{type:'add_details',jobId:job.id,fields:{description:detail,facts:{issue:'other'}}}});
  await f.run(c.tenantPhone,'You can enter. Please keep my cat inside.');
  const rows=(await notices(f,job.id)).filter(n=>n.status==='queued');assert.equal(rows.length,1);assert.match(rows[0].body,/upstairs bathroom.*dripping/i);assert.match(rows[0].body,/cat inside/i);assert.doesNotMatch(rows[0].body,/New maintenance request/);
 } finally {await f.close();}
});
test('dispatch helper rejects another account and public client roles',async()=>{
 const f=await coordinatorFixture();try {
  await intake(f);const job=(await f.context(c.tenantPhone)).jobs[0];
  await assert.rejects(f.db.query('select public.coordinator_queue_maintenance($1,$2,$3)',['22222222-2222-4222-8222-222222222222',job.id,'SMforeign']),/no rows/);
  for(const role of ['anon','authenticated']) {
   await f.db.exec('set role '+role);await assert.rejects(f.db.query('select public.coordinator_queue_maintenance($1,$2,$3)',[c.user,job.id,'SMpublic']),/permission denied/);await f.db.exec('reset role');
  }
  assert.equal((await notices(f,job.id)).length,0);
 } finally {await f.close();}
});
test('a real access update after delivery is concise and leaves the displayed slots valid',async()=>{
 const f=await coordinatorFixture();try {
  await intake(f);await f.run(c.tenantPhone,'Yes permission granted.');const job=(await f.context(c.tenantPhone)).jobs[0];const initial=(await notices(f,job.id))[0];await sent(f,initial.id);
  const before=(await f.context(c.maintenance)).jobs.find(j=>j.id===job.id);
  const update=await f.run(c.tenantPhone,'You can enter. Please keep my cat inside.');
  const rows=await f.outbox(update.sid,c.maintenance);assert.equal(rows.length,1);assert.match(rows[0].body,/cat inside/i);assert.doesNotMatch(rows[0].body,/New maintenance request|Requesting maintenance repair for/);
  assert.equal((await f.context(c.maintenance)).jobs.find(j=>j.id===job.id).proposal_version,before.proposal_version);
  await sent(f,rows[0].id);assert.match((await f.run(c.maintenance,'2')).reply,/scheduled/);
 } finally {await f.close();}
});
test('permission revoked before the first delivery cancels the pending work order',async()=>{
 const f=await coordinatorFixture();try {
  await intake(f);await f.run(c.tenantPhone,'Yes permission granted.');const job=(await f.context(c.tenantPhone)).jobs[0];
  await f.run(c.tenantPhone,'Do not enter');const rows=await notices(f,job.id);assert.equal(rows.filter(n=>n.status!=='cancelled').length,0);
 } finally {await f.close();}
});
test('a pet note cannot cancel a tenant-confirmed attended visit before dispatch',async()=>{
 const f=await coordinatorFixture();try {
  await intake(f);await f.run(c.tenantPhone,'No');const job=(await f.context(c.manager)).jobs[0];
  await f.run(c.manager,'Arrange an attended visit',{model:{type:'offer_times',jobId:job.id,fields:{options:job.options}}});await f.run(c.manager,'Yes');
  await f.run(c.tenantPhone,'1');await f.run(c.tenantPhone,'Yes, that works.');
  const booked=(await f.context(c.tenantPhone)).jobs[0];assert.ok(booked.scheduled_at);assert.equal(booked.coordinator_details.entryPermission,false);
  const initial=(await notices(f,job.id))[0];assert.equal(initial.status,'queued');
  await f.run(c.tenantPhone,'Please keep my cat inside.',{model:{type:'add_details',jobId:job.id,fields:{description:'Please keep my cat inside.',facts:{accessNotes:'Please keep my cat inside.'}}}});
  const rows=await notices(f,job.id);assert.equal(rows.length,1);assert.equal(rows[0].id,initial.id);assert.equal(rows[0].status,'queued');assert.match(rows[0].body,/cat inside/i);
  assert.equal((await f.context(c.tenantPhone)).jobs[0].scheduled_at,booked.scheduled_at);
  await f.db.query("update public.coordinator_outbox set status='sent' where user_id=$1 and id<>$2 and status='queued'",[c.user,initial.id]);
  assert.ok((await f.db.query('select * from public.coordinator_claim_outbox($1)',[c.user])).rows.some(n=>n.id===initial.id),'delivery must preserve the confirmed attended visit');
 } finally {await f.close();}
});
test('a booked unattended grant can be revoked without a later note restarting dispatch',async()=>{
 const f=await coordinatorFixture();try {
  await intake(f);await f.run(c.tenantPhone,'Yes permission granted.');const job=(await f.context(c.manager)).jobs[0];
  await raw(f,c.manager,'Book the first displayed visit',{type:'book_visit',jobId:job.id,fields:{options:[job.options[0]],proposalVersion:job.proposal_version,proposalOptions:job.options}});
  const booked=(await f.context(c.tenantPhone)).jobs[0];assert.ok(booked.scheduled_at);
  await f.run(c.tenantPhone,'Do not enter');
  await f.run(c.tenantPhone,'Please keep my cat inside.',{model:{type:'add_details',jobId:job.id,fields:{description:'Please keep my cat inside.',facts:{accessNotes:'Please keep my cat inside.'}}}});
  assert.equal((await notices(f,job.id)).filter(n=>n.status!=='cancelled').length,0);
  assert.equal((await f.context(c.tenantPhone)).jobs[0].scheduled_at,booked.scheduled_at);
 } finally {await f.close();}
});
test('permission revoked after delivery still sends an immediate concise safety update',async()=>{
 const f=await coordinatorFixture();try {
  await intake(f);await f.run(c.tenantPhone,'Yes permission granted.');const job=(await f.context(c.tenantPhone)).jobs[0];await sent(f,(await notices(f,job.id))[0].id);
  const revoked=await f.run(c.tenantPhone,'Do not enter');const rows=await f.outbox(revoked.sid,c.maintenance);assert.equal(rows.length,1);assert.match(rows[0].body,/NO|not granted|do not enter/i);assert.doesNotMatch(rows[0].body,/New maintenance request/);
  await f.db.query("update public.coordinator_outbox set status='sent' where user_id=$1 and id<>$2 and status='queued'",[c.user,rows[0].id]);
  assert.ok((await f.db.query('select * from public.coordinator_claim_outbox($1)',[c.user])).rows.some(n=>n.id===rows[0].id),'a safety update must pass the delivery gate');
 } finally {await f.close();}
});
test('SQL keeps manager comments internal even if a client supplies fabricated tenant wording',async()=>{
 const f=await coordinatorFixture();try {
  await intake(f);await f.run(c.tenantPhone,'Yes permission granted.');const job=(await f.context(c.tenantPhone)).jobs[0];
  const text='Please leave me alone lol. Figure out your hot water by yourself';
  await raw(f,c.manager,text,{type:'add_details',jobId:job.id,fields:{description:'Tenant prefers no contact and to resolve hot water independently.',requestScheduling:false}});
  const rows=await notices(f,job.id);assert.equal(rows.length,1);assert.doesNotMatch(rows[0].body,/Tenant prefers/);
  const manager=(await f.context(c.manager)).jobs.find(j=>j.id===job.id);assert.match(manager.notes,/Please leave me alone/);assert.doesNotMatch(manager.notes,/Tenant prefers/);
  assert.equal((await f.context(c.maintenance)).jobs.find(j=>j.id===job.id).notes,null);
 } finally {await f.close();}
});
test('portal requests also wait for access, then share the one-request dispatch path',async()=>{
 const f=await coordinatorFixture();try {
  const job=(await f.db.query("insert into public.maintenance_requests(user_id,tenant_id,property_id,title,description,source) values($1,$2,$3,'No hot water','Water is not getting hot','app') returning id",[c.user,c.tenant,c.property])).rows[0];
  assert.equal((await notices(f,job.id)).length,0);assert.ok((await f.outbox('app-maintenance:'+job.id,c.tenantPhone)).some(n=>/permission.*enter/i.test(n.body)));
  await f.db.query("update public.coordinator_outbox set status='sent' where event_sid=$1 and to_number=$2",['app-maintenance:'+job.id,c.tenantPhone]);
  await f.run(c.tenantPhone,'Yes permission granted.');assert.equal((await notices(f,job.id)).length,1);
 } finally {await f.close();}
});
test('the delivery worker holds a legacy queued TBD request until permission updates it',async()=>{
 const f=await coordinatorFixture();try {
  await intake(f);const job=(await f.context(c.tenantPhone)).jobs[0];
  const old=(await f.db.query("insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,request_id) values($1,'SMlegacy','1',$2,$3,'Legacy first work order. Entry: TBD.',$4) returning id",[c.user,c.maintenance,c.agent,job.id])).rows[0];
  const claim=async()=>(await f.db.query('select * from public.coordinator_claim_outbox($1)',[c.user])).rows;
  assert.equal((await claim()).some(n=>n.id===old.id),false);
  assert.equal((await notices(f,job.id))[0].status,'queued');
  await f.run(c.tenantPhone,'Yes permission granted.');
  const delivered=(await claim()).find(n=>n.id===old.id);assert.ok(delivered);assert.match(delivered.body,/permission to enter.*YES/i);assert.doesNotMatch(delivered.body,/Legacy|TBD/);
 } finally {await f.close();}
});
test('emergency alerts bypass the access wait immediately',async()=>{
 const f=await coordinatorFixture();try {
  const result=await f.run(c.tenantPhone,'I smell gas in the kitchen.');assert.match(result.reply,/emergency|safety|911/i);assert.ok((await f.outbox(result.sid,c.manager)).some(n=>/EMERGENCY/.test(n.body)));
 } finally {await f.close();}
});
test('status checks do not send a request before permission or duplicate one already sent',async()=>{
 const f=await coordinatorFixture();try {
  await intake(f);const job=(await f.context(c.tenantPhone)).jobs[0];
  const check=await f.run(c.tenantPhone,'Any update?',{model:{type:'request_status',jobId:job.id,fields:{}}});assert.match(check.reply,/permission.*enter/i);assert.equal((await notices(f,job.id)).length,0);
  await f.run(c.tenantPhone,'Yes permission granted.');await sent(f,(await notices(f,job.id))[0].id);
  await f.run(c.tenantPhone,'Any update?',{model:{type:'request_status',jobId:job.id,fields:{}}});assert.equal((await notices(f,job.id)).length,1);
 } finally {await f.close();}
});
