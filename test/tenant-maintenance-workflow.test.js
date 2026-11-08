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
