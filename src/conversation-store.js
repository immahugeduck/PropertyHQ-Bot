import { supabaseRequest, supabaseConfig } from './supabase.js';
import { resolveIdentity } from './identity.js';
import { parseManagerCommand } from './manager-review.js';
export async function rpc(db,name,body,fetchImpl) {
  if (!db) throw new Error('coordinator_database_missing');
  const r=await supabaseRequest(db,`rpc/${name}`,{method:'POST',body,fetchImpl});
  if (!r.ok) throw new Error(`coordinator_${name}_failed_${r.status}`);
  return r.data;
}
export async function loadContext({db=supabaseConfig(),params,fetchImpl}) {
  const command=parseManagerCommand(params.Body || '');
  const jobNumber=command?command.number:params.Body?.match(/(?:#|job|request)\s*(\d{4,})/i)?.[1];
  const raw=await rpc(db,'coordinator_context',{p_to:params.To,p_from:params.From,p_job:jobNumber || null},fetchImpl);
  if (!raw?.scope || !raw.settings) throw new Error('coordinator_not_configured');
  if (!raw.settings.maintenance_phone?.endsWith('9030') || !raw.settings.manager_phone?.endsWith('6088')) throw new Error('coordinator_staff_configuration_mismatch');
  const identity=resolveIdentity({scope:raw.scope,fromNumber:params.From,settings:raw.settings,tenants:raw.tenants,binding:raw.binding});
  return {...raw,identity,fromNumber:params.From,inbound:params.Body || '',state:raw.state || {},version:raw.version || 0,jobs:raw.jobs || [],messages:raw.messages || []};
}
export async function commitDecision({db=supabaseConfig(),context,eventId,decision,message,fetchImpl}) {
  return rpc(db,'coordinator_commit',{p_user:context.scope.userId,p_from:context.fromNumber,p_sid:eventId,p_version:context.version,p_message:message,p_decision:decision},fetchImpl);
}
