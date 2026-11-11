import { loadContext, commitDecision } from '../src/conversation-store.js';
import { interpretMessage } from '../src/assistant.js';
import { coordinateSms } from '../src/conversation-service.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const user='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const tenant='33333333-3333-4333-8333-333333333333', property='44444444-4444-4444-8444-444444444444';
const from='+13175551111', manager='+13175556088', maintenance='+13175559030';
const db=new PGlite();
const sqlFile=p=>readFile(new URL('../../PropertyHQ/'+p,import.meta.url),'utf8');
let seq=0;
const commit=async(phone,version,actions,nextState={},sid=`SM${++seq}`)=> (await db.query('select public.coordinator_commit($1,$2,$3,$4,$5,$6::jsonb) as r',[user,phone,sid,version,'fixture message',JSON.stringify({reply:'Fixture reply',actions,nextState})])).rows[0].r;
const ctx=async(phone)=>(await db.query('select public.coordinator_context($1,$2) as r',['+13175550000',phone])).rows[0].r;
test('permission-led SQL: private suggestions, conflicts and staff-only booking',async()=>{try {
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as 'select null::uuid'; create function public.is_tenant_of(uuid) returns boolean language sql as 'select false'; create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at:=now(); return new;end$$;`);
 const schema=await sqlFile('supabase/schema.sql');
 for(const name of ['tenants','maintenance_requests','properties']) {const definition=schema.match(new RegExp('create table if not exists public.'+name+' \\([\\s\\S]*?\\n\\);'))[0];await db.exec(definition+`; alter table public.${name} add primary key(id);`);}
 await db.exec(await sqlFile('supabase/migrations/20261014000000_maintenance_triage.sql'));
 await db.exec(await sqlFile('supabase/migrations/20261102000000_conversation_coordinator.sql'));
 await db.exec(await sqlFile('supabase/migrations/20261102010000_conversation_flow_refinements.sql'));
 await db.exec(await sqlFile('supabase/migrations/20261107000000_workflow_repairs.sql'));
 await db.exec(await sqlFile('supabase/migrations/20261107010000_tenant_conversation_language.sql'));
 await db.exec(await sqlFile('supabase/migrations/20261107020000_staff_conversation_continuity.sql'));
 await db.exec(await sqlFile('supabase/migrations/20261107030000_permission_led_scheduling.sql'));
 await db.exec(await sqlFile('supabase/migrations/20261108181500_tenant_maintenance_handoff.sql'));
 await db.exec(await sqlFile('supabase/migrations/20261111003933_manager_review_replies.sql'));
 await db.exec(await sqlFile('supabase/migrations/20261111214912_context_followup.sql'));
 await db.query('insert into auth.users values ($1),($2)',[user,other]);
 await db.query('insert into public.triage_settings(user_id,twilio_number,maintenance_phone,manager_phone) values($1,$2,$3,$4)',[user,'+13175550000',maintenance,manager]);
 await db.query('insert into public.tenants(id,user_id,property_id,first_name,last_name,email,phone) values($1,$2,$3,$4,$5,$6,$7)',[tenant,user,property,'Sarah','Fixture','test@example.invalid',from]);
 await db.query("insert into public.properties(id,user_id,name,address,city,state,zip_code) values($1,$2,'Oak','12 Oak Unit 2','Town','IN','46000')",[property,user]);
 await db.query("update public.triage_settings set open_days=ARRAY[1,2,3,4,5]::smallint[],open_time='09:00',close_time='18:00' where user_id=$1",[user]);

 const fetchDb=async(url,opts)=>{const name=url.split('/').pop(),args=JSON.parse(opts.body),keys=Object.keys(args);try{const r=await db.query(`select public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) r`,keys.map(k=>typeof args[k]==='object' && args[k]!==null?JSON.stringify(args[k]):args[k]));return {ok:true,status:200,text:async()=>JSON.stringify(r.rows[0].r)};}catch{return {ok:false,status:409,text:async()=>''};}};
 const fixtureDb={url:'https://fixture.invalid',key:'fixture'};
 const run=(phone,body,sid)=>coordinateSms({params:{From:phone,To:'+13175550000',Body:body,MessageSid:sid},fetchImpl:fetchDb,load:a=>loadContext({...a,db:fixtureDb}),commit:a=>commitDecision({...a,db:fixtureDb}),interpret:a=>interpretMessage({...a,env:{}})});
 await commit(from,0,[{type:'new_request',fields:{description:'Washer leak',facts:{issue:'washer',entryPermission:true}}}],{},'SMpermNew');
 const job=(await ctx(from)).jobs[0];
 const staffJob=(await ctx(maintenance)).jobs.find(j=>j.id===job.id);
 assert.equal(staffJob.stage,'awaiting_staff');assert.equal(staffJob.options.length,3);
 assert.equal((await ctx(from)).jobs[0].options,null,'private suggestions must not reach tenant context');
 const slot=staffJob.options[0];const version=staffJob.proposal_version;
 await assert.rejects(commit(from,1,[{type:'book_visit',jobId:job.id,fields:{options:[slot],proposalVersion:version}}]),/staff only/);
 await db.query("update public.coordinator_outbox set status='sent' where event_sid='SMpermNew' and to_number=$1",[maintenance]);
 const approved=await run(maintenance,'1','SMstaffBook');assert.match(approved,/scheduled/);
 assert.equal((await ctx(from)).jobs[0].stage,'confirmed');assert.ok((await ctx(from)).jobs[0].scheduled_at);
 const notice=(await db.query("select body from public.coordinator_outbox where event_sid='SMstaffBook' and tenant_id=$1",[tenant])).rows[0].body;
 assert.match(notice,/scheduled/i);assert.doesNotMatch(notice,/#\d+|which|choose|Does.*permission|May.*enter/i);
 // Consent is checked at booking, even when a displayed suggestion remains in a staff conversation.
 await commit(from,1,[{type:'new_request',fields:{description:'Screen repair',facts:{entryPermission:true}}}],{},'SMpermSecond');
 const second=(await ctx(maintenance)).jobs.find(j=>j.id!==job.id);const secondSlot=second.options[0];
 await commit(from,2,[{type:'add_details',jobId:second.id,fields:{description:'I need to be home',facts:{entryPermission:false}}}],{},'SMpermNo');
 assert.equal((await ctx(maintenance)).jobs.find(j=>j.id===second.id).options.length,3);
 const refusalPlan=(await ctx(maintenance)).jobs.find(j=>j.id===second.id);
 await assert.rejects(commit(maintenance,1,[{type:'offer_times',jobId:second.id,fields:{options:refusalPlan.options,proposalVersion:refusalPlan.proposal_version-1}}]),/stale/);
 await assert.rejects(commit(maintenance,1,[{type:'book_visit',jobId:second.id,fields:{options:[secondSlot],proposalVersion:second.proposal_version}}]),/permission/);
 // Another job cannot book the occupied first slot, regardless of the stale suggestion.
 await commit(from,3,[{type:'add_details',jobId:second.id,fields:{description:'Permission granted',facts:{entryPermission:true}}}],{},'SMpermYes');
 await assert.rejects(commit(maintenance,1,[{type:'book_visit',jobId:second.id,fields:{options:[slot]}}]),/unavailable/);
 // A portal booking created after staff approval also blocks the tenant's later selection.
 await commit(from,4,[{type:'add_details',jobId:second.id,fields:{description:'I must be present',facts:{entryPermission:false}}}],{},'SMrevokeAgain');
 const plan=(await ctx(maintenance)).jobs.find(j=>j.id===second.id);
 await db.query("update public.coordinator_outbox set status='sent' where event_sid='SMrevokeAgain' and to_number=$1",[maintenance]);
 const choices=await run(maintenance,'Yes','SMthreeOptions');assert.match(choices,/three options/);
 const offered=(await ctx(from)).jobs.find(j=>j.id===second.id);
 await db.query("insert into public.maintenance_requests(user_id,property_id,title,description,scheduled_at,source) values($1,$2,'Competing portal job','Busy slot',$3,'sms')",[user,property,plan.options[0].start]);
 await assert.rejects(commit(from,5,[{type:'select_time',jobId:second.id,fields:{choice:1,proposalVersion:offered.proposal_version}}]),/unavailable/);
 await db.query("delete from public.maintenance_requests where user_id=$1 and title='Competing portal job'",[user]);
 assert.match(await run(from,'2','SMpickOption'),/work for you/);assert.match(await run(from,'Yes, that works.','SMconfirmOption'),/scheduled/);
 assert.equal((await ctx(from)).jobs.find(j=>j.id===second.id).stage,'confirmed');
 // Asking for alternatives cannot expose previously private staff-only suggestions.
 const v=(await ctx(from)).version;
 await commit(from,v,[{type:'new_request',fields:{description:'Private alternative fixture',facts:{entryPermission:true}}}],{},'SMprivateAlternative');
 const privateJob=(await ctx(maintenance)).jobs.find(j=>j.description==='Private alternative fixture');assert.equal(privateJob.options.length,3);
 await commit(from,v+1,[{type:'request_alternatives',jobId:privateJob.id,fields:{description:'I need another time'}}],{},'SMprivateAlternativeReply');
 assert.deepEqual((await ctx(from)).jobs.find(j=>j.id===privateJob.id).options,[]);
 // Free-slot generation observes working days, staff events and date-only portal commitments.
 const at='2035-01-01T12:00:00Z';
 const free=async()=> (await db.query('select public.coordinator_free_slots($1,null,$2::timestamptz) as slots',[user,at])).rows[0].slots;
 const before=await free();assert.equal(before.length,3);assert.equal(before[0].start,'2035-01-01T14:00:00+00:00');
 await db.query("insert into public.coordinator_staff_events(user_id,staff_phone,title,start_at,end_at) values($1,$2,'Busy',$3,$4)",[user,maintenance,before[0].start,before[0].end]);
 assert.notEqual((await free())[0].start,before[0].start);
 await db.query("delete from public.coordinator_staff_events where user_id=$1 and title='Busy'",[user]);
 await db.query("insert into public.maintenance_requests(user_id,property_id,title,description,scheduled_date,source) values($1,$2,'Portal booking','Date only','2035-01-01','sms')",[user,property]);
 assert.ok((await free()).every(s=>!s.start.startsWith('2035-01-01')));
 await db.query("update public.triage_settings set open_days=ARRAY[]::smallint[] where user_id=$1",[user]);assert.deepEqual(await free(),[]);
 // A rejected cross-account portal write must not inspect the target owner's calendar first.
 await db.exec(`create or replace function auth.uid() returns uuid language sql as 'select ''${other}''::uuid'; grant usage on schema auth to authenticated; grant insert on public.maintenance_requests to authenticated; grant usage on sequence public.maintenance_job_number_seq to authenticated; alter table public.maintenance_requests enable row level security; create policy fixture_owner_write on public.maintenance_requests for insert to authenticated with check(user_id=auth.uid()); set role authenticated;`);
 await assert.rejects(db.query("insert into public.maintenance_requests(user_id,property_id,title,description,scheduled_at,source) values($1,$2,'Foreign write','Denied',$3,'sms')",[user,property,slot.start]),/row-level security/);
 await db.exec('reset role');
 }finally{await db.close();}});
