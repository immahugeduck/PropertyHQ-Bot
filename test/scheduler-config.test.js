import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliveryJob } from '../scripts/provision-delivery-job.mjs';
test('free scheduler job is disabled and uses authenticated POST every minute',()=>{const job=buildDeliveryJob('fixture-delivery-secret-32-characters');assert.equal(job.enabled,false);assert.equal(job.requestMethod,1);assert.deepEqual(job.schedule.minutes,[-1]);assert.equal(job.url,'https://maintenance-triage-agent.vercel.app/api/coordinator/deliver');assert.equal(job.extendedData.headers.Authorization,'Bearer fixture-delivery-secret-32-characters');assert.equal(job.notification.onFailure,true);assert.equal(job.saveResponses,false);});
test('missing or unsafe worker secret cannot provision a scheduler',()=>{assert.throws(()=>buildDeliveryJob('short'),/delivery secret/);assert.throws(()=>buildDeliveryJob('fixture-secret-with-32-characters\n'),/delivery secret/);});
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
function runCli(preload) {
 const dir=mkdtempSync(join(tmpdir(),'scheduler-fixture-'));
 try {const file=join(dir,'mock.mjs');writeFileSync(file,preload);return spawnSync(process.execPath,['--import',file,new URL('../scripts/provision-delivery-job.mjs',import.meta.url).pathname],{encoding:'utf8',env:{CRON_JOB_API_KEY:'fixture\nkey',COORDINATOR_DELIVERY_SECRET:'fixture-delivery-secret-32-characters'}});}
 finally {rmSync(dir,{recursive:true,force:true});}
}
test('scheduler CLI handles a wrapped key and still provisions only a disabled job',()=>{const r=runCli(`globalThis.fetch=async(url,opts)=>{new Headers(opts.headers);if(opts.headers.Authorization!=='Bearer fixturekey') throw Error('wrong header');if(opts.method==='GET') return {ok:true,json:async()=>({jobs:[]})};const body=JSON.parse(opts.body);if(body.job.enabled!==false)throw Error('must stay disabled');return {ok:true,json:async()=>({jobId:123})};};`);assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{jobId:123,enabled:false});});
test('scheduler CLI never prints credential-bearing fetch failures',()=>{const r=runCli(`globalThis.fetch=async()=>{throw Error('invalid header containing fixture-sensitive-secret');};`);assert.equal(r.status,1);assert.doesNotMatch(r.stderr,/fixture-sensitive-secret/);assert.match(r.stderr,/provisioning failed/);});
