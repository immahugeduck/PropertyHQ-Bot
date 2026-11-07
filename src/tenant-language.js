// Human descriptions identify a repair to tenants; IDs remain in records/staff reports.
export function repairLabel(job = {}) {
  const known={washer:'washer',screen_door:'screen door',window_screen:'window screen',sink_disposal:'kitchen sink and disposal'}[job.coordinator_details?.issue];
  if(known) return known;
  const title=String(job.title || 'repair').replace(/\s*\((?:via (?:text|sms|call|voice)|sms|voice)\)\s*$/i,'').replace(/\s+request$/i,'').trim() || 'repair';
  return /^[A-Z]{2,}\b/.test(title)?title:title[0].toLowerCase()+title.slice(1);
}
