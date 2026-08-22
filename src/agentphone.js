import crypto from 'node:crypto';

export function verifyAgentPhoneSignature(rawBody, signature, timestamp, secret, now = Date.now()) {
  if (!secret || !signature || !timestamp || !rawBody) return false;

  const timestampText = String(timestamp).trim();
  if (!/^\d+$/.test(timestampText)) return false;
  const timestampSeconds = Number(timestampText);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(now - timestampSeconds * 1000) > 5 * 60 * 1000) return false;

  const signedBody = Buffer.concat([Buffer.from(`${timestampText}.`, 'utf8'), Buffer.from(rawBody)]);
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(signedBody).digest('hex')}`;
  const supplied = String(signature).trim();

  if (supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied, 'utf8'), Buffer.from(expected, 'utf8'));
}

export function normalizeAgentPhoneEvent(payload) {
  const data = payload?.data ?? {};
  const message = data.message ?? data.transcript ?? payload?.message ?? '';

  return {
    event: payload?.event ?? payload?.type ?? 'unknown',
    channel: payload?.channel ?? data.channel ?? 'unknown',
    conversationId: payload?.conversationId ?? data.conversationId ?? null,
    numberId: data.numberId ?? payload?.numberId ?? null,
    agentId: payload?.agentId ?? data.agentId ?? null,
    direction: data.direction ?? payload?.direction ?? null,
    from: data.fromNumber ?? data.from ?? payload?.from ?? null,
    to: data.toNumber ?? data.to ?? payload?.to ?? null,
    message: typeof message === 'string' ? message.trim() : '',
    mediaUrl: data.mediaUrl ?? payload?.mediaUrl ?? null,
    recentHistory: payload?.recentHistory ?? data.recentHistory ?? [],
    conversationState: payload?.conversationState ?? data.conversationState ?? null,
    raw: payload
  };
}
