import crypto from 'node:crypto';

export function verifyAgentPhoneSignature(rawBody, signature, secret) {
  if (!secret || !signature || !rawBody) return false;

  // AgentPhone documents HMAC-signed webhooks. Accept the common raw hex form
  // and an optional sha256= prefix while keeping comparison timing-safe.
  const supplied = String(signature).trim().replace(/^sha256=/i, '');
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  if (!/^[a-f0-9]+$/i.test(supplied) || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'));
}

export function normalizeAgentPhoneEvent(payload) {
  const data = payload?.data ?? {};
  const message = data.message ?? payload?.message ?? '';

  return {
    event: payload?.event ?? payload?.type ?? 'unknown',
    channel: payload?.channel ?? data.channel ?? 'unknown',
    conversationId: payload?.conversationId ?? data.conversationId ?? null,
    from: data.fromNumber ?? data.from ?? payload?.from ?? null,
    to: data.toNumber ?? data.to ?? payload?.to ?? null,
    message: typeof message === 'string' ? message.trim() : '',
    mediaUrl: data.mediaUrl ?? payload?.mediaUrl ?? null,
    recentHistory: payload?.recentHistory ?? data.recentHistory ?? [],
    conversationState: payload?.conversationState ?? data.conversationState ?? null,
    raw: payload
  };
}
