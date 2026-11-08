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
