import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinatorFixture,contacts as c} from './helpers/coordinator-fixture.js';

const report="I'm having trouble with my new tesla. I have been using a extension cord and an adapter from inside my house but it keeps turning off kitchen outlets and my dishwasher.";
const summary='Kitchen outlets and dishwasher lose power while charging a Tesla through an indoor extension cord and adapter.';
const intake=f=>f.run(c.tenantPhone,report,{model:{type:'new_request',fields:{description:report,facts:{issue:'other',repairSummary:summary}}}});

test('the exact report produces a compact repair, TBD access and three real calendar slots',async()=>{
 const f=await coordinatorFixture();try {
  const r=await intake(f);const job=(await f.context(c.tenantPhone)).jobs[0];
  const body=(await f.outbox(r.sid,c.maintenance))[0].body;
  assert.match(body,/New maintenance request.*Bree Fixture.*508 Fixture St/i);
  assert.ok(body.includes('Requesting maintenance repair for: '+summary));
  assert.match(body,/permission to enter.*TBD/i);assert.doesNotMatch(body,/I'm having trouble|Job #|Update for|new tesla\. I have/i);
  assert.equal((body.match(/#\d+/g)||[]).length,1);
  assert.match(body,/Potential schedule times based on your schedule:/);
  const staff=(await f.context(c.maintenance)).jobs.find(j=>j.id===job.id);
  assert.equal(staff.options.length,3);assert.equal(staff.stage,'awaiting_staff');assert.equal(staff.scheduled_at,null);
  assert.ok(body.includes('1)')&&body.includes('2)')&&body.includes('3)'));
 } finally {await f.close();}
});

test('cat permission is saved once and maintenance can select a displayed visit on that request',async()=>{
 const f=await coordinatorFixture();try {
  await intake(f);const job=(await f.context(c.tenantPhone)).jobs[0];
  const answer=await f.run(c.tenantPhone,"Yes that's fine. Just watch out for my cat. He can be sneaky");
  assert.doesNotMatch(answer.reply,/\?/);let saved=(await f.context(c.tenantPhone)).jobs[0];
  assert.equal(saved.id,job.id);assert.equal(saved.coordinator_details.entryPermission,true);assert.match(saved.coordinator_details.accessNotes,/cat/i);
  const notice=(await f.outbox(answer.sid,c.maintenance))[0];assert.match(notice.body,/permission to enter.*YES/i);assert.match(notice.body,/cat/i);
  assert.doesNotMatch(notice.body,/Yes that's fine|Update for|Job #/);
  await f.db.query("update public.coordinator_outbox set status='sent' where id=$1",[notice.id]);
  const staffJob=(await f.context(c.maintenance)).jobs.find(j=>j.id===job.id);assert.equal(staffJob.options.length,3);
  const selected=staffJob.options[1].start;const schedule=await f.run(c.maintenance,'2');
  assert.match(schedule.reply,/scheduled/);saved=(await f.context(c.tenantPhone)).jobs[0];
  assert.equal(Date.parse(saved.scheduled_at),Date.parse(selected));assert.equal(saved.stage,'confirmed');
  assert.ok((await f.outbox(schedule.sid,c.tenantPhone)).some(n=>/scheduled/.test(n.body)));
 } finally {await f.close();}
});

test('delivered request focus survives stale completed state and more than twelve later messages',async()=>{
 const f=await coordinatorFixture();try {
  const old=(await f.db.query("insert into public.maintenance_requests(user_id,tenant_id,property_id,title,description,status,source) values($1,$2,$3,'Old screen','Old repair','completed','sms') returning id",[c.user,c.tenant,c.property])).rows[0];
  await intake(f);const job=(await f.context(c.tenantPhone)).jobs[0];
  const answer=await f.run(c.tenantPhone,"Yes that's fine. Just watch out for my cat. He can be sneaky");
  await f.db.query("update public.coordinator_outbox set status='sent' where event_sid=$1 and to_number=$2",[answer.sid,c.maintenance]);
  await f.db.query('insert into public.coordinator_conversations(user_id,phone,state) values($1,$2,$3) on conflict(user_id,phone) do update set state=excluded.state',[c.user,c.maintenance,JSON.stringify({activeJobId:old.id,pendingOptions:{jobId:old.id,options:[]}})]);
  for(let i=0;i<14;i++) await f.db.query("insert into public.sms_messages(user_id,direction,channel,party,kind,from_number,to_number,body,status) values($1,'outbound','sms','maintenance','message',$2,$3,'Calendar note','prepared')",[c.user,c.agent,c.maintenance]);
  const context=await f.context(c.maintenance);assert.equal(context.staffFocus?.jobId,job.id);
  assert.equal(context.messages.some(m=>m.jobId===job.id),false,'fixture proves focus survives the recent-message cap');
  const scheduled=await f.run(c.maintenance,'Schedule for to morrow morning st 9 am',{model:{type:'clarify',jobId:old.id,fields:{}}});
  assert.match(scheduled.reply,/scheduled/);const saved=(await f.context(c.tenantPhone)).jobs.find(j=>j.id===job.id);assert.ok(saved.scheduled_at);
  const oldSaved=(await f.db.query('select status,scheduled_at from public.maintenance_requests where id=$1',[old.id])).rows[0];assert.equal(oldSaved.status,'completed');assert.equal(oldSaved.scheduled_at,null);
 } finally {await f.close();}
});

for(const text of ['Yes, but you need to wait for me to put my dog away.',"Yes that's fine. Don't come in with my cat loose."]) test('restricted pet access never becomes a YES work order: '+text,async()=>{
 const f=await coordinatorFixture();try {
  await intake(f);const reply=await f.run(c.tenantPhone,text);const job=(await f.context(c.tenantPhone)).jobs[0];
  assert.equal(job.coordinator_details.entryPermission,false);assert.equal(job.scheduled_at,null);
  const order=(await f.outbox(reply.sid,c.maintenance))[0];assert.ok(order);assert.match(order.body,/permission to enter.*NO/i);assert.match(order.body,/dog|cat/);
  assert.doesNotMatch(order.body,/permission to enter.*YES/i);
 } finally {await f.close();}
});
test('a pending private event receives the time without scheduling or notifying a tenant',async()=>{
 const f=await coordinatorFixture();try {
  await intake(f);await f.run(c.tenantPhone,'Yes permission granted.');const job=(await f.context(c.tenantPhone)).jobs[0];
  await f.db.query('insert into public.coordinator_conversations(user_id,phone,state) values($1,$2,$3) on conflict(user_id,phone) do update set state=excluded.state',[c.user,c.maintenance,JSON.stringify({activeJobId:job.id,pendingStaffEvent:{title:'Parts pickup'}})]);
  await f.db.query("insert into public.sms_messages(user_id,direction,channel,party,kind,from_number,to_number,body,status) values($1,'outbound','sms','maintenance','message',$2,$3,'When should I put Parts pickup on the staff calendar?','prepared')",[c.user,c.agent,c.maintenance]);
  const result=await f.run(c.maintenance,'Schedule for tomorrow at 9 am');
  const events=(await f.db.query('select title from public.coordinator_staff_events where user_id=$1',[c.user])).rows;
  assert.deepEqual(events,[{title:'Parts pickup'}]);assert.equal((await f.context(c.tenantPhone)).jobs[0].scheduled_at,null);
  assert.equal((await f.outbox(result.sid)).length,0);
 } finally {await f.close();}
});
test('repeated completion of a named closed screen repair leaves the open electrical request alone',async()=>{
 const f=await coordinatorFixture();try {
  const old=(await f.db.query("insert into public.maintenance_requests(user_id,tenant_id,property_id,title,description,status,source) values($1,$2,$3,'Window screen repair','Window screen repair','completed','sms') returning id",[c.user,c.tenant,c.property])).rows[0];
  await intake(f);const job=(await f.context(c.tenantPhone)).jobs.find(j=>j.status==='open');
  const result=await f.run(c.maintenance,'The window screen repair is finished.',{model:{type:'complete_work',jobId:old.id,fields:{description:'Window screen repaired.'}}});
  assert.equal((await f.context(c.tenantPhone)).jobs.find(j=>j.id===job.id).status,'open');
  const notices=await f.outbox(result.sid);assert.ok(notices.every(n=>n.request_id!==job.id));
 } finally {await f.close();}
});
test('a lockbox update preserves the cat precaution in saved facts and the maintenance notice',async()=>{
 const f=await coordinatorFixture();try {
  await intake(f);await f.run(c.tenantPhone,"Yes that's fine. Just watch out for my cat. He can be sneaky");
  const update=await f.run(c.tenantPhone,'You can enter. The lockbox code is 1234.');
  const job=(await f.context(c.tenantPhone)).jobs[0];
  assert.match(job.coordinator_details.accessNotes,/cat/i);assert.match(job.coordinator_details.accessNotes,/lockbox code is 1234/i);
  const order=(await f.outbox(update.sid,c.maintenance))[0];assert.ok(order);assert.match(order.body,/cat/i);assert.match(order.body,/lockbox code is 1234/i);
 } finally {await f.close();}
});
