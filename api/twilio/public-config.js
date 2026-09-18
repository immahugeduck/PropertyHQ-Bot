export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const smsNumber = String(process.env.TWILIO_NUMBER ?? '').trim();
  if (!/^\+[1-9]\d{7,14}$/.test(smsNumber)) {
    return res.status(503).json({ error: 'sms_opt_in_not_configured' });
  }

  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json({ smsNumber });
}
