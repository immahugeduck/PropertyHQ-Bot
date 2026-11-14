import {pathToFileURL} from 'node:url';
import {interpretMessage} from '../src/assistant.js';

// Exercise the same interpreter as the SMS runtime without loading contacts or committing actions.
export async function verifyModel({env=process.env,fetchImpl=globalThis.fetch}={}) {
  if(!String(env.OPENAI_API_KEY || '').replace(/\s+/g,'')) throw Error('OpenAI key is not configured');
  let responseStatus;
  const context={identity:{role:'unknown',state:'pending'},settings:{timezone:'America/Indiana/Indianapolis'},jobs:[],messages:[],state:{}};
  const intent=await interpretMessage({context,text:'Hello',env,fetchImpl:async(url,options)=>{
    const response=await fetchImpl(url,options);
    responseStatus=response.status;
    return response;
  }});
  if(responseStatus!==200) throw Error(responseStatus?`OpenAI verification returned HTTP ${responseStatus}`:'OpenAI verification did not return a response');
  return {provider:'openai',model:env.COORDINATOR_MODEL || 'gpt-4.1-mini',apiResponded:true,intentType:intent.type};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {console.log(JSON.stringify({type:'model_verification',...await verifyModel()}));}
  catch(error) {console.error(JSON.stringify({type:'model_verification',status:'failed',reason:error.message}));process.exitCode=1;}
}
