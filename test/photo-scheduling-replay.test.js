import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretMessage} from '../src/assistant.js';
import {decideConversation} from '../src/coordinator.js';
import {coordinatorFixture,contacts} from './helpers/coordinator-fixture.js';

const now=new Date('2026-11-10T16:37:00Z');
function context() {
  return {
    identity:{role:'maintenance',state:'known'},settings:{timezone:'America/Indiana/Indianapolis'},
    jobs:[{id:'toilet',job_number:1010,tenant_name:'Claude Fixture',status:'open',coordinator_details:{entryPermission:true},stage:'awaiting_staff'}],
    messages:[{reply:'Suggested visit: today at 1 PM. Shall I book this visit?',jobId:'toilet'}],state:{}
  };
}
async function turn(c,text) {
  const intent=await interpretMessage({context:c,text,now,env:{}});
  return decideConversation({context:{...c,inbound:text},intent,now});
}
test('the photo correction books 2 PM on the same repair after clarifying evening',async()=>{
  const c=context();
  const clarification=await turn(c,'Okay. Schedule for this evening at 2pm');
  assert.equal(clarification.actions.length,0);
  assert.match(clarification.reply,/2:00 PM.*evening/i);
  c.state=clarification.nextState;
  c.messages.unshift({reply:clarification.reply});
  const booked=await turn(c,'Schedule for 2pm today');
  assert.equal(booked.actions[0]?.type,'book_visit');
  assert.equal(booked.actions[0]?.jobId,'toilet');
  assert.equal(booked.actions[0]?.fields.options[0]?.start,'2026-11-10T19:00:00.000Z');
});
test('a polite yes approves the one displayed visit',async()=>{
  const c=context();
  const option={start:'2026-11-10T19:00:00Z',end:'2026-11-10T20:00:00Z',flexible:false};
  c.jobs[0].options=[option];c.jobs[0].proposal_version=2;
  c.messages[0].scheduleProposal={jobId:'toilet',options:[option],proposalVersion:2};
  const booked=await turn(c,'Yes. Thank you!');
  assert.equal(booked.actions[0]?.type,'book_visit');
  assert.equal(booked.actions[0]?.jobId,'toilet');
});
test('staff calendar entry keeps priority over a repair when it is awaiting a time',async()=>{
  const c=context();c.state.pendingStaffEvent={title:'Pick up a part'};
  const result=await turn(c,'Schedule for 2pm today');
  assert.equal(result.actions[0]?.type,'staff_event');
  assert.equal(result.actions[0]?.fields.appointmentStart,'2026-11-10T19:00:00.000Z');
});

test('a time clarification keeps the named repair after a database reload with another alert in history',async()=>{
  const f=await coordinatorFixture();
  try {
    const first=await f.run(contacts.tenantPhone,'My toilet runs. You have permission to enter while nobody is home.',{
      model:{type:'new_request',fields:{description:'Toilet keeps running',facts:{issue:'other',entryPermission:true}}}
    });
    const firstJob=(await f.context(contacts.tenantPhone)).jobs[0];
    await f.db.query("update public.coordinator_outbox set status='sent' where event_sid=$1 and to_number=$2",[first.sid,contacts.maintenance]);
    await f.run(contacts.tenantPhone,'My washer will not turn on. You have permission to enter while nobody is home.',{
      model:{type:'new_request',fields:{description:'Washer will not turn on',facts:{issue:'washer',entryPermission:true}}}
    });
    const target=(await f.context(contacts.tenantPhone)).jobs.find(job=>job.id!==firstJob.id);
    const clarification=await f.run(contacts.maintenance,`#${target.job_number} Schedule for tomorrow evening at 2pm`);
    assert.match(clarification.reply,/2:00 PM.*evening/);
    const corrected=await f.run(contacts.maintenance,'Schedule for 2pm tomorrow');
    assert.match(corrected.reply,/scheduled/);
    const saved=(await f.context(contacts.tenantPhone)).jobs;
    assert.ok(saved.find(job=>job.id===target.id).scheduled_at);
    assert.equal(saved.find(job=>job.id===firstJob.id).scheduled_at,null);
  } finally {await f.close();}
});
