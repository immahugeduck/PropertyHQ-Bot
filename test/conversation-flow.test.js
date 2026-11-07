import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinateSms } from '../src/conversation-service.js';
const params={To:'+13175550000',From:'+13175551111',Body:'my tap drips',MessageSid:'SM-test'};
const context={scope:{userId:'u'},identity:{state:'known',role:'tenant',tenantId:'t',propertyId:'p',name:'Sarah'},settings:{timezone:'America/Indiana/Indianapolis'},jobs:[],state:{},version:0,inbound:params.Body};
test('SMS coordinates known tenant and only acknowledges after commit',async()=>{const calls=[];const d=await coordinateSms({params,load:async()=>context,interpret:async()=>({type:'new_request',fields:{description:'tap drips'}}),commit:async({decision})=>{calls.push(decision);return {applied:true};},dispatch:async()=>[]});assert.match(d,/Sarah/);assert.equal(calls[0].actions[0].type,'new_request');});
test('failed commit never claims successful recording',async()=>{const d=await coordinateSms({params,load:async()=>context,interpret:async()=>({type:'new_request',fields:{description:'tap drips'}}),commit:async()=>{throw Error('db down');}});assert.doesNotMatch(d,/I’ve recorded/);assert.match(d,/couldn’t save/);});
test('emergency never waits for AI and still returns guidance on database failure',async()=>{const d=await coordinateSms({params:{...params,Body:'I smell gas'},load:async()=>{throw Error('db down');},interpret:async()=>{throw Error('must not call AI');}});assert.match(d,/911/);assert.match(d,/couldn’t/);});
test('duplicate commit returns silent TwiML response without sending notifications',async()=>{let sent=false;const r=await coordinateSms({params,load:async()=>context,interpret:async()=>({type:'clarify'}),commit:async()=>({duplicate:true}),dispatch:async()=>{sent=true;}});assert.equal(r,'');assert.equal(sent,false);});
