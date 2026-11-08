import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinatorFixture,contacts as c} from './helpers/coordinator-fixture.js';

test('BREE raw permission answer survives commit and context reload on one ticket',async()=>{
  const f=await coordinatorFixture();
  try {
    const report="Hey, no hurry but my washer won't turn on in the basement.";
    const intake=await f.run(c.tenantPhone,report,{model:{type:'new_request',fields:{description:"Washer in the basement won't turn on",facts:{issue:'washer'}}}});
    assert.match(intake.reply,/permission.*enter.*\?/i);
    const before=await f.context(c.tenantPhone);
    assert.equal(before.jobs.length,1);
    const permission=await f.run(c.tenantPhone,'Yes permission granted.');
    assert.match(permission.reply,/recorded.*permission/i);
    assert.doesNotMatch(permission.reply,/\?/);
    const after=await f.context(c.tenantPhone);
    assert.equal(after.jobs.length,1);
    assert.equal(after.jobs[0].id,before.jobs[0].id);
    assert.equal(after.jobs[0].coordinator_details.entryPermission,true);
    const notices=await f.outbox(permission.sid);
    assert.ok(notices.some(n=>n.to_number===c.maintenance));
    assert.ok(notices.some(n=>n.to_number===c.manager));
    for(const notice of notices) {
      assert.match(notice.body,/permission to enter.*(?:confirmed|granted)/i);
      assert.doesNotMatch(notice.body,/not yet confirmed|permission is pending/i);
    }
  } finally {await f.close();}
});

test('maintenance gets one work order while the manager receives the tenant context',async()=>{
  const f=await coordinatorFixture();
  try {
    const text="Hey, no hurry but my washer won't turn on in the basement.";
    const intake=await f.run(c.tenantPhone,text,{model:{type:'new_request',fields:{description:"Washer in the basement won't turn on",facts:{issue:'washer'}}}});
    const initial=await f.outbox(intake.sid);
    assert.ok(initial.some(n=>n.to_number===c.manager && n.body.includes(text)));
    const job=(await f.context(c.tenantPhone)).jobs[0];
    const permission=await f.run(c.tenantPhone,'Yes permission granted.');
    const maintenance=(await f.outbox(permission.sid,c.maintenance))[0];
    const manager=(await f.outbox(permission.sid,c.manager))[0];
    assert.ok(maintenance);
    assert.equal((maintenance.body.match(new RegExp('#'+job.job_number+'\\b','g'))||[]).length,1);
    assert.match(maintenance.body,/508 Fixture St/);
    assert.match(maintenance.body,/washer.*basement|basement.*washer/i);
    assert.match(maintenance.body,/permission to enter.*granted/i);
    assert.doesNotMatch(maintenance.body,/Yes permission granted|Update for|New request.*from/i);
    assert.match(maintenance.body,/Shall I book this visit\?$/);
    assert.ok(maintenance.schedule_proposal?.proposalVersion);
    assert.match(manager.body,/Yes permission granted/);
    assert.doesNotMatch(manager.body,/Shall I book/);
  } finally {await f.close();}
});

test('an unresolved entry clarification stays with the manager without another maintenance alert',async()=>{
  const f=await coordinatorFixture();
  try {
    await f.run(c.tenantPhone,'Washer is not working',{model:{type:'new_request',fields:{description:'Washer not working',facts:{issue:'washer'}}}});
    const update=await f.run(c.tenantPhone,'Maybe, I need to check.');
    assert.match(update.reply,/permission.*enter/i);
    assert.equal((await f.outbox(update.sid,c.maintenance)).length,0);
    assert.ok((await f.outbox(update.sid,c.manager)).some(n=>/Maybe, I need to check/.test(n.body)));
  } finally {await f.close();}
});

test('repeated unchanged permission preserves the staff proposal without another maintenance alert',async()=>{
  const f=await coordinatorFixture();
  try {
    await f.run(c.tenantPhone,'Washer not working',{model:{type:'new_request',fields:{description:'Washer not working',facts:{issue:'washer'}}}});
    await f.run(c.tenantPhone,'Yes permission granted.');
    const before=(await f.context(c.maintenance)).jobs[0];
    const repeated=await f.run(c.tenantPhone,'You have my permission to enter while nobody is home.');
    const after=(await f.context(c.maintenance)).jobs[0];
    assert.equal((await f.outbox(repeated.sid,c.maintenance)).length,0);
    assert.equal(after.proposal_version,before.proposal_version);
    assert.deepEqual(after.options,before.options);
    assert.equal(after.coordinator_details.entryPermission,true);
  } finally {await f.close();}
});

test('a form-created repair uses the same simple maintenance handoff and manager context',async()=>{
  const f=await coordinatorFixture();
  try {
    const row=(await f.db.query("insert into public.maintenance_requests(user_id,tenant_id,property_id,title,description,source) values($1,$2,$3,'Window screen','Bedroom window screen is torn','app') returning id,job_number",[c.user,c.tenant,c.property])).rows[0];
    const notices=await f.outbox('app-maintenance:'+row.id);
    assert.ok(notices.some(n=>n.to_number===c.manager));
    const staff=notices.find(n=>n.to_number===c.maintenance);
    assert.ok(staff);
    assert.equal((staff.body.match(new RegExp('#'+row.job_number+'\\b','g'))||[]).length,1);
    assert.match(staff.body,/Bedroom window screen is torn/);
    assert.match(staff.body,/permission to enter.*(?:pending|not yet confirmed)/i);
    assert.ok(notices.some(n=>n.to_number===c.tenantPhone && /received.*request/i.test(n.body)));
  } finally {await f.close();}
});

test('a revocation after booking reaches maintenance with the current entry restriction',async()=>{
  const f=await coordinatorFixture();
  try {
    await f.run(c.tenantPhone,'Washer not working',{model:{type:'new_request',fields:{description:'Washer not working',facts:{issue:'washer'}}}});
    const grant=await f.run(c.tenantPhone,'Yes permission granted.');
    await f.db.query("update public.coordinator_outbox set status='sent' where event_sid=$1 and to_number=$2",[grant.sid,c.maintenance]);
    const booked=await f.run(c.maintenance,'Yes');
    assert.match(booked.reply,/scheduled/);
    const before=(await f.context(c.tenantPhone)).jobs[0];
    assert.ok(before.scheduled_at);
    const revoked=await f.run(c.tenantPhone,'You do not have my permission to enter.');
    const after=(await f.context(c.tenantPhone)).jobs[0];
    assert.equal(after.coordinator_details.entryPermission,false);
    assert.equal(after.scheduled_at,before.scheduled_at);
    const notice=(await f.outbox(revoked.sid,c.maintenance))[0];
    assert.ok(notice);
    assert.match(notice.body,/not granted; arrange access/i);
    assert.match(notice.body,/Visit:/);
    assert.doesNotMatch(notice.body,/home: granted|Shall I book/);
  } finally {await f.close();}
});

test('work-order lookup is account-scoped and unavailable to public client roles',async()=>{
  const f=await coordinatorFixture();
  try {
    await f.run(c.tenantPhone,'Washer not working',{model:{type:'new_request',fields:{description:'Washer not working',facts:{issue:'washer'}}}});
    const job=(await f.context(c.tenantPhone)).jobs[0];
    const foreign=(await f.db.query('select public.coordinator_work_order($1,$2) as body',['22222222-2222-4222-8222-222222222222',job.id])).rows[0].body;
    assert.equal(foreign,null);
    for(const role of ['anon','authenticated']) {
      await f.db.exec('set role '+role);
      await assert.rejects(f.db.query('select public.coordinator_work_order($1,$2)',[c.user,job.id]),/permission denied/);
      await f.db.exec('reset role');
    }
  } finally {await f.close();}
});

test('washer workflow books only after maintenance approval, then recalls and completes the saved repair',async()=>{
  const f=await coordinatorFixture();
  try {
    const report='Washer in the basement will not turn on.';
    const model={type:'new_request',fields:{description:report,facts:{issue:'washer'}}};
    const intake=await f.run(c.tenantPhone,report,{model});
    const granted=await f.run(c.tenantPhone,'Yes permission granted.');
    const proposal=(await f.context(c.maintenance)).jobs[0];
    assert.equal(proposal.stage,'awaiting_staff');
    assert.equal(proposal.scheduled_at,null,'tenant permission alone must not book');
    await f.db.query("update public.coordinator_outbox set status='sent' where event_sid=$1 and to_number=$2",[granted.sid,c.maintenance]);
    const booking=await f.run(c.maintenance,'Yes, please.');
    assert.match(booking.reply,/scheduled/);
    const saved=(await f.context(c.tenantPhone)).jobs[0];
    assert.equal(Date.parse(saved.scheduled_at),Date.parse(proposal.options[0].start));
    assert.equal(saved.coordinator_details.entryPermission,true);
    const notice=(await f.outbox(booking.sid,c.tenantPhone))[0];
    assert.match(notice.body,/scheduled/);
    assert.doesNotMatch(notice.body,/\?|#\d+|which.*time|reply confirm/i);
    const status=await f.run(c.tenantPhone,'When is the washer visit?',{model:{type:'request_status',jobId:saved.id,fields:{}}});
    assert.match(status.reply,/scheduled/i);
    assert.equal((await f.outbox(status.sid,c.maintenance)).length,0);
    const started=await f.run(c.maintenance,'Starting the washer repair',{model:{type:'start_work',jobId:saved.id,fields:{description:'Starting the washer repair'}}});
    assert.equal((await f.context(c.tenantPhone)).jobs[0].status,'in_progress');
    assert.ok((await f.outbox(started.sid,c.tenantPhone)).some(n=>/getting started/i.test(n.body)));
    const completed=await f.run(c.maintenance,'Washer repaired',{model:{type:'complete_work',jobId:saved.id,fields:{description:'Washer repaired'}}});
    assert.equal((await f.context(c.tenantPhone)).jobs[0].status,'completed');
    assert.ok((await f.outbox(completed.sid,c.tenantPhone)).some(n=>/finished/i.test(n.body)));
    const countBefore=(await f.db.query('select count(*)::int as n from public.coordinator_outbox')).rows[0].n;
    const duplicate=await f.run(c.tenantPhone,report,{model,sid:intake.sid});
    assert.equal(duplicate.reply,'');
    assert.equal((await f.context(c.tenantPhone)).jobs.length,1);
    assert.equal((await f.db.query('select count(*)::int as n from public.coordinator_outbox')).rows[0].n,countBefore);
  } finally {await f.close();}
});

test('sink scheduling saves changed availability, clears the old choice, and requires tenant agreement',async()=>{
  const f=await coordinatorFixture();
  try {
    await f.run(c.tenantPhone,'Kitchen disposal will not work, possible leak',{model:{type:'new_request',fields:{description:'Kitchen disposal not working; possible leak',facts:{issue:'sink_disposal',leakPattern:'uncertain'}}}});
    const refused=await f.run(c.tenantPhone,'No');
    const plan=(await f.context(c.maintenance)).jobs[0];
    assert.equal(plan.options.length,3);
    await f.db.query("update public.coordinator_outbox set status='sent' where event_sid=$1 and to_number=$2",[refused.sid,c.maintenance]);
    const approved=await f.run(c.maintenance,'Yes');
    const choices=(await f.context(c.tenantPhone)).jobs[0];
    assert.equal(choices.stage,'awaiting_selection');
    assert.match((await f.outbox(approved.sid,c.tenantPhone))[0].body,/Which time works/);
    assert.equal(choices.scheduled_at,null);
    assert.match((await f.run(c.tenantPhone,'1')).reply,/Does that time work/);
    const alternatives=await f.run(c.tenantPhone,"Those times don't work. Weekdays after 4 PM instead.",{model:{type:'request_alternatives',jobId:choices.id,fields:{description:'Weekdays after 4 PM instead',facts:{availability:'Weekdays after 4 PM',entryPermission:null}}}});
    const reloaded=await f.context(c.tenantPhone),job=reloaded.jobs[0];
    assert.equal(job.coordinator_details.availability,'Weekdays after 4 PM');
    assert.equal(job.coordinator_details.entryPermission,false);
    assert.equal(reloaded.state.pendingSelection,undefined);
    assert.deepEqual(job.options,[]);
    assert.equal(job.stage,'rescheduling');
    assert.equal(job.scheduled_at,null);
    const update=(await f.outbox(alternatives.sid,c.maintenance))[0];
    assert.match(update.body,/Tenant availability: Weekdays after 4 PM/);
    assert.match(update.body,/New visit times needed/);
    assert.equal((await f.outbox(alternatives.sid,c.tenantPhone)).length,0);
    await assert.rejects(f.db.query('select public.coordinator_commit($1,$2,$3,$4,$5,$6::jsonb)',[c.user,c.tenantPhone,'SMstale',reloaded.version,'Old option',JSON.stringify({reply:'Old option',nextState:{},actions:[{type:'select_time',jobId:job.id,fields:{choice:1,proposalVersion:choices.proposal_version}}]})]),/stale/);
    // Staff deliberately provides revised exact visits; no time is invented by
    // the tenant's free-text availability or by the test's model response.
    const revised=[0,1,2].map(day=>{
      const start=Date.parse(plan.options[0].start)+day*86400000+8*3600000;
      return {start:new Date(start).toISOString(),end:new Date(start+3600000).toISOString()};
    });
    const review=await f.run(c.maintenance,'Revised sink visit times',{model:{type:'offer_times',jobId:job.id,fields:{options:revised}}});
    assert.match(review.reply,/Shall I send/);
    await f.run(c.maintenance,'Yes');
    await f.run(c.tenantPhone,'2');
    assert.equal((await f.context(c.tenantPhone)).jobs[0].scheduled_at,null);
    const confirmed=await f.run(c.tenantPhone,'Yes, that works.');
    assert.match(confirmed.reply,/scheduled/);
    assert.equal(Date.parse((await f.context(c.tenantPhone)).jobs[0].scheduled_at),Date.parse(revised[1].start));
  } finally {await f.close();}
});

test('a distinct window-screen repair keeps the permission answer on the newly asked job',async()=>{
  const f=await coordinatorFixture();
  try {
    await f.run(c.tenantPhone,'Washer not working',{model:{type:'new_request',fields:{description:'Washer not working',facts:{issue:'washer'}}}});
    const washer=(await f.context(c.tenantPhone)).jobs[0];
    const screen=await f.run(c.tenantPhone,'Also, the bedroom window screen is torn.',{model:{type:'new_request',fields:{description:'Bedroom window screen is torn',facts:{issue:'window_screen'}}}});
    assert.match(screen.reply,/permission.*enter/);
    assert.doesNotMatch(screen.reply,/main.*door/i);
    await f.run(c.tenantPhone,'Yes permission granted.');
    const jobs=(await f.context(c.tenantPhone)).jobs;
    assert.equal(jobs.length,2);
    assert.equal(jobs.find(j=>j.id===washer.id).coordinator_details.entryPermission,undefined);
    assert.equal(jobs.find(j=>j.coordinator_details.issue==='window_screen').coordinator_details.entryPermission,true);
  } finally {await f.close();}
});

test('an emergency still routes immediately to the manager without ordinary scheduling',async()=>{
  const f=await coordinatorFixture();
  try {
    const emergency=await f.run(c.tenantPhone,'I smell gas in the kitchen.');
    assert.match(emergency.reply,/leave|evacuat|outside/i);
    assert.doesNotMatch(emergency.reply,/permission.*enter.*\?/i);
    const manager=await f.outbox(emergency.sid,c.manager);
    assert.ok(manager.some(n=>/EMERGENCY/.test(n.body)));
    assert.ok(manager.every(n=>!/Shall I book/.test(n.body)));
    assert.equal((await f.outbox(emergency.sid,c.maintenance)).length,0);
    assert.equal((await f.db.query('select urgency from public.maintenance_requests where user_id=$1',[c.user])).rows[0].urgency,'emergency');
  } finally {await f.close();}
});

test('an occupied staff slot rejects booking without a false tenant confirmation',async()=>{
  const f=await coordinatorFixture();
  try {
    await f.run(c.tenantPhone,'Washer not working',{model:{type:'new_request',fields:{description:'Washer not working',facts:{issue:'washer'}}}});
    const grant=await f.run(c.tenantPhone,'Yes permission granted.');
    const proposal=(await f.context(c.maintenance)).jobs[0];
    await f.db.query("update public.coordinator_outbox set status='sent' where event_sid=$1 and to_number=$2",[grant.sid,c.maintenance]);
    await f.db.query("insert into public.maintenance_requests(user_id,property_id,title,description,source,scheduled_at) values($1,$2,'Other repair','Already booked','sms',$3)",[c.user,c.property,proposal.options[0].start]);
    const attempt=await f.run(c.maintenance,'Yes');
    assert.match(attempt.reply,/couldn’t save/i);
    const actual=(await f.context(c.tenantPhone)).jobs.find(j=>j.id===proposal.id);
    assert.equal(actual.scheduled_at,null);
    assert.equal((await f.outbox(attempt.sid,c.tenantPhone)).length,0);
  } finally {await f.close();}
});

test('repeating BREE exact answer does not forward it to maintenance after the acknowledgement',async()=>{
  const f=await coordinatorFixture();
  try {
    await f.run(c.tenantPhone,'Washer not working',{model:{type:'new_request',fields:{description:'Washer not working',facts:{issue:'washer'}}}});
    await f.run(c.tenantPhone,'Yes permission granted.');
    const before=(await f.context(c.maintenance)).jobs[0];
    const repeated=await f.run(c.tenantPhone,'Yes permission granted.',{model:{type:'add_details',jobId:before.id,fields:{description:'Yes permission granted.',facts:{entryPermission:true}}}});
    assert.equal((await f.outbox(repeated.sid,c.maintenance)).length,0);
    assert.equal((await f.context(c.maintenance)).jobs[0].proposal_version,before.proposal_version);
    assert.equal((await f.context(c.tenantPhone)).jobs[0].coordinator_details.entryPermission,true);
  } finally {await f.close();}
});

test('a scheduled repair update still reaches maintenance when it needs no new scheduling',async()=>{
  const f=await coordinatorFixture();
  try {
    await f.run(c.tenantPhone,'Washer not working',{model:{type:'new_request',fields:{description:'Washer not working',facts:{issue:'washer'}}}});
    const grant=await f.run(c.tenantPhone,'Yes permission granted.');
    await f.db.query("update public.coordinator_outbox set status='sent' where event_sid=$1 and to_number=$2",[grant.sid,c.maintenance]);
    await f.run(c.maintenance,'Yes');
    const job=(await f.context(c.tenantPhone)).jobs[0];
    const text='The washer is now making a loud grinding noise.';
    const update=await f.run(c.tenantPhone,text,{model:{type:'add_details',jobId:job.id,fields:{description:text,facts:{}}}});
    const notice=(await f.outbox(update.sid,c.maintenance))[0];
    assert.ok(notice);
    assert.match(notice.body,/loud grinding noise/);
    assert.equal((await f.context(c.tenantPhone)).jobs[0].scheduled_at,job.scheduled_at);
  } finally {await f.close();}
});

test('new repair details survive alongside structured facts in the maintenance message',async()=>{
  const f=await coordinatorFixture();
  try {
    await f.run(c.tenantPhone,'Screen door needs repair',{model:{type:'new_request',fields:{description:'Screen door needs repair',facts:{issue:'screen_door'}}}});
    const job=(await f.context(c.tenantPhone)).jobs[0];
    const door='The main entry door also will not lock.';
    const update=await f.run(c.tenantPhone,door,{model:{type:'add_details',jobId:job.id,fields:{description:door,facts:{mainDoorSecure:false}}}});
    assert.match((await f.outbox(update.sid,c.maintenance))[0].body,/main entry door.*not lock/i);
    const location='The damaged screen door is beside the basement stairs.';
    const followup=await f.run(c.tenantPhone,location,{model:{type:'add_details',jobId:job.id,fields:{description:location,facts:{issue:'screen_door'}}}});
    assert.match((await f.outbox(followup.sid,c.maintenance))[0].body,/basement stairs/);
  } finally {await f.close();}
});

test('mixed alternatives and entry refusal save availability and cannot confirm the rejected time',async()=>{
  const f=await coordinatorFixture();
  try {
    await f.run(c.tenantPhone,'Washer not working',{model:{type:'new_request',fields:{description:'Washer not working',facts:{issue:'washer'}}}});
    const refusal=await f.run(c.tenantPhone,'No');
    await f.db.query("update public.coordinator_outbox set status='sent' where event_sid=$1 and to_number=$2",[refusal.sid,c.maintenance]);
    await f.run(c.maintenance,'Yes');
    await f.run(c.tenantPhone,'1');
    const job=(await f.context(c.tenantPhone)).jobs[0];
    const text="Those times don't work. You do not have my permission to enter. Weekdays after 4 PM instead.";
    const update=await f.run(c.tenantPhone,text,{model:{type:'request_alternatives',jobId:job.id,fields:{description:text,facts:{entryPermission:false,availability:'Weekdays after 4 PM'}}}});
    const after=await f.context(c.tenantPhone);
    assert.equal(after.state.pendingSelection,undefined);
    assert.equal(after.jobs[0].coordinator_details.availability,'Weekdays after 4 PM');
    assert.equal(after.jobs[0].coordinator_details.entryPermission,false);
    assert.equal(after.jobs[0].stage,'rescheduling');
    assert.match((await f.outbox(update.sid,c.maintenance))[0].body,/Weekdays after 4 PM/);
    await f.run(c.tenantPhone,'CONFIRM');
    assert.equal((await f.context(c.tenantPhone)).jobs[0].scheduled_at,null);
  } finally {await f.close();}
});

test('an access restriction supersedes an old grant before maintenance can book it',async()=>{
  const f=await coordinatorFixture();
  try {
    await f.run(c.tenantPhone,'Washer not working',{model:{type:'new_request',fields:{description:'Washer not working',facts:{issue:'washer'}}}});
    const grant=await f.run(c.tenantPhone,'Yes permission granted.');
    await f.db.query("update public.coordinator_outbox set status='sent' where event_sid=$1 and to_number=$2",[grant.sid,c.maintenance]);
    const job=(await f.context(c.tenantPhone)).jobs[0];
    const text='You can enter if nobody is home, but only after 5 PM.';
    const restricted=await f.run(c.tenantPhone,text);
    assert.notEqual((await f.context(c.tenantPhone)).jobs[0].coordinator_details.entryPermission,true);
    const notice=(await f.outbox(restricted.sid,c.maintenance))[0];
    assert.ok(notice);
    assert.match(notice.body,/only after 5 PM/);
    await f.run(c.maintenance,'Yes');
    assert.equal((await f.context(c.tenantPhone)).jobs[0].scheduled_at,null);
    assert.equal((await f.context(c.tenantPhone)).jobs[0].id,job.id);
  } finally {await f.close();}
});
