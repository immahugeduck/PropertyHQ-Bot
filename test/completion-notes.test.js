import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCompletionCommand} from '../src/completion-command.js';
import {coordinatorFixture,contacts as c} from './helpers/coordinator-fixture.js';

export const completionExamples=[
  ['I got it with my little drain tool. I am finished. Thank you. DONE',true,null],
  ['DONE. Cleared the toilet with a drain tool.',true,null],
  ['DONE #1013 Replaced the valve.',true,'1013'],
  ['Cleared the drain. DONE #1013',true,'1013'],
  ['DONE!',true,null],
  ['DONE. I can confirm the leak is fixed.',true,null],
  ['Not DONE yet. Waiting for a part.',false],
  ['DONE. The repair is not finished yet.',false],
  ['I will be DONE tomorrow.',false],
  ['I will finish tomorrow. DONE',false],
  ["I'll finish tomorrow. DONE",false],
  ['Still waiting for a part. DONE',false],
  ['Nearly finished. DONE',false],
  ["I didn't finish the repair. DONE",false],
  ['I will have it fixed tomorrow. DONE',false],
  ["I'm going to finish tomorrow. DONE",false],
  ['I am unable to complete the repair today. DONE',false],
  ['DONE. The repair remains incomplete.',false],
  ['The renter wrote:\nDONE',false],
  ['The tenant sent this:\n"\nDONE\n"',false],
  ['Example:\n```\nDONE\n```',false],
  ['DONE. No tenant notification.',false],
  ['DONE. Without tenant notification.',false],
  ['DONE after the replacement arrives.',false],
  ['Is the repair DONE?',false],
  ['The tenant said "DONE".',false],
  ['Reply DONE when finished.',false],
  ['DONE #1013. DONE #1014',false],
  ['DONE #1013. Also fixed #1014.',false],
  ['DONE. Do not notify the tenant about this private note.',false],
  ['Done. Cleared the toilet.',false],
  ['DONE 1013',false],
  ['DONE#1013',false]
];
for(const [text,valid,number] of completionExamples) test('completion-note interpretation: '+text,()=>{
  const command=parseCompletionCommand(text);
  assert.equal(Boolean(command),valid);
  if(valid) assert.equal(command.jobNumber,number);
});

test('a maintenance note plus DONE completes one repair, retains the note and queues one notice per recipient',async()=>{
  const f=await coordinatorFixture();
  try {
    await f.run(c.tenantPhone,'My toilet will not flush. You have permission to enter while nobody is home.',{model:{type:'new_request',fields:{description:'Toilet will not flush',facts:{issue:'other',entryPermission:true,repairSummary:'Toilet will not flush'}}}});
    const job=(await f.context(c.tenantPhone)).jobs[0];
    await f.db.query("update public.coordinator_outbox set status='sent' where request_id=$1 and to_number=$2",[job.id,c.maintenance]);
    const text='I got it with my little drain tool. I am finished. Thank you. DONE';
    const result=await f.run(c.maintenance,text);
    assert.equal((await f.context(c.tenantPhone)).jobs[0].status,'completed');
    assert.match((await f.context(c.manager)).jobs[0].notes,/little drain tool/);
    const notices=await f.outbox(result.sid);
    assert.equal(notices.filter(row=>row.to_number===c.tenantPhone).length,1);
    assert.equal(notices.filter(row=>row.to_number===c.manager).length,1);
    const duplicate=await f.run(c.maintenance,text);
    assert.equal((await f.outbox(duplicate.sid)).length,0);
  } finally {await f.close();}
});

test('SQL and native completion rules agree, including notes and unsafe completion phrases',async()=>{
  const f=await coordinatorFixture();
  try {
    for(const [text,valid,number] of completionExamples) {
      const command=(await f.db.query('select to_jsonb(public.coordinator_completion_command($1)) as command',[text])).rows[0].command;
      assert.equal(Boolean(command),valid,text);
      if(valid) assert.equal(command[0],number,text);
    }
    for(const role of ['anon','authenticated']) {
      await f.db.exec('set role '+role);
      await assert.rejects(f.db.query("select public.coordinator_completion_command('DONE')"),/permission denied/);
      await f.db.exec('reset role');
    }
  } finally {await f.close();}
});

test('contradictory, quoted and private DONE notes keep the repair open through native and raw SQL paths',async()=>{
  const f=await coordinatorFixture();
  try {
    await f.run(c.tenantPhone,'My toilet will not flush. You have permission to enter.',{model:{type:'new_request',fields:{description:'Toilet will not flush',facts:{issue:'other',entryPermission:true}}}});
    const job=(await f.context(c.tenantPhone)).jobs[0];
    await f.db.query("update public.coordinator_outbox set status='sent' where request_id=$1 and to_number=$2",[job.id,c.maintenance]);
    let sequence=0;
    for(const [text] of completionExamples.filter(example=>!example[1])) {
      const result=await f.run(c.maintenance,text,{model:{type:'complete_work',jobId:job.id,fields:{description:text}}});
      assert.equal((await f.context(c.tenantPhone)).jobs[0].status,'open',text);
      assert.equal((await f.outbox(result.sid,c.tenantPhone)).filter(row=>/has finished.*work|request.*is completed/i.test(row.body)).length,0,text);
      const context=await f.context(c.maintenance);
      await f.db.query('select public.coordinator_commit($1,$2,$3,$4,$5,$6::jsonb)',[c.user,c.maintenance,'SMrejectedRaw'+(++sequence),context.version,text,JSON.stringify({reply:'Fixture',nextState:context.state,actions:[{type:'complete_work',jobId:job.id,fields:{description:text}}]})]);
      assert.equal((await f.context(c.tenantPhone)).jobs[0].status,'open',text);
    }
  } finally {await f.close();}
});
