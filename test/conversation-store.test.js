import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContext, commitDecision } from '../src/conversation-store.js';
import { dispatchPending } from '../src/notifications.js';
const db={url:'https://example.invalid',key:'fixture'};
test('missing configuration and persistence errors fail closed',async()=>{await assert.rejects(loadContext({db:null,params:{}}));await assert.rejects(commitDecision({db,context:{scope:{},version:1},eventId:'SM1',decision:{},fetchImpl:async()=>({ok:false,status:409,text:async()=>''})}));});
test('duplicate commit is surfaced without dispatching actions twice',async()=>{const r=await commitDecision({db,context:{scope:{userId:'u'},version:1,fromNumber:'+13175551111'},eventId:'SM1',decision:{reply:'ok',actions:[],nextState:{}},message:'hi',fetchImpl:async(_u,o)=>{assert.match(o.body,/SM1/);return {ok:true,status:200,text:async()=>JSON.stringify({duplicate:true})};}});assert.equal(r.duplicate,true);});
test('outbox claims recipients from database and never retries uncertain delivery',async()=>{let sent=0;const calls=[];await dispatchPending({db,scope:{userId:'u'},env:{COORDINATOR_OUTBOUND_ENABLED:'true'},sendImpl:async()=>{sent++;throw Error('timeout');},fetchImpl:async(url,o)=>{calls.push([url,JSON.parse(o.body)]);return {ok:true,status:200,text:async()=>url.endsWith('coordinator_claim_outbox')?JSON.stringify([{id:'a',to_number:'+13175556088',from_number:'+13175550000',body:'update'}]):'{}'};}});assert.equal(sent,1);assert.equal(calls[1][1].p_status,'uncertain');});
