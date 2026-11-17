import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinatorFixture,contacts as c} from './helpers/coordinator-fixture.js';

const first='2026-11-18T14:00:00Z',second='2026-11-19T14:00:00Z';
async function pending(f,{permit=false}={}) {
 await f.run(c.tenantPhone,'My washer will not turn on.'+(permit?' You have permission to enter while nobody is home.':''),{model:{type:'new_request',fields:{description:'Washer will not turn on',facts:{issue:'washer',...(permit?{entryPermission:true}:{})}}}});
 const job=(await f.context(c.tenantPhone)).jobs[0];
 await f.db.query("update public.coordinator_outbox set status='sent' where request_id=$1",[job.id]);
 await f.db.query("update public.maintenance_requests set coordinator_waiting_since='2026-11-17T14:00:00Z' where id=$1",[job.id]);
 return job;
}
async function enqueue(f,at=first) {return (await f.db.query('select public.coordinator_enqueue_followups($1,$2) n',[c.user,at])).rows[0].n;}
async function reminders(f) {return (await f.db.query('select * from public.coordinator_outbox where followup_token is not null order by created_at,id')).rows;}
async function valid(f,id,at=first,delivery=false) {return (await f.db.query('select public.coordinator_followup_valid($1,$2,$3,$4) ok',[c.user,id,at,delivery])).rows[0].ok;}

test('a stalled tenant receives one entry prompt at the threshold, never early or outside working hours',async()=>{
 const f=await coordinatorFixture();try {
  const job=await pending(f);
  assert.equal(await enqueue(f,'2026-11-18T13:59:59Z'),0);
  assert.equal(await enqueue(f),1);assert.equal(await enqueue(f),0);
  const rows=await reminders(f);assert.equal(rows.length,1);assert.equal(rows[0].to_number,c.tenantPhone);assert.equal(rows[0].request_id,job.id);
  assert.match(rows[0].body,/permission to enter/i);assert.doesNotMatch(rows[0].body,/private|manager note/i);
  assert.equal(await valid(f,rows[0].id,'2026-11-18T23:30:00Z',true),false);
 }finally{await f.close();}
});

test('a weekend never produces a burst and the second reminder waits a full interval after the first attempt',async()=>{
 const f=await coordinatorFixture();try {
  await pending(f);await f.db.exec("update public.maintenance_requests set coordinator_waiting_since='2026-11-13T14:00:00Z'");
  assert.equal(await enqueue(f,'2026-11-15T14:00:00Z'),0);
  assert.equal(await enqueue(f,'2026-11-16T14:00:00Z'),1);assert.equal(await enqueue(f,'2026-11-16T14:00:00Z'),0);
  const r=(await reminders(f))[0];await f.db.query("update public.coordinator_outbox set status='sent',followup_attempted_at='2026-11-16T14:00:00Z' where id=$1",[r.id]);
  assert.equal(await enqueue(f,'2026-11-17T13:59:59Z'),0);
  assert.equal(await enqueue(f,'2026-11-17T14:00:00Z'),1);
  const r2=(await reminders(f)).find(x=>x.followup_number===2);await f.db.query("update public.coordinator_outbox set status='sent',followup_attempted_at='2026-11-17T14:00:00Z' where id=$1",[r2.id]);
  assert.equal(await enqueue(f,second),0);assert.equal((await reminders(f)).length,2);
 }finally{await f.close();}
});

test('a permission answer invalidates its queued reminder before sending and starts the maintenance step',async()=>{
 const f=await coordinatorFixture();try {
  await pending(f);await enqueue(f);const stale=(await reminders(f))[0];
  await f.run(c.tenantPhone,'Yes, you can enter while nobody is home.');
  assert.equal(await valid(f,stale.id),false);
  await enqueue(f);assert.equal((await reminders(f)).find(x=>x.id===stale.id).status,'cancelled');
 }finally{await f.close();}
});

test('maintenance reminders are concise, request-bound and cannot disclose management notes',async()=>{
 const f=await coordinatorFixture();try {
  const job=await pending(f,{permit:true});
  await f.run(c.manager,`Internal note for #${job.job_number}: private legal issue.`,{model:{type:'add_details',jobId:job.id,fields:{description:'private legal issue'}}});
  assert.equal(await enqueue(f),1);const r=(await reminders(f))[0];
  assert.equal(r.to_number,c.maintenance);assert.match(r.body,new RegExp('#'+job.job_number));assert.doesNotMatch(r.body,/private legal|entire conversation/i);
  await f.run(c.maintenance,`DONE #${job.job_number}`);
  assert.equal(await valid(f,r.id),false);
 }finally{await f.close();}
});

test('pause, contact revocation and uncertainty prevent stale or duplicate sends',async()=>{
 const f=await coordinatorFixture();try {
  const job=await pending(f);await enqueue(f);const r=(await reminders(f))[0];
  await f.db.query("update public.coordinator_outbox set status='uncertain',followup_attempted_at=$2 where id=$1",[r.id,first]);
  assert.equal(await enqueue(f,first),0);assert.equal((await reminders(f)).length,1);
  await f.db.query('update public.maintenance_requests set coordinator_reminders_paused=true where id=$1',[job.id]);
  assert.equal(await valid(f,r.id),false);assert.equal(await enqueue(f,second),0);
  await f.db.query('update public.maintenance_requests set coordinator_reminders_paused=false where id=$1',[job.id]);
  await f.db.query('insert into public.coordinator_contacts(user_id,phone,revoked) values($1,$2,true)',[c.user,c.tenantPhone]);
  assert.equal(await valid(f,r.id),false);
 }finally{await f.close();}
});

test('optional manager offers do not get stalled-response reminders',async()=>{
 const f=await coordinatorFixture();try {
  await f.run(c.tenantPhone,'Can you install a garden spigot?');const job=(await f.context(c.tenantPhone)).jobs[0];
  await f.run(c.manager,`SEND #${job.job_number}: If you decide to proceed, submit a quote.`);
  await f.db.query("update public.maintenance_requests set coordinator_waiting_since='2026-11-01T14:00:00Z' where id=$1",[job.id]);
  assert.equal(await enqueue(f),0);
 }finally{await f.close();}
});

test('booking a future visit cancels its old scheduling reminder',async()=>{
 const f=await coordinatorFixture();try {
  const job=await pending(f,{permit:true});assert.equal(await enqueue(f),1);const r=(await reminders(f))[0];
  await f.db.query("update public.maintenance_requests set scheduled_at='2026-11-20T15:00:00Z' where id=$1",[job.id]);
  assert.equal(await valid(f,r.id),false);assert.equal(await enqueue(f),0);
  assert.equal((await reminders(f)).find(row=>row.id===r.id).status,'cancelled');
 }finally{await f.close();}
});

test('business-hour checks use the configured zone across overnight hours and the repeated DST hour',async()=>{
 const f=await coordinatorFixture();try {
  await f.db.exec("update public.triage_settings set timezone='America/New_York',open_days=ARRAY[1]::smallint[],open_time='22:00',close_time='02:00'");
  const hours=async time=>(await f.db.query('select public.coordinator_followup_hours($1,$2) ok',[c.user,time])).rows[0].ok;
  assert.equal(await hours('2026-11-17T06:30:00Z'),true);assert.equal(await hours('2026-11-17T07:00:00Z'),false);
  await f.db.exec("update public.triage_settings set open_days=ARRAY[7]::smallint[],open_time='01:00',close_time='02:00'");
  assert.equal(await hours('2026-11-01T05:30:00Z'),true);assert.equal(await hours('2026-11-01T06:30:00Z'),true);
 }finally{await f.close();}
});

test('the existing delivery worker cancels an answered reminder while still claiming normal request messages',async()=>{
 const f=await coordinatorFixture();try {
  await pending(f);await enqueue(f);const stale=(await reminders(f))[0];
  await f.run(c.tenantPhone,'Yes, you can enter while nobody is home.');
  const claimed=(await f.db.query('select * from public.coordinator_claim_outbox($1)',[c.user])).rows;
  assert.ok(claimed.every(row=>row.id!==stale.id));assert.ok(claimed.some(row=>row.to_number===c.maintenance));
  assert.equal((await reminders(f)).find(row=>row.id===stale.id).status,'cancelled');
 }finally{await f.close();}
});
