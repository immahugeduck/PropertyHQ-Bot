// Human descriptions identify a repair to tenants; IDs remain in records/staff reports.
export const TENANT_CLOSING='If anything else comes up let us know, thank you. Have a good day!';
export const tenantClosingReply=()=>`You’re welcome! ${TENANT_CLOSING}`;

export function isTenantClosing(text='') {
  const value=String(text).toLowerCase().replace(/’/g,"'").replace(/[.!?,]/g,' ').replace(/\s+/g,' ').trim();
  const gratitude='(?:(?:thanks|thank you)(?: (?:so|very|so very) much| a lot| again)?(?: for (?:the update|your help|fixing it|taking care of it|letting me know|everything))?|(?:i )?appreciate (?:it|your help|the update)|much appreciated)';
  const ack='(?:okay|ok|great|alright|all right|got it|understood|i understand|'+gratitude+')';
  const bye='(?:have a (?:good|nice) day|bye|goodbye|take care)';
  const token='(?:'+ack+'|'+bye+')';
  return new RegExp(gratitude+'|'+bye).test(value) && new RegExp('^'+token+'(?: '+token+'){0,5}$').test(value);
}

export function repairLabel(job = {}) {
  const known={washer:'washer',screen_door:'screen door',window_screen:'window screen',sink_disposal:'kitchen sink and disposal'}[job.coordinator_details?.issue];
  if(known) return known;
  const title=String(job.title || 'repair').replace(/\s*\((?:via (?:text|sms|call|voice)|sms|voice)\)\s*$/i,'').replace(/\s+request$/i,'').trim() || 'repair';
  return /^[A-Z]{2,}\b/.test(title)?title:title[0].toLowerCase()+title.slice(1);
}
