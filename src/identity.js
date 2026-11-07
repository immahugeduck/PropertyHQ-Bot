import { normalizePhoneNumber } from './twilio.js';

// No database lookup or caller-authored text can grant a staff role.
export function resolveIdentity({ scope, fromNumber, settings, tenants = [], binding }) {
  const phone = normalizePhoneNumber(fromNumber);
  for (const [role, field] of [['maintenance','maintenance_phone'], ['manager','manager_phone']]) {
    if (phone && phone === normalizePhoneNumber(settings[field])) return { state: 'known', role, phone };
  }
  const scoped = tenants.filter(t => t.user_id === scope.userId && t.status !== 'inactive');
  if (binding?.revoked) return { state: 'pending', role: 'unknown', phone };
  const matches = binding?.tenant_id ? scoped.filter(t => t.id === binding.tenant_id) : scoped;
  if (matches.length !== 1) return { state: matches.length ? 'ambiguous' : 'pending', role: 'unknown', phone };
  const t = matches[0];
  return { state: 'known', role: 'tenant', phone, tenantId: t.id, propertyId: t.property_id, name: t.first_name };
}
