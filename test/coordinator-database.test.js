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
 await db.query('insert into auth.users values ($1),($2)',[user,other]);
 await db.query('insert into public.triage_settings(user_id,twilio_number,maintenance_phone,manager_phone) values($1,$2,$3,$4)',[user,'+13175550000',maintenance,manager]);
 await db.query('insert into public.tenants(id,user_id,property_id,first_name,last_name,email,phone) values($1,$2,$3,$4,$5,$6,$7)',[tenant,user,property,'Sarah','Fixture','test@example.invalid',from]);
 await db.query("insert into public.properties(id,user_id,name,address,city,state,zip_code) values($1,$2,'Oak','12 Oak Unit 2','Town','IN','46000')",[property,user]);
 let c=await ctx(from);assert.equal(c.tenants[0].id,tenant);
 await commit(from,0,[{type:'new_request',fields:{description:'Kitchen leak'}}],{},'SMnew');
 assert.equal((await commit(from,0,[],{},'SMnew')).duplicate,true);
 await assert.rejects(commit(from,0,[]),/conversation changed/);
 c=await ctx(from);assert.equal(c.jobs.length,1);const job=c.jobs[0].id;assert.equal(c.jobs[0].address,'12 Oak Unit 2');assert.match((await db.query("select body from public.coordinator_outbox where event_sid='SMnew'")).rows[0].body,/12 Oak/);
 await assert.rejects(commit(from,1,[{type:'complete_work',jobId:job,fields:{}}]),/staff only/);
 const options=[{start:'2035-01-02T15:00:00Z',end:'2035-01-02T16:00:00Z'},{start:'2035-01-03T15:00:00Z',end:'2035-01-03T16:00:00Z'}];
 await commit(maintenance,0,[{type:'offer_times',jobId:job,fields:{options}}]);
 c=await ctx(from);assert.equal(c.jobs[0].proposal_version,1);
 await assert.rejects(commit(from,1,[{type:'select_time',jobId:job,fields:{choice:1,proposalVersion:0}}]),/stale/);
 await commit(from,1,[{type:'select_time',jobId:job,fields:{choice:1,proposalVersion:1}}]);
 assert.equal((await ctx(from)).jobs[0].status,'open');
 // A second job cannot claim the same staff window; failed selection rolls back.
 await commit(from,2,[{type:'new_request',fields:{description:'Different issue'}}]);
 const second=(await ctx(from)).jobs.find(j=>j.id!==job).id;
 await commit(maintenance,1,[{type:'offer_times',jobId:second,fields:{options}}]);
 await assert.rejects(commit(from,3,[{type:'select_time',jobId:second,fields:{choice:1,proposalVersion:1}}]),/unavailable/);
 assert.equal((await ctx(from)).version,3);
 await commit(manager,0,[{type:'complete_work',jobId:job,fields:{}}]);
 assert.equal((await ctx(from)).jobs.find(j=>j.id===job).status,'completed');
 assert.equal((await db.query("select count(*)::int n from public.coordinator_outbox where to_number=$1",[from])).rows[0].n,3);
 // Unknown contact collection survives independent calls; approval backfills history.
 const unknown='+13175552222';await commit(unknown,0,[],{name:'Sarah'});assert.equal((await ctx(unknown)).state.name,'Sarah');
 await commit(unknown,1,[{type:'request_link_approval',fields:{name:'Sarah',address:'12 Oak'}}],{name:'Sarah',address:'12 Oak'});
 await commit(manager,1,[{type:'approve_contact',fields:{phone:unknown,tenantId:tenant}}]);
 assert.equal((await ctx(unknown)).tenants[0].id,tenant);
 await commit(manager,2,[{type:'unlink_contact',fields:{phone:unknown}}]);assert.equal((await ctx(unknown)).tenants.length,0);
 assert.equal((await ctx('+13175553333')).jobs.length,0);
 await commit(manager,3,[{type:'unlink_contact',fields:{phone:from}}]);
 assert.equal((await db.query("select count(*)::int n from public.coordinator_outbox where to_number=$1 and status='queued'",[from])).rows[0].n,0);
 const claimed=await db.query('select * from public.coordinator_claim_outbox($1)',[user]);assert.equal(claimed.rows.length,2);assert.equal(claimed.rows.some(r=>r.to_number===from),false);
 const again=await db.query('select * from public.coordinator_claim_outbox($1)',[user]);assert.equal(again.rows.some(x=>claimed.rows.some(y=>y.id===x.id)),false);
 await db.query("insert into public.maintenance_requests(user_id,property_id,title,description) values($1,$2,'Foreign','Private') returning id",[other,property]).then(async r=>{await assert.rejects(commit(manager,4,[{type:'complete_work',jobId:r.rows[0].id,fields:{}}]),/no rows/);});
 await db.exec('set role anon');await assert.rejects(db.query('select public.coordinator_context($1,$2)',['+13175550000',from]),/permission denied/);await db.exec('reset role');
 } finally {await db.close();}
});
