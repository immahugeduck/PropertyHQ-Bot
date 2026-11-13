import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinatorFixture,contacts as c} from './helpers/coordinator-fixture.js';

async function scheduled(f,{offset='-1 minute',at=null,permission=true,attended=false,review=null}={}) {
 const j=(await f.db.query("insert into public.maintenance_requests(user_id,tenant_id,property_id,title,description,source,coordinator_details,coordinator_attended_access) values($1,$2,$3,'Hot water','No hot water in the home.','sms',$4::jsonb,$5) returning id,job_number",[c.user,c.tenant,c.property,JSON.stringify({issue:'other',repairSummary:'No hot water in the home.',...(permission===null?{}:{entryPermission:permission})}),attended])).rows[0];
 const time=(await f.db.query("select coalesce($2::timestamptz,now()+$1::interval) as start_at,coalesce($2::timestamptz,now()+$1::interval)+interval '1 hour' as end_at",[offset,at])).rows[0];
 await f.db.query("insert into public.coordinator_appointments(user_id,request_id,options,selected,stage,start_at,end_at) values($1,$2,$3::jsonb,1,'confirmed',$4,$5)",[c.user,j.id,JSON.stringify([{start:time.start_at,end:time.end_at}]),time.start_at,time.end_at]);
 await f.db.query("update public.maintenance_requests set scheduled_at=case when $3 in ('awaiting_manager_response','awaiting_tenant_response') then null else $2::timestamptz end,coordinator_review_status=$3 where id=$1",[j.id,time.start_at,review]);
 await f.db.query("insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,request_id,status) values($1,$2,'seed',$3,$4,'Confirmed maintenance visit',$5,'sent')",[c.user,'SMseed'+j.job_number,c.maintenance,c.agent,j.id]);
 await f.db.query("insert into public.coordinator_conversations(user_id,phone,state) values($1,$2,$3::jsonb) on conflict(user_id,phone) do update set state=excluded.state",[c.user,c.tenantPhone,JSON.stringify({activeJobId:j.id})]);
 return {...j,...time};
}
const enqueue=async(f,at)=>(await f.db.query('select public.coordinator_enqueue_visit_checkins($1,coalesce($2::timestamptz,now())) as n',[c.user,at??null])).rows[0].n;
const reminders=async(f)=>(await f.db.query("select * from public.coordinator_outbox where action_key='visit_checkin' order by created_at,id")).rows;
const claim=async(f)=>(await f.db.query('select * from public.coordinator_claim_outbox($1)',[c.user])).rows;

test('a check-in starts at the saved appointment time, stays compact, and never claims work started',async()=>{
 const f=await coordinatorFixture();try {
  const j=await scheduled(f);assert.equal(await enqueue(f,new Date(Date.parse(j.start_at)-1).toISOString()),0);assert.equal((await reminders(f)).length,0);
  assert.equal(await enqueue(f,j.start_at),1);const row=(await reminders(f))[0];assert.equal(row.request_id,j.id);assert.equal(Date.parse(row.visit_checkin_at),Date.parse(j.start_at));
  assert.match(row.body,/Visit check-in.*Bree Fixture.*508 Fixture St/s);assert.match(row.body,/No hot water/i);assert.match(row.body,new RegExp('DONE '+j.job_number));assert.doesNotMatch(row.body,/work (?:has )?(?:started|finished)|New maintenance request|Tenant prefers/i);
  assert.equal((await f.context(c.tenantPhone)).jobs[0].status,'open');assert.equal((await f.db.query('select count(*)::int as n from public.coordinator_outbox where tenant_id=$1',[c.tenant])).rows[0].n,0);
 } finally {await f.close();}
});
test('the existing delivery worker automatically creates and claims one due check-in',async()=>{
 const f=await coordinatorFixture();try {
  const j=await scheduled(f);const rows=await claim(f);assert.equal(rows.length,1);assert.equal(rows[0].request_id,j.id);assert.equal(rows[0].action_key,'visit_checkin');assert.equal(rows[0].status,'sending');
  assert.equal((await claim(f)).length,0);assert.equal(await enqueue(f),0);assert.equal((await reminders(f)).length,1);
 } finally {await f.close();}
});
test('the saved November 13 visit is displayed as 10 AM in Indiana rather than 3 PM UTC',async()=>{
 const f=await coordinatorFixture();try {
  const j=await scheduled(f,{at:'2026-11-13T15:00:00Z'});assert.equal(await enqueue(f,j.start_at),1);assert.match((await reminders(f))[0].body,/Fri Nov 13 2026 10:00 AM \(America\/Indiana\/Indianapolis\)/);
 } finally {await f.close();}
});
test('future and stale appointments never create premature or historical reminders',async()=>{
 const f=await coordinatorFixture();try {
  await scheduled(f,{offset:'1 day'});await scheduled(f,{offset:'-16 minutes'});assert.equal(await enqueue(f),0);assert.equal((await reminders(f)).length,0);
 } finally {await f.close();}
});
for(const state of ['cancelled','completed','review','unknown','refused']) test('no check-in for '+state+' requests',async()=>{
 const f=await coordinatorFixture();try {
  const j=await scheduled(f,{permission:state==='unknown'?null:state==='refused'?false:true,review:state==='review'?'awaiting_manager_response':null});
  if(['cancelled','completed'].includes(state))await f.db.query('update public.maintenance_requests set status=$2 where id=$1',[j.id,state]);
  assert.equal(await enqueue(f),0);assert.equal((await reminders(f)).length,0);
 } finally {await f.close();}
});
test('a confirmed attended visit can receive its check-in without granting unattended entry',async()=>{
 const f=await coordinatorFixture();try {
  const j=await scheduled(f,{permission:false,attended:true});assert.equal(await enqueue(f),1);assert.equal((await claim(f)).filter(n=>n.action_key==='visit_checkin').length,1);assert.equal((await f.context(c.tenantPhone)).jobs[0].coordinator_details.entryPermission,false);
 } finally {await f.close();}
});
test('rescheduling cancels a queued old check-in and returning to its time allows one valid delivery',async()=>{
 const f=await coordinatorFixture();try {
  const j=await scheduled(f);await enqueue(f);const old=(await reminders(f))[0];
  await f.db.query("update public.maintenance_requests set scheduled_at=scheduled_at+interval '1 day' where id=$1",[j.id]);await f.db.query("update public.coordinator_appointments set start_at=start_at+interval '1 day',end_at=end_at+interval '1 day' where request_id=$1",[j.id]);
  assert.equal((await claim(f)).length,0);assert.equal((await reminders(f))[0].status,'cancelled');
  await f.db.query('update public.maintenance_requests set scheduled_at=$2 where id=$1',[j.id,j.start_at]);await f.db.query('update public.coordinator_appointments set start_at=$2,end_at=$3 where request_id=$1',[j.id,j.start_at,j.end_at]);
  const rows=await claim(f);assert.equal(rows.length,1);assert.equal(rows[0].id,old.id);assert.equal((await reminders(f)).length,1);
 } finally {await f.close();}
});
test('revoking entry after enqueue holds the reminder while the safety update still reaches maintenance',async()=>{
 const f=await coordinatorFixture();try {
  const j=await scheduled(f);await enqueue(f);const update=await f.run(c.tenantPhone,'Do not enter');assert.match(update.reply,/recorded/i);
  const rows=await claim(f);assert.equal(rows.some(n=>n.action_key==='visit_checkin'),false);assert.ok(rows.some(n=>n.request_id===j.id && /NO; arrange access/i.test(n.body)));assert.equal((await reminders(f))[0].status,'cancelled');
 } finally {await f.close();}
});
for(const state of ['cancelled','completed']) test('queued check-in is suppressed if the request becomes '+state+' before delivery',async()=>{
 const f=await coordinatorFixture();try {
  const j=await scheduled(f);await enqueue(f);await f.db.query('update public.maintenance_requests set status=$2 where id=$1',[j.id,state]);assert.equal((await claim(f)).length,0);assert.equal((await reminders(f))[0].status,'cancelled');
 } finally {await f.close();}
});
test('not-finished progress reaches the tenant without completing the request',async()=>{
 const f=await coordinatorFixture();try {
  const j=await scheduled(f);const row=(await claim(f))[0];await f.db.query("update public.coordinator_outbox set status='sent' where id=$1",[row.id]);
  const update=await f.run(c.maintenance,'Not finished yet. I need a replacement part.');assert.ok(update.reply);const job=(await f.context(c.tenantPhone)).jobs[0];assert.equal(job.status,'open');assert.equal(job.stage,'confirmed');
  const notices=await f.outbox(update.sid,c.tenantPhone);assert.equal(notices.length,1);assert.match(notices[0].body,/replacement part/);assert.doesNotMatch(notices[0].body,/has finished|completed the work/i);
 } finally {await f.close();}
});
test('private maintenance progress is retained for the manager without a tenant notification',async()=>{
 const f=await coordinatorFixture();try {
  const j=await scheduled(f);const row=(await claim(f))[0];await f.db.query("update public.coordinator_outbox set status='sent' where id=$1",[row.id]);
  const text='Internal staff note, do not send to tenant: not finished; manager needs to review the contractor dispute.';
  const update=await f.run(c.maintenance,text);assert.equal((await f.outbox(update.sid,c.tenantPhone)).length,0);assert.equal((await f.outbox(update.sid,c.manager)).length,1);
  assert.equal((await f.context(c.tenantPhone)).jobs[0].status,'open');assert.match((await f.context(c.manager)).jobs[0].notes,/contractor dispute/);
 } finally {await f.close();}
});
for(const state of ['queued','sent','sending','uncertain']) test('rerouting preserves one check-in and never retries a '+state+' delivery',async()=>{
 const f=await coordinatorFixture();try {
  const j=await scheduled(f);await enqueue(f);const old=(await reminders(f))[0];await f.db.query('update public.coordinator_outbox set status=$2 where id=$1',[old.id,state]);
  const replacement='+14155559030';await f.db.query('update public.triage_settings set maintenance_phone=$2 where user_id=$1',[c.user,replacement]);
  await f.db.query("insert into public.coordinator_outbox(user_id,event_sid,action_key,to_number,from_number,body,request_id,status) values($1,$2,'seed',$3,$4,'Initial notice on replacement route',$5,'sent')",[c.user,'SMroute'+state,replacement,c.agent,j.id]);
  await enqueue(f);const rows=await reminders(f);assert.equal(rows.length,1);assert.equal(rows[0].id,old.id);
  if(state==='queued'){
   assert.equal(rows[0].to_number,replacement);assert.equal(rows[0].status,'queued');
   const audit=(await f.db.query("select to_number from public.sms_messages where status like $1",['outbox:'+old.id+':%'])).rows[0];assert.equal(audit.to_number,replacement);
   const delivered=(await claim(f)).find(n=>n.id===old.id);assert.ok(delivered);assert.equal(delivered.to_number,replacement);
  }else{assert.equal(rows[0].status,state);assert.equal(rows[0].to_number,c.maintenance);assert.equal((await claim(f)).some(n=>n.id===old.id),false);}
 } finally {await f.close();}
});
test('inspection DONE returns to manager review instead of reporting installation complete',async()=>{
 const f=await coordinatorFixture();try {
  const j=await scheduled(f,{review:'inspection_authorized'});const row=(await claim(f))[0];assert.match(row.body,/Scope: inspection only/);await f.db.query("update public.coordinator_outbox set status='sent' where id=$1",[row.id]);
  const done=await f.run(c.maintenance,'DONE '+j.job_number);const job=(await f.context(c.tenantPhone)).jobs[0];assert.equal(job.coordinator_review_status,'awaiting_manager_response');assert.equal(job.scheduled_at,null);assert.equal(job.status,'open');
  assert.ok((await f.outbox(done.sid,c.manager)).length);assert.match((await f.outbox(done.sid,c.tenantPhone))[0].body,/inspection.*manager.*review/i);assert.doesNotMatch((await f.outbox(done.sid,c.tenantPhone))[0].body,/has finished.*work/i);
 } finally {await f.close();}
});
test('delivered check-in plus DONE completes only that repair and sends one tenant notice',async()=>{
 const f=await coordinatorFixture();try {
  const j=await scheduled(f);const row=(await claim(f))[0];await f.db.query("update public.coordinator_outbox set status='sent' where id=$1",[row.id]);
  const done=await f.run(c.maintenance,'DONE '+j.job_number);assert.match(done.reply,/recorded|complete/i);assert.equal((await f.context(c.tenantPhone)).jobs[0].status,'completed');
  const tenantRows=async()=>(await f.db.query('select body from public.coordinator_outbox where request_id=$1 and to_number=$2',[j.id,c.tenantPhone])).rows;
  assert.equal((await tenantRows()).length,1);assert.match((await tenantRows())[0].body,/finished/i);assert.doesNotMatch((await tenantRows())[0].body,/#\d+|staff note/i);
  await f.run(c.maintenance,'DONE '+j.job_number);assert.equal((await tenantRows()).length,1);
  const ctx=await f.context(c.maintenance);await f.db.query('select public.coordinator_commit($1,$2,$3,$4,$5,$6::jsonb)',[c.user,c.maintenance,'SMrepeatRaw',ctx.version,'DONE '+j.job_number,JSON.stringify({reply:'Already finished',nextState:{},actions:[{type:'complete_work',jobId:j.id,fields:{description:'Repeated completion'}}]})]);assert.equal((await tenantRows()).length,1,'SQL must independently suppress repeated completion notifications');
 } finally {await f.close();}
});
test('check-ins are account scoped and unavailable to public client roles',async()=>{
 const f=await coordinatorFixture();try {
  await scheduled(f);assert.equal((await f.db.query('select public.coordinator_enqueue_visit_checkins($1) as n',['22222222-2222-4222-8222-222222222222'])).rows[0].n,0);assert.equal((await reminders(f)).length,0);
  for(const role of ['anon','authenticated']){await f.db.exec('set role '+role);await assert.rejects(f.db.query('select public.coordinator_enqueue_visit_checkins($1)',[c.user]),/permission denied/);await f.db.exec('reset role');}
 } finally {await f.close();}
});
