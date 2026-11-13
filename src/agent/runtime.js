// Bounded agent turn. Records and queued notifications commit before the reply is returned.
import { loadContext, commitDecision } from '../conversation-store.js';
import { interpretMessage } from '../assistant.js';
import { decideConversation } from '../coordinator.js';
import { classifyMaintenanceRequest } from '../triage.js';
import { normalizePhoneNumber } from '../twilio.js';
export async function runAgentTurn({params,load=loadContext,interpret=interpretMessage,commit=commitDecision,dispatch=async()=>[],fetchImpl=globalThis.fetch}) {
  let safety=classifyMaintenanceRequest(params.Body || '');
  let guidance=safety.severity==='EMERGENCY' ? safety.response.replace(/Maintenance is being alerted now\./g,'').trim()+' ' : '';
  const deadline=AbortSignal.timeout(9000);
  const boundedFetch=(url,options={})=>fetchImpl(url,{...options,signal:AbortSignal.any([deadline,...(options.signal?[options.signal]:[])])});
  try {
    const normalized={...params,To:normalizePhoneNumber(params.To),From:normalizePhoneNumber(params.From)};
    if (!normalized.From || !normalized.To || !params.MessageSid) throw Error('invalid_envelope');
    const context=await load({params:normalized,fetchImpl:boundedFetch});
    // An authenticated manager's explicit outward message is content to relay,
    // not an inbound hazard report or a set of commands found inside that text.
    if(context.identity.role==='manager' && /^\s*SEND(?:\s+#\d{4,})?:/i.test(params.Body || '')) {
      safety={severity:'ROUTINE',category:'general_maintenance'};guidance='';
    }
    const intent=safety.severity==='EMERGENCY' ? null : await interpret({context,text:params.Body || '',fetchImpl:boundedFetch});
    const decision=decideConversation({context,intent,safety});
    const result=await commit({context,eventId:params.MessageSid,decision,message:params.Body || '',fetchImpl:boundedFetch});
    if (result.duplicate) return '';
    // Delivery is a separate authenticated worker; never spend Twilio's response
    // budget sending staff alerts. Tests may inject a fixture dispatcher.
    await dispatch({scope:context.scope,fetchImpl:boundedFetch});
    return decision.reply;
  } catch {
    return guidance+'I’m sorry, I couldn’t save this update or confirm that staff were notified. Please contact the office directly, or try again shortly.';
  }
}
