import { rpc } from './conversation-store.js';
import { sendSms } from './intake.js';
// Claim once before attempting send; ambiguous acceptance is not automatically retried.
export async function dispatchPending({scope,db,env=process.env,fetchImpl,sendImpl=sendSms}) {
  if (env.COORDINATOR_OUTBOUND_ENABLED!=='true') return [];
  const rows=await rpc(db,'coordinator_claim_outbox',{p_user:scope.userId},fetchImpl);
  const outcomes=[];
  for (const row of rows || []) {
    let status='uncertain',sid=null;
    try {
      const sent=await sendImpl({to:row.to_number,from:row.from_number,body:row.body,env,fetchImpl});
      sid=sent.sid;status=sid?'sent':'uncertain';
    } catch { /* Do not re-send: provider may have accepted it. */ }
    await rpc(db,'coordinator_finish_outbox',{p_user:scope.userId,p_id:row.id,p_status:status,p_sid:sid},fetchImpl);
    outcomes.push({id:row.id,status});
  }
  return outcomes;
}
