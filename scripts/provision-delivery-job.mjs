import { pathToFileURL } from 'node:url';
export function buildDeliveryJob(deliverySecret) {
  if (typeof deliverySecret !== 'string' || deliverySecret.length < 32 || /[\r\n]/.test(deliverySecret)) throw new Error('A valid delivery secret of at least 32 characters is required.');
  return {
    title:'Agent HQ notification delivery',url:'https://maintenance-triage-agent.vercel.app/api/coordinator/deliver',
    enabled:false,saveResponses:false,requestMethod:1,requestTimeout:30,
    schedule:{timezone:'America/Indiana/Indianapolis',expiresAt:0,hours:[-1],mdays:[-1],minutes:[-1],months:[-1],wdays:[-1]},
    extendedData:{headers:{Authorization:`Bearer ${deliverySecret}`}},
    notification:{onFailure:true,onFailureCount:1,onDisable:true,onSuccess:true}
  };
}
async function provision() {
  const secret=process.env.COORDINATOR_DELIVERY_SECRET;
  const job=buildDeliveryJob(secret);
  if(process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({...job,extendedData:{headers:{Authorization:'[redacted]'}}},null,2));return;
  }
  const key=process.env.CRON_JOB_API_KEY?.replace(/\s+/g,'');
  if(!key) throw new Error('Set CRON_JOB_API_KEY securely before provisioning.');
  const request=async(path,method='GET',body)=>{
    const response=await fetch(`https://api.cron-job.org${path}`,{method,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new Error(`Scheduler API returned HTTP ${response.status}.`);
    return response.json();
  };
  const list=await request('/jobs');
  if(!Array.isArray(list.jobs)) throw new Error('Unexpected scheduler response; no job was created.');
  const existing=list.jobs.filter(j=>j.url===job.url && j.title===job.title);
  if(existing.length>1) throw new Error('Multiple matching delivery jobs exist; resolve duplicates before continuing.');
  if(existing[0]?.enabled) throw new Error('Existing worker is enabled; provisioning will not disable or change it.');
  const result=existing.length ? await request(`/jobs/${existing[0].jobId}`,'PATCH',{job}) : await request('/jobs','PUT',{job});
  console.log(JSON.stringify({jobId:existing[0]?.jobId || result.jobId,enabled:false}));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  provision().catch(error=>{console.error('Scheduler provisioning failed. Check credentials and existing job settings. No job was enabled.');process.exitCode=1;});
}
