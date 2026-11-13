import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinatorFixture,contacts as c} from './helpers/coordinator-fixture.js';
const ending='If anything else comes up let us know, thank you. Have a good day!';
const intake=async f=>{await f.run(c.tenantPhone,'The washer will not turn on. You have permission to enter if nobody is home.',{model:{type:'new_request',fields:{description:'Washer will not turn on.',facts:{issue:'washer'}}}});const j=(await f.context(c.tenantPhone)).jobs[0];await f.db.query("update public.coordinator_outbox set status='sent' where request_id=$1 and to_number=$2",[j.id,c.maintenance]);return j;};
let seq=0;
const raw=async(f,text,j,type='complete_work')=>{const ctx=await f.context(c.maintenance),sid='SMstrictRaw'+(++seq);await f.db.query('select public.coordinator_commit($1,$2,$3,$4,$5,$6::jsonb)',[c.user,c.maintenance,sid,ctx.version,text,JSON.stringify({reply:'Fixture',nextState:ctx.state,actions:[{type,jobId:j.id,fields:{description:'A model thinks this is finished'}}]})]);return sid;};
test('a completed repair and the tenant thank-you both end warmly without reopening or new alerts',async()=>{
 const f=await coordinatorFixture();try{
  const j=await intake(f);const done=await f.run(c.maintenance,'DONE #'+j.job_number);const notices=await f.outbox(done.sid,c.tenantPhone);assert.equal(notices.length,1);assert.ok(notices[0].body.endsWith(ending));
  const count=(await f.db.query('select count(*)::int as n from public.coordinator_outbox')).rows[0].n;
  const closed=await f.run(c.tenantPhone,'Okay thank you!',{model:{type:'request_status',jobId:j.id,fields:{}}});assert.ok(closed.reply.endsWith(ending));assert.doesNotMatch(closed.reply,/scheduled|\?/i);
  assert.equal((await f.context(c.tenantPhone)).jobs[0].status,'completed');assert.equal((await f.db.query('select count(*)::int as n from public.coordinator_outbox')).rows[0].n,count);
 }finally{await f.close();}
});
test('lowercase and malformed completion commands cannot change SQL status or queue alerts',async()=>{
 const f=await coordinatorFixture();try{
  const j=await intake(f);
  for(const text of ['done','done #'+j.job_number,'DONE '+j.job_number,'DONE Replaced water heater elements.','FINISHED','DONE!']){
   const sid=await raw(f,text,j);assert.equal((await f.context(c.tenantPhone)).jobs[0].status,'open',text);assert.equal((await f.outbox(sid)).length,0,text);
  }
  await raw(f,'DONE #'+j.job_number,j);assert.equal((await f.context(c.tenantPhone)).jobs[0].status,'completed');
 }finally{await f.close();}
});
test('an explicit completion number cannot close a different SQL request',async()=>{
 const f=await coordinatorFixture();try{
  const j=await intake(f);const sid=await raw(f,'DONE #9999',j);assert.equal((await f.context(c.tenantPhone)).jobs[0].status,'open');assert.equal((await f.outbox(sid)).length,0);
 }finally{await f.close();}
});
test('inspection completion follows the same uppercase exact-command rule',async()=>{
 const f=await coordinatorFixture();try{
  await f.run(c.tenantPhone,'Could I get a new garden spigot installed?');await f.run(c.manager,'APPROVE INSPECTION');const j=(await f.context(c.tenantPhone)).jobs[0];assert.equal(j.coordinator_review_status,'inspection_authorized');
  for(const text of ['done','DONE '+j.job_number,'DONE #9999']){
   const sid=await raw(f,text,j,'complete_inspection');assert.equal((await f.context(c.tenantPhone)).jobs[0].coordinator_review_status,'inspection_authorized');assert.equal((await f.outbox(sid)).length,0);
  }
  const sid=await raw(f,'DONE #'+j.job_number,j,'complete_inspection');assert.equal((await f.context(c.tenantPhone)).jobs[0].coordinator_review_status,'awaiting_manager_response');assert.ok((await f.outbox(sid,c.tenantPhone))[0].body.endsWith(ending));
 }finally{await f.close();}
});
test('malformed completion cannot mutate SQL state or notify through another action type',async()=>{
 const f=await coordinatorFixture();try{
  const j=await intake(f);
  for(const type of ['report_progress','add_details','staff_event'])for(const text of ['done','DONE Replaced water heater elements.']){
   const ctx=await f.context(c.maintenance),sid='SMinvalidAlternate'+(++seq);
   await f.db.query('select public.coordinator_commit($1,$2,$3,$4,$5,$6::jsonb)',[c.user,c.maintenance,sid,ctx.version,text,JSON.stringify({reply:'This must be quiet',nextState:{pendingStaffEvent:{title:'Wrong mutation'}},actions:[{type,jobId:j.id,fields:{description:'Wrong update',eventTitle:'Wrong event',appointmentStart:'2035-01-02T15:00:00Z',appointmentEnd:'2035-01-02T16:00:00Z'}}]})]);
   assert.equal((await f.outbox(sid)).length,0);assert.equal((await f.context(c.tenantPhone)).jobs[0].status,'open');assert.deepEqual((await f.context(c.maintenance)).state,ctx.state);
  }
 }finally{await f.close();}
});
test('portal inspection completion also retains the manager explanation and warm sign-off',async()=>{
 const f=await coordinatorFixture();try{
  await f.run(c.tenantPhone,'Could I get a new garden spigot installed?');await f.run(c.manager,'APPROVE INSPECTION');const j=(await f.context(c.tenantPhone)).jobs[0];await f.db.query("update public.maintenance_requests set status='completed' where id=$1",[j.id]);
  const rows=(await f.db.query('select body from public.coordinator_outbox where request_id=$1 and to_number=$2',[j.id,c.tenantPhone])).rows.filter(n=>/completed the inspection/.test(n.body));assert.equal(rows.length,1);assert.ok(rows[0].body.endsWith(ending));assert.match(rows[0].body,/manager.*review/i);
 }finally{await f.close();}
});
