import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinatorFixture,contacts as c} from './helpers/coordinator-fixture.js';

async function repair(f,text='My washer will not turn on.') {
  const r=await f.run(c.tenantPhone,text,{model:{type:'new_request',fields:{description:text,facts:{issue:'washer',repairSummary:'Washer will not turn on'}}}});
  return {r,job:(await f.context(c.tenantPhone)).jobs.find(j=>j.description===text)};
}
async function saved(f,id) {return (await f.db.query('select to_jsonb(m) as job from public.maintenance_requests m where id=$1',[id])).rows[0].job;}
async function owner(f) {await f.db.exec(`create or replace function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[c.user]);}

test('request history and the next actor move from tenant entry to maintenance without duplicate activity',async()=>{
 const f=await coordinatorFixture();try {
  const {job}=await repair(f);let m=await saved(f,job.id);
  assert.equal(m.coordinator_waiting_on,'tenant');assert.equal(m.coordinator_waiting_reason,'entry_permission');
  const granted=await f.run(c.tenantPhone,'Yes, you can enter while nobody is home. Watch out for my cat.');
  m=await saved(f,job.id);assert.equal(m.coordinator_waiting_on,'maintenance');assert.equal(m.coordinator_waiting_reason,'schedule_visit');
  const before=(await f.db.query('select * from public.maintenance_request_activity where request_id=$1 order by created_at,id',[job.id])).rows;
  assert.equal(before.length,2);assert.equal(before[1].author_role,'tenant');assert.match(before[1].body,/cat/);
  await f.run(c.tenantPhone,'Yes, you can enter while nobody is home. Watch out for my cat.',{sid:granted.sid});
  assert.equal((await f.db.query('select count(*)::int n from public.maintenance_request_activity where request_id=$1',[job.id])).rows[0].n,2);
 }finally{await f.close();}
});

test('private notes and status questions do not reset waiting, while real progress does',async()=>{
 const f=await coordinatorFixture();try {
  const {job}=await repair(f);await f.run(c.tenantPhone,'Yes, you can enter while nobody is home.');
  const before=await saved(f,job.id);
  await f.run(c.maintenance,`Update on request #${job.job_number}?`,{model:{type:'request_status',jobId:job.id,fields:{}}});
  await f.run(c.manager,`Internal note for #${job.job_number}: review the invoice privately.`,{model:{type:'add_details',jobId:job.id,fields:{description:'Private invoice note'}}});
  assert.equal((await saved(f,job.id)).coordinator_waiting_token,before.coordinator_waiting_token);
  await f.run(c.maintenance,`#${job.job_number} work has started`,{model:{type:'start_work',jobId:job.id,fields:{description:'Work started'}}});
  const progress=await saved(f,job.id);assert.notEqual(progress.coordinator_waiting_token,before.coordinator_waiting_token);
  assert.equal(progress.coordinator_waiting_reason,'visit_update');
 }finally{await f.close();}
});

test('management notes append independently, stay internal and enforce request ownership',async()=>{
 const f=await coordinatorFixture();try {
  const {job}=await repair(f);await owner(f);
  const prior=(await f.db.query('select count(*)::int n from public.coordinator_outbox')).rows[0].n;
  await f.db.query('select public.maintenance_add_note($1,$2)',[job.id,'Waiting for the supplier to confirm the part.']);
  await f.db.query('select public.maintenance_add_note($1,$2)',[job.id,'Invoice checked by management.']);
  const notes=(await f.db.query("select * from public.maintenance_request_activity where request_id=$1 and source='dashboard'",[job.id])).rows;
  assert.equal(notes.length,2);assert.ok(notes.every(n=>n.author_role==='manager' && n.created_at));
  assert.equal((await f.db.query('select count(*)::int n from public.coordinator_outbox')).rows[0].n,prior);
  await assert.rejects(f.db.query('select public.maintenance_add_note($1,$2)',[job.id,'   ']),/note/i);
  await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",['99999999-9999-4999-8999-999999999999']);
  await assert.rejects(f.db.query('select public.maintenance_add_note($1,$2)',[job.id,'Unauthorized note']),/request unavailable|owner/i);
 }finally{await f.close();}
});

test('initial authenticated dashboard notes receive an author and timestamp without duplicating earlier history',async()=>{
 const f=await coordinatorFixture();try {
  await owner(f);
  const job=(await f.db.query("insert into public.maintenance_requests(user_id,property_id,tenant_id,title,description,category,urgency,status,source,notes) values($1,$2,$3,'New app repair','Washer repair reported through Property HQ.','general','medium','open','app','Supplier confirmed the replacement part.') returning id",[c.user,c.property,c.tenant])).rows[0];
  const entries=(await f.db.query('select * from public.maintenance_request_activity where request_id=$1',[job.id])).rows;
  assert.equal(entries.length,1);assert.equal(entries[0].author_role,'manager');assert.equal(entries[0].body,'Supplier confirmed the replacement part.');assert.ok(entries[0].created_at);
  assert.equal((await saved(f,job.id)).coordinator_legacy_notes,null);
 }finally{await f.close();}
});

test('manager replies remain optional until explicitly marked as needing a tenant response',async()=>{
 const f=await coordinatorFixture();try {
  await f.run(c.tenantPhone,'Can you install a garden spigot?');
  const job=(await f.context(c.tenantPhone)).jobs[0];
  assert.equal((await saved(f,job.id)).coordinator_waiting_on,'manager');
  await f.run(c.manager,`SEND #${job.job_number}: If you decide to pay for the installation, submit a quote.`);
  assert.equal((await saved(f,job.id)).coordinator_waiting_reason,'tenant_optional');
  await owner(f);await f.db.query('select public.maintenance_require_tenant_reply($1,true)',[job.id]);
  assert.equal((await saved(f,job.id)).coordinator_waiting_reason,'tenant_response');
 }finally{await f.close();}
});

test('current attended options wait on the tenant, then confirmed visits wait until their actual start',async()=>{
 const f=await coordinatorFixture();try {
  const {job}=await repair(f);await f.run(c.tenantPhone,'No, I need to be home.');
  const future=new Date(Date.now()+3*86400000).toISOString(),end=new Date(Date.parse(future)+3600000).toISOString();
  await f.db.query("insert into public.coordinator_appointments(request_id,user_id,stage,options) values($1,$2,'awaiting_selection',$3) on conflict(request_id) do update set stage='awaiting_selection',options=excluded.options",[job.id,c.user,JSON.stringify([{start:future,end,flexible:false}])]);
  assert.equal((await saved(f,job.id)).coordinator_waiting_on,'tenant');
  await f.db.query("update public.maintenance_requests set coordinator_attended_access=true,scheduled_at=$2 where id=$1",[job.id,future]);
  await f.db.query("update public.coordinator_appointments set stage='confirmed',start_at=$2,end_at=$3 where request_id=$1",[job.id,future,end]);
  assert.equal((await saved(f,job.id)).coordinator_waiting_reason,'scheduled');
  await f.db.query('select public.coordinator_refresh_waiting($1,$2,$3)',[c.user,job.id,end]);
  assert.equal((await saved(f,job.id)).coordinator_waiting_reason,'visit_update');
 }finally{await f.close();}
});

test('two requests keep separate waiting clocks and completed jobs have no pending actor',async()=>{
 const f=await coordinatorFixture();try {
  const first=(await repair(f)).job;
  const second=(await repair(f,'My bedroom window screen is torn.')).job;
  await f.run(c.tenantPhone,'Yes, you can enter while nobody is home.');
  assert.equal((await saved(f,first.id)).coordinator_waiting_on,'tenant');
  assert.equal((await saved(f,second.id)).coordinator_waiting_on,'maintenance');
  await f.run(c.maintenance,`DONE #${second.job_number}`);
  assert.equal((await saved(f,second.id)).coordinator_waiting_on,null);
  assert.equal((await saved(f,first.id)).coordinator_waiting_on,'tenant');
 }finally{await f.close();}
});

test('internal history is owner-readable only and worker helpers are not public RPCs',async()=>{
 const f=await coordinatorFixture();try {
  const {job}=await repair(f);await owner(f);
  await f.db.query('select public.maintenance_add_note($1,$2)',[job.id,'Confidential management note.']);
  await f.db.exec('set role authenticated');
  assert.ok((await f.db.query('select * from public.maintenance_request_activity')).rows.length>0);
  await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",['99999999-9999-4999-8999-999999999999']);
  assert.equal((await f.db.query('select * from public.maintenance_request_activity')).rows.length,0);
  await assert.rejects(f.db.query('select public.coordinator_refresh_waiting($1,$2)',[c.user,job.id]),/permission denied/i);
  await f.db.exec('reset role');
 }finally{await f.close();}
});

test('settings validate ownership and bounds, and resuming restarts the request waiting interval',async()=>{
 const f=await coordinatorFixture();try {
  const {job}=await repair(f);await owner(f);const before=await saved(f,job.id);
  await f.db.query('select public.maintenance_save_followup_settings(false,4)');
  const settings=(await f.db.query('select * from public.maintenance_followup_settings where user_id=$1',[c.user])).rows[0];
  assert.equal(settings.enabled,false);assert.equal(settings.reminder_hours,4);
  await assert.rejects(f.db.query('select public.maintenance_save_followup_settings(true,0)'),/1 to 168/);
  await f.db.query('select public.maintenance_pause_followups($1,true)',[job.id]);
  assert.equal((await saved(f,job.id)).coordinator_reminders_paused,true);
  await f.db.query('select public.maintenance_pause_followups($1,false)',[job.id]);
  const resumed=await saved(f,job.id);assert.equal(resumed.coordinator_reminders_paused,false);assert.notEqual(resumed.coordinator_waiting_token,before.coordinator_waiting_token);
  await f.db.query("select set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(f.db.query('select public.maintenance_save_followup_settings(true,24)'),/owner/);
 }finally{await f.close();}
});

test('a request without configured staff contacts waits on management rather than an unasked tenant',async()=>{
 const f=await coordinatorFixture();try {
  const {job}=await repair(f);await f.db.query('delete from public.triage_settings where user_id=$1',[c.user]);
  await f.db.query('select public.coordinator_refresh_waiting($1,$2)',[c.user,job.id]);
  const m=await saved(f,job.id);assert.equal(m.coordinator_waiting_on,'manager');assert.equal(m.coordinator_waiting_reason,'staff_setup');
 }finally{await f.close();}
});
