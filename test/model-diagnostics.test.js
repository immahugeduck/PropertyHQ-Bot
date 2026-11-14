import test from 'node:test';
import assert from 'node:assert/strict';
import health from '../api/health.js';
import {interpretMessage} from '../src/assistant.js';
import {verifyModel} from '../scripts/verify-model.mjs';

const context={identity:{role:'tenant',state:'known',tenantId:'t'},settings:{timezone:'America/Indiana/Indianapolis'},state:{},jobs:[],messages:[]};
test('provider request status distinguishes missing key, rejected key and successful inference without exposing content',async t=>{
  const logs=[];
  t.mock.method(console,'info',message=>logs.push(JSON.parse(message)));
  await interpretMessage({context,text:'private tenant text',env:{ANTHROPIC_API_KEY:'fixture-claude-secret'}});
  await interpretMessage({context,text:'private tenant text',env:{OPENAI_API_KEY:'fixture-openai-secret'},fetchImpl:async()=>({ok:false,status:401})});
  await interpretMessage({context,text:'private tenant text',env:{OPENAI_API_KEY:'fixture-openai-secret'},fetchImpl:async()=>({ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify({type:'new_request',fields:{description:'Fixture'}})}}]})})});
  assert.deepEqual(logs.map(log=>log.status),['not_configured','http_error','ok']);
  assert.equal(logs[1].httpStatus,401);
  assert.equal(logs[2].provider,'openai');
  assert.equal(logs[2].model,'gpt-4.1-mini');
  assert.doesNotMatch(JSON.stringify(logs),/fixture-.*-secret|private tenant text/);
});

test('live health exposes only provider configuration flags and model name',()=>{
  const keys=['OPENAI_API_KEY','COORDINATOR_MODEL','COORDINATOR_ENABLED'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try {
    Object.assign(process.env,{OPENAI_API_KEY:'fixture-secret',COORDINATOR_MODEL:'fixture-model',COORDINATOR_ENABLED:'true'});
    let result;
    const response={status(code){assert.equal(code,200);return this;},json(body){result=body;}};
    health({method:'GET'},response);
    assert.equal(result.coordinatorEnabled,true);
    assert.equal(result.modelProvider,'openai');
    assert.equal(result.modelName,'fixture-model');
    assert.equal(result.modelKeyConfigured,true);
    assert.doesNotMatch(JSON.stringify(result),/fixture-secret/);
    process.env.OPENAI_API_KEY=' \n';
    health({method:'GET'},response);
    assert.equal(result.modelKeyConfigured,false);
  } finally {
    for(const key of keys) {
      if(previous[key]===undefined) delete process.env[key];
      else process.env[key]=previous[key];
    }
  }
});

test('the deployment probe uses the real interpreter request and rejects missing or unusable keys',async t=>{
  t.mock.method(console,'info',()=>{});
  const env={OPENAI_API_KEY:'fixture-secret'};
  let request;
  const result=await verifyModel({env,fetchImpl:async(url,options)=>{
    request={url,options};
    return {ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify({type:'clarify',fields:{}})}}]})};
  }});
  assert.equal(request.url,'https://api.openai.com/v1/chat/completions');
  assert.equal(request.options.headers.Authorization,'Bearer fixture-secret');
  assert.equal(JSON.parse(request.options.body).model,'gpt-4.1-mini');
  assert.equal(result.apiResponded,true);
  assert.doesNotMatch(JSON.stringify(result),/fixture-secret/);
  await assert.rejects(verifyModel({env:{}}),/not configured/);
  await assert.rejects(verifyModel({env,fetchImpl:async()=>({ok:false,status:401})}),/HTTP 401/);
  await assert.rejects(verifyModel({env,fetchImpl:async()=>{throw Error('private transport detail');}}),error=>!error.message.includes('private transport detail'));
});
