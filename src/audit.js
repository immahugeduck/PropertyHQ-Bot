export function auditEvent(entry) {
  const safeEntry = {
    timestamp: new Date().toISOString(),
    event: entry.event,
    channel: entry.channel,
    conversationId: entry.conversationId,
    severity: entry.severity,
    category: entry.category,
    verified: entry.verified
  };

  // Do not log full message bodies or phone numbers by default.
  console.log(JSON.stringify({ type: 'maintenance_triage_audit', ...safeEntry }));
}
