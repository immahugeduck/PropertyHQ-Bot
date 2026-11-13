import { loadContext, commitDecision } from '../src/conversation-store.js';
import { coordinateSms } from '../src/conversation-service.js';
import { interpretMessage } from '../src/assistant.js';
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
test('real migration: tenant isolation, durable context, appointment lifecycle, retries and permissions',async()=>{
 try {
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
 await db.exec(await sqlFile('supabase/migrations/20261112235510_maintenance_dispatch_gate.sql'));
 await db.exec(await sqlFile('supabase/migrations/20261113032510_visit_status_checkins.sql'));
 await db.query('insert into auth.users values ($1),($2)',[user,other]);
 await db.query('insert into public.triage_settings(user_id,twilio_number,maintenance_phone,manager_phone) values($1,$2,$3,$4)',[user,'+13175550000',maintenance,manager]);
 await db.query('insert into public.tenants(id,user_id,property_id,first_name,last_name,email,phone) values($1,$2,$3,$4,$5,$6,$7)',[tenant,user,property,'Sarah','Fixture','test@example.invalid',from]);
 await db.query("insert into public.properties(id,user_id,name,address,city,state,zip_code) values($1,$2,'Oak','12 Oak Unit 2','Town','IN','46000')",[property,user]);
 let c=await ctx(from);assert.equal(c.tenants[0].id,tenant);
 await commit(from,0,[{type:'new_request',fields:{description:'Disposal issue, slow drain, possible cabinet leak',facts:{issue:'sink_disposal',leakPattern:'uncertain',availability:'Home until 4',entryPermission:true},requestScheduling:true}}],{},'SMnew');
 assert.equal((await commit(from,0,[],{},'SMnew')).duplicate,true);
 await assert.rejects(commit(from,0,[]),/conversation changed/);
 c=await ctx(from);assert.equal(c.jobs.length,1);assert.equal(c.jobs[0].coordinator_details.entryPermission,true);assert.match(c.jobs[0].coordinator_details.availability,/until 4/);const job=c.jobs[0].id;assert.equal(c.jobs[0].address,'12 Oak Unit 2');assert.match((await db.query("select body from public.coordinator_outbox where event_sid='SMnew'")).rows[0].body,/12 Oak/);
 assert.equal((await db.query("select count(*)::int n from public.coordinator_outbox o join public.sms_messages s on s.status like 'outbox:'||o.id::text||':%' where o.body<>s.body")).rows[0].n,0);
 await assert.rejects(commit(from,1,[{type:'complete_work',jobId:job,fields:{}}]),/staff only/);
 const options=[{start:'2035-01-02T15:00:00Z',end:'2035-01-02T16:00:00Z'},{start:'2035-01-03T15:00:00Z',end:'2035-01-03T16:00:00Z'}];
 await commit(maintenance,0,[{type:'offer_times',jobId:job,fields:{options}}]);
 c=await ctx(from);const firstProposal=c.jobs[0].proposal_version;assert.ok(firstProposal>=1);
 await assert.rejects(commit(from,1,[{type:'select_time',jobId:job,fields:{choice:1,proposalVersion:firstProposal-1}}]),/stale/);
 await commit(from,1,[{type:'select_time',jobId:job,fields:{choice:1,proposalVersion:firstProposal}}]);
 assert.equal((await ctx(from)).jobs[0].status,'open');
 // A second job cannot claim the same staff window; failed selection rolls back.
 await commit(from,2,[{type:'new_request',fields:{description:'Different issue'}}]);
 const second=(await ctx(from)).jobs.find(j=>j.id!==job).id;
 await commit(maintenance,1,[{type:'offer_times',jobId:second,fields:{options}}]);
 const secondVersion=(await ctx(from)).jobs.find(j=>j.id===second).proposal_version;
 await assert.rejects(commit(from,3,[{type:'select_time',jobId:second,fields:{choice:1,proposalVersion:secondVersion}}]),/unavailable/);
 assert.equal((await ctx(from)).version,3);
 await commit(manager,0,[{type:'complete_work',jobId:job,fields:{}}]);
 assert.equal((await ctx(from)).jobs.find(j=>j.id===job).status,'completed');
 assert.equal((await db.query("select count(*)::int n from public.coordinator_outbox where to_number=$1",[from])).rows[0].n,3);
 const tenantNotices=(await db.query('select body from public.coordinator_outbox where tenant_id=$1',[tenant])).rows;
 assert.ok(tenantNotices.some(r=>/finished/i.test(r.body)));
 assert.ok(tenantNotices.every(r=>!/#\d+|request #|Reply CONFIRM/.test(r.body)));
 assert.ok((await db.query('select body from public.coordinator_outbox where to_number=$1',[manager])).rows.some(r=>/#\d+/.test(r.body)));
 // Unknown contact collection survives independent calls; approval backfills history.
 const unknown='+13175552222';await commit(unknown,0,[],{name:'Sarah'});assert.equal((await ctx(unknown)).state.name,'Sarah');
 await commit(unknown,1,[{type:'request_link_approval',fields:{name:'Sarah',address:'12 Oak'}}],{name:'Sarah',address:'12 Oak'});
 await commit(manager,1,[{type:'approve_contact',fields:{phone:unknown,tenantId:tenant}}]);
 assert.equal((await ctx(unknown)).tenants[0].id,tenant);
 await commit(manager,2,[{type:'unlink_contact',fields:{phone:unknown}}]);assert.equal((await ctx(unknown)).tenants.length,0);
 assert.equal((await ctx('+13175553333')).jobs.length,0);
 // Tenant update remains attached to the same scheduled job and reaches both staff.
 await commit(from,3,[{type:'add_details',jobId:second,fields:{description:'Only leaks when used',facts:{leakPattern:'only_when_used',entryPermission:true}}}]);
 const updateBodies=(await db.query("select to_number,body from public.coordinator_outbox where event_sid=(select sid from public.coordinator_events where user_id=$1 and phone=$2 order by created_at desc limit 1)",[user,from])).rows;
 assert.ok(updateBodies.some(r=>r.to_number===maintenance));assert.ok(updateBodies.some(r=>r.to_number===manager));
 assert.match(updateBodies[0].body,/only when used/i);assert.match(updateBodies[0].body,/permission to enter/i);
 // Broad staff window accepts explicit in-window selection, never its default start.
 const flexible=[{start:'2035-01-04T14:00:00Z',end:'2035-01-04T23:00:00Z',flexible:true,label:'Thursday anytime'}];
 await commit(maintenance,2,[{type:'offer_times',jobId:second,fields:{options:flexible}}]);
 const flexibleVersion=(await ctx(from)).jobs.find(j=>j.id===second).proposal_version;
 await assert.rejects(commit(from,4,[{type:'select_time',jobId:second,fields:{choice:1,proposalVersion:flexibleVersion}}]),/exact time/);
 await commit(from,4,[{type:'select_time',jobId:second,fields:{choice:1,proposalVersion:flexibleVersion,appointmentStart:'2035-01-04T15:00:00Z',appointmentEnd:'2035-01-04T16:00:00Z'}}]);
 assert.equal((await ctx(from)).jobs.find(j=>j.id===second).scheduled_at,'2035-01-04T15:00:00+00:00');
 // Real service + RPC boundary walkthrough: washer intake -> single staff offer -> tenant confirmation.
 const fetchDb=async(url,opts)=>{
  const name=url.split('/').pop();const args=JSON.parse(opts.body);
  const keys=Object.keys(args);const query=`select public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) as r`;
  try {const result=await db.query(query,keys.map(k=>typeof args[k]==='object' && args[k]!==null?JSON.stringify(args[k]):args[k]));return {ok:true,status:200,text:async()=>JSON.stringify(result.rows[0].r)};}
  catch {return {ok:false,status:409,text:async()=>''};}
 };
 const fixtureDb={url:'https://fixture.invalid',key:'fixture'};
 const run=async(phone,body,intent)=>coordinateSms({params:{From:phone,To:'+13175550000',MessageSid:`SMflow${++seq}`,Body:body},fetchImpl:fetchDb,
  load:args=>loadContext({...args,db:fixtureDb}),commit:args=>commitDecision({...args,db:fixtureDb}),interpret:args=>intent ? Promise.resolve(intent) : interpretMessage({...args,env:{}})});
 const washerReply=await run(from,'Washer leaks only when on. Home until 4; away tomorrow. Permission to enter.',{type:'new_request',fields:{description:'Washer leaks only when turned on',facts:{issue:'washer',leakPattern:'only_when_used',entryPermission:true,availability:'Home until 4; away tomorrow'}}});
 assert.match(washerReply,/washer/i);assert.doesNotMatch(washerReply,/\?/);
 const washer=(await ctx(from)).jobs.find(j=>j.coordinator_details.issue==='washer');
 const visit=[{start:'2035-01-05T20:00:00Z',end:'2035-01-05T21:00:00Z'}];
 await run(maintenance,'Schedule washer at 3pm',{type:'offer_times',jobId:washer.id,fields:{options:visit}});
 const publishReply=await run(maintenance,'CONFIRM OPTIONS',{type:'confirm_options',jobId:washer.id,fields:{options:visit}});
 assert.match(publishReply,/scheduled/);
 const booked=(await ctx(from)).jobs.find(j=>j.id===washer.id);
 assert.equal(booked.coordinator_details.entryPermission,true);assert.ok(booked.scheduled_at);
 // Exact reported regression: initial complaint -> unclear answer -> natural entry consent.
 await run(from,"Hello I have a kitchen faucet that's leaking underneath the sink. And my garbage disposal doesn't work",{type:'new_request',fields:{description:'Kitchen faucet leaking under sink; disposal not working',facts:{issue:'sink_disposal'}}});
 const entryJob=(await ctx(from)).jobs.find(j=>j.description==='Kitchen faucet leaking under sink; disposal not working');
 const requestCount=(await db.query('select count(*)::int n from public.maintenance_requests where user_id=$1',[user])).rows[0].n;
 const unclear=await run(from,'Maybe, I need to check.');assert.match(unclear,/permission.*enter/i);
 const entryReply=await run(from,'Yes that is fine with me.');assert.doesNotMatch(entryReply,/\?|what.*maintenance/i);
 const entryAfter=(await ctx(from)).jobs.find(j=>j.id===entryJob.id);
 assert.equal(entryAfter.coordinator_details.entryPermission,true);
 assert.equal((await db.query('select count(*)::int n from public.maintenance_requests where user_id=$1',[user])).rows[0].n,requestCount);
 assert.ok((await ctx(from)).messages.some(m=>m.jobId===entryJob.id && m.message==='Yes that is fine with me.'));
 // Another verified contact's unrelated detail must not restore revoked permission.
 await commit(from,(await ctx(from)).version,[{type:'add_details',jobId:washer.id,fields:{description:'Do not enter while I am away',facts:{entryPermission:false}}}]);
 const secondPhone='+13175556666';await db.query('insert into public.coordinator_contacts(user_id,phone,tenant_id) values($1,$2,$3)',[user,secondPhone,tenant]);
 await commit(secondPhone,0,[{type:'add_details',jobId:washer.id,fields:{description:'Only when used',facts:{leakPattern:'only_when_used'}}}]);
 assert.equal((await ctx(secondPhone)).jobs.find(j=>j.id===washer.id).coordinator_details.entryPermission,false);
 await commit(manager,3,[{type:'unlink_contact',fields:{phone:from}}]);
 assert.equal((await db.query("select count(*)::int n from public.coordinator_outbox where to_number=$1 and status='queued'",[from])).rows[0].n,0);
 const claimed=await db.query('select * from public.coordinator_claim_outbox($1)',[user]);assert.equal(claimed.rows.length,2);assert.equal(claimed.rows.some(r=>r.to_number===from),false);
 const again=await db.query('select * from public.coordinator_claim_outbox($1)',[user]);assert.equal(again.rows.some(x=>claimed.rows.some(y=>y.id===x.id)),false);
 await db.query("insert into public.maintenance_requests(user_id,property_id,title,description) values($1,$2,'Foreign','Private') returning id",[other,property]).then(async r=>{await assert.rejects(commit(manager,4,[{type:'complete_work',jobId:r.rows[0].id,fields:{}}]),/no rows/);});
 // Form submission atomically queues the staff alert and verified-tenant acknowledgement.
 const form=(await db.query("insert into public.maintenance_requests(user_id,property_id,tenant_id,title,description,source) values($1,$2,$3,'Kitchen window screen','Window screen needs repair','app') returning id",[user,property,tenant])).rows[0];
 const formRows=(await db.query("select to_number,body from public.coordinator_outbox where event_sid=$1",['app-maintenance:'+form.id])).rows;
 await db.query("update public.coordinator_outbox set status='sent' where event_sid=$1",['app-maintenance:'+form.id]);
 const formHistory=(await ctx(secondPhone)).messages;assert.ok(formHistory.some(m=>m.jobId===form.id && /permission to enter/i.test(m.reply||'')));assert.equal(formHistory[0].jobId,form.id);assert.match(formHistory[0].reply,/permission to enter/i);
 assert.equal(formRows.length,2);assert.equal(formRows.some(r=>r.to_number===maintenance),false);assert.ok(formRows.some(r=>r.to_number===manager));
 assert.ok(formRows.some(r=>r.to_number===secondPhone && /received your/i.test(r.body)));
 assert.doesNotMatch(formRows.find(r=>r.to_number===secondPhone).body,/#\d+|request #/);
 assert.match(formRows.find(r=>r.to_number===manager).body,/#\d+/);
 await commit(maintenance,(await ctx(maintenance)).version,[{type:'report_progress',jobId:form.id,fields:{description:'#'+(await ctx(maintenance)).jobs.find(j=>j.id===form.id).job_number+': Waiting for a replacement screen.'}}],{},'SMprogressLanguage');
 const progress=(await db.query("select body from public.coordinator_outbox where tenant_id=$1 and event_sid=$2",[tenant,'SMprogressLanguage'])).rows[0].body;
 assert.match(progress,/replacement screen/);assert.doesNotMatch(progress,/#\d+/);
 await commit(maintenance,(await ctx(maintenance)).version,[{type:'start_work',jobId:form.id,fields:{}}],{},'SMstartLanguage');
 const started=(await db.query('select body from public.coordinator_outbox where tenant_id=$1 and event_sid=$2',[tenant,'SMstartLanguage'])).rows[0].body;
 assert.match(started,/getting started.*window screen/);assert.doesNotMatch(started,/#\d+/);
 await db.query("update public.maintenance_requests set description='Clarified issue' where id=$1",[form.id]);
 assert.equal((await db.query('select count(*)::int n from public.coordinator_outbox where event_sid=$1',['app-maintenance:'+form.id])).rows[0].n,2);
 const beforePrivate=(await db.query('select count(*)::int n from public.coordinator_outbox')).rows[0].n;
 await commit(manager,4,[{type:'staff_event',fields:{eventTitle:'Supply pickup',appointmentStart:'2035-01-10T15:00:00Z',appointmentEnd:'2035-01-10T16:00:00Z'}}]);
 await db.query("insert into public.coordinator_staff_events(user_id,staff_phone,title,start_at,end_at) select $1,$2,'Historical event',timestamp with time zone '2020-01-01 10:00Z'+i*interval '1 day',timestamp with time zone '2020-01-01 11:00Z'+i*interval '1 day' from generate_series(1,101)i",[user,manager]);
 assert.equal((await ctx(manager)).staffEvents.length,1);assert.equal((await ctx(secondPhone)).staffEvents.length,0);
 assert.equal((await db.query('select count(*)::int n from public.coordinator_outbox')).rows[0].n,beforePrivate);
 await assert.rejects(commit(secondPhone,(await ctx(secondPhone)).version,[{type:'staff_event',fields:{eventTitle:'No',appointmentStart:'2035-01-11T15:00:00Z',appointmentEnd:'2035-01-11T16:00:00Z'}}]),/staff only/);
 await assert.rejects(commit(manager,5,[{type:'staff_event',fields:{eventTitle:'Conflicting pickup',appointmentStart:'2035-01-10T15:30:00Z',appointmentEnd:'2035-01-10T16:30:00Z'}}]),/conflict/);
 const requestVersion=(await ctx(secondPhone)).version;
 for(let i=0;i<2;i++) await commit(secondPhone,requestVersion+i,[{type:'request_scheduling',jobId:form.id,fields:{description:'Can we get this week?'}}]);
 assert.equal((await db.query('select count(*)::int n from public.coordinator_outbox where request_id=$1 and to_number=$2',[form.id,maintenance])).rows[0].n,0,'status requests cannot dispatch while entry permission is missing');
 assert.ok((await ctx(secondPhone)).jobs.every(j=>j.notes==null));
 // Staff alert -> unnumbered offer -> duplicate clarification -> natural staff confirmation.
 const staffForm=(await db.query("insert into public.maintenance_requests(user_id,property_id,tenant_id,title,description,source,coordinator_details) values($1,$2,$3,'Another report of window screen','Same window issue','app','{\"entryPermission\":true}'::jsonb) returning id",[user,property,tenant])).rows[0];
 await db.query("update public.coordinator_outbox set status='sent' where event_sid=$1 and to_number=$2",['app-maintenance:'+staffForm.id,maintenance]);
 await db.query("update public.maintenance_requests set coordinator_details=coordinator_details||'{\"entryPermission\":false}'::jsonb where id=any($1::uuid[])",[[form.id,staffForm.id]]);
 const staffVisit=[15,16,17].map(day=>({start:`2035-01-${day}T14:30:00Z`,end:`2035-01-${day}T15:30:00Z`}));
 const staffProposal=await run(maintenance,'I can come by at 9:30',{type:'offer_times',fields:{options:staffVisit}});
 assert.match(staffProposal,/Sarah/);assert.equal((await ctx(maintenance)).state.pendingOptions.jobId,staffForm.id);
 const duplicateReply=await run(maintenance,'These describe the same repair',{type:'related_jobs',fields:{jobIds:[form.id,staffForm.id]}});
 assert.match(duplicateReply,/9:30 AM/);assert.doesNotMatch(duplicateReply,/Does maintenance.*permission/);
 const primary=(await ctx(maintenance)).state.pendingOptions.jobId;
 const staffConfirmed=await run(maintenance,'Yes, please.');assert.match(staffConfirmed,/recorded the three options/);
 assert.equal((await ctx(secondPhone)).jobs.find(j=>j.id===primary).stage,'awaiting_selection');
 // Staff notes update the manager without echoing a second SMS back to maintenance.
 await run(maintenance,'These reports describe the same kitchen repair.',{type:'add_details',jobId:form.id,fields:{description:'Staff fixture note'}});
 const staffEvent=(await db.query('select sid from public.coordinator_events where phone=$1 order by created_at desc limit 1',[maintenance])).rows[0].sid;
 const staffNotices=(await db.query('select to_number,tenant_id from public.coordinator_outbox where event_sid=$1',[staffEvent])).rows;
 assert.ok(staffNotices.some(n=>n.to_number===manager));assert.equal(staffNotices.some(n=>n.to_number===maintenance),false);assert.ok(staffNotices.every(n=>n.tenant_id===null));
 await db.exec('set role anon');await assert.rejects(db.query('select public.coordinator_context($1,$2)',['+13175550000',from]),/permission denied/);await db.exec('reset role');
 } finally {await db.close();}
});
