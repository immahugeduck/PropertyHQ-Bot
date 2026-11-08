import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {loadContext,commitDecision} from '../../src/conversation-store.js';
import {coordinateSms} from '../../src/conversation-service.js';
import {interpretMessage} from '../../src/assistant.js';

export const contacts={
  user:'11111111-1111-4111-8111-111111111111',
  tenant:'33333333-3333-4333-8333-333333333333',
  property:'44444444-4444-4444-8444-444444444444',
  tenantPhone:'+13175551111',maintenance:'+13175559030',manager:'+13175556088',agent:'+13175550000'
};
const hq=new URL('../../../PropertyHQ/',import.meta.url);
const baseMigrations=[
  '20261014000000_maintenance_triage.sql','20261102000000_conversation_coordinator.sql',
  '20261102010000_conversation_flow_refinements.sql','20261107000000_workflow_repairs.sql',
  '20261107010000_tenant_conversation_language.sql','20261107020000_staff_conversation_continuity.sql',
  '20261107030000_permission_led_scheduling.sql'
];

// Real Postgres functions behind the actual REST/RPC boundary. Only the
// external model response is a fixture; dispatch never calls a carrier.
export async function coordinatorFixture() {
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      create function public.is_tenant_of(uuid) returns boolean language sql as 'select false';
      create function public.set_updated_at() returns trigger language plpgsql as $$begin new.updated_at:=now();return new;end$$;`);
    const schema=await readFile(new URL('supabase/schema.sql',hq),'utf8');
    for(const name of ['tenants','maintenance_requests','properties']) {
      const definition=schema.match(new RegExp('create table if not exists public.'+name+' \\([\\s\\S]*?\\n\\);'))[0];
      await db.exec(definition+`;alter table public.${name} add primary key(id);`);
    }
    const migrationDir=new URL('supabase/migrations/',hq);
    const files=await readdir(migrationDir);
    const migrations=[...baseMigrations,...files.filter(f=>f.endsWith('_tenant_maintenance_handoff.sql')).sort()];
    for(const file of migrations) await db.exec(await readFile(new URL(file,migrationDir),'utf8'));
    const c=contacts;
    await db.query('insert into auth.users values($1)',[c.user]);
    await db.query("insert into public.triage_settings(user_id,twilio_number,maintenance_phone,manager_phone,open_days,open_time,close_time) values($1,$2,$3,$4,ARRAY[1,2,3,4,5]::smallint[],'09:00','18:00')",[c.user,c.agent,c.maintenance,c.manager]);
    await db.query("insert into public.properties(id,user_id,name,address,city,state,zip_code) values($1,$2,'Fixture','508 Fixture St','Town','IN','46000')",[c.property,c.user]);
    await db.query('insert into public.tenants(id,user_id,property_id,first_name,last_name,email,phone) values($1,$2,$3,$4,$5,$6,$7)',[c.tenant,c.user,c.property,'Bree','Fixture','test@example.invalid',c.tenantPhone]);
    let seq=0;
    const config={url:'https://database.fixture.invalid',key:'fixture'};
    const fetchDb=async(url,options)=>{
      const name=url.split('/').pop();
      if(!['coordinator_context','coordinator_commit'].includes(name)) throw Error('Unexpected fixture request');
      const args=JSON.parse(options.body),keys=Object.keys(args);
      const query=`select public.${name}(${keys.map((key,i)=>`${key} => $${i+1}`).join(',')}) as result`;
      try {
        const result=await db.query(query,keys.map(k=>typeof args[k]==='object' && args[k]!==null?JSON.stringify(args[k]):args[k]));
        return {ok:true,status:200,text:async()=>JSON.stringify(result.rows[0].result)};
      } catch(error) {return {ok:false,status:409,text:async()=>JSON.stringify({error:error.message})};}
    };
    const context=phone=>loadContext({db:config,params:{To:c.agent,From:phone},fetchImpl:fetchDb});
    const run=async(phone,text,{model,sid=`SMfixture${++seq}`}={})=>{
      const reply=await coordinateSms({params:{From:phone,To:c.agent,Body:text,MessageSid:sid},fetchImpl:fetchDb,
        load:a=>loadContext({...a,db:config}),commit:a=>commitDecision({...a,db:config}),
        interpret:a=>interpretMessage({...a,env:model?{OPENAI_API_KEY:'fixture'}:{},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(model)}}]})})})});
      return {reply,sid};
    };
    const outbox=async(sid,phone)=>(await db.query('select * from public.coordinator_outbox where user_id=$1 and event_sid=$2 and ($3::text is null or to_number=$3) order by created_at,id',[c.user,sid,phone??null])).rows;
    return {db,run,context,outbox,close:()=>db.close()};
  } catch(error) {await db.close();throw error;}
}
