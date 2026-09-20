// Builds the structured triage payload and the three tailored outputs
// (tenant / maintenance dispatch / property manager) described in the agent
// spec. Pure and deterministic: given the same inputs it always produces the
// same payload, which keeps behavior auditable and testable.

import { toSpecTier } from './triage.js';
import { proposeSlots } from './schedule.js';

const PRIORITY_BANNER = Object.freeze({
  EMERGENCY: '[CRITICAL EMERGENCY]',
  URGENT: '[URGENT]',
  ROUTINE: '[ROUTINE]'
});

const ACTION_REQUESTED = Object.freeze({
  EMERGENCY: 'Immediate dispatch requested.',
  URGENT: 'Dispatch within 12-24 hours.',
  ROUTINE: 'Schedule within the standard 24-72h window (awaiting tenant confirmation).'
});

// Manager visibility: only true emergencies force an action-required alert;
// everything else is informational per the "silent/elevated visibility" policy.
const MANAGER_STATUS = Object.freeze({
  EMERGENCY: 'ACTION_REQUIRED',
  URGENT: 'INFO_ONLY',
  ROUTINE: 'INFO_ONLY'
});

const CATEGORY_LABEL = Object.freeze({
  PLUMBING: 'Plumbing',
  ELECTRICAL: 'Electrical',
  HVAC: 'HVAC',
  APPLIANCE: 'Appliance',
  STRUCTURAL: 'Structural/Security',
  GENERAL: 'General'
});

export function extractEntities(message = '') {
  const text = String(message);

  let unit = null;
  const unitMatch = text.match(/\b(?:unit|apt\.?|apartment|suite|ste\.?|#)\s*#?\s*([a-z0-9][a-z0-9-]{0,9})\b/i);
  if (unitMatch) unit = unitMatch[1].toUpperCase();

  let address = null;
  const addressMatch = text.match(/\b(\d{1,6}\s+[a-z0-9.'-]+(?:\s+[a-z0-9.'-]+){0,4}\s+(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court|way|pl|place|ter|terrace|cir|circle|hwy|highway))\b/i);
  if (addressMatch) address = addressMatch[1].trim();

  let entryPermission = null;
  if (/\b(permission to enter|ok to enter|okay to enter|you can enter|feel free to enter|enter (?:when|while|if) (?:i'?m|we'?re|i am|we are) (?:out|away|not home|gone))\b/i.test(text)) {
    entryPermission = 'granted';
  } else if (/\b(must be (?:home|present|there)|only when (?:i'?m|we'?re|i am|we are) home|be present|be there|call before|need to be home)\b/i.test(text)) {
    entryPermission = 'tenant_must_be_present';
  }

  return { unit, address, entryPermission };
}

function buildTenantBody({ tier, containment, slots, entryPermission }) {
  const parts = [];

  if (tier === 'EMERGENCY') {
    parts.push(
      `We have flagged your request as an EMERGENCY and alerted a technician for immediate response. Estimated arrival window: ${slots[0]}${slots[1] ? ` (backup: ${slots[1]})` : ''}.`
    );
    if (containment) parts.push(`Immediate step: ${containment}`);
    parts.push('Please stay safe. If anyone is in danger, call 911.');
    return parts.join(' ');
  }

  if (tier === 'URGENT') {
    parts.push('Thanks for letting us know. We have marked this as URGENT and are scheduling a technician within the next 12-24 hours.');
    if (containment) parts.push(`In the meantime: ${containment}`);
  } else {
    parts.push('Thanks for letting us know! We have logged this as routine service.');
  }

  if (slots.length) {
    parts.push(`Proposed service windows: (1) ${slots[0]}${slots[1] ? `; (2) ${slots[1]}` : ''}. Please reply to confirm which works for you.`);
  } else {
    parts.push('We will follow up shortly with a proposed service window.');
  }

  if (entryPermission === 'tenant_must_be_present') {
    parts.push('We noted you would like to be present, so we will confirm a time with you first.');
  } else if (entryPermission === 'granted') {
    parts.push('Thanks for granting entry permission; the technician will lock up on the way out.');
  }

  return parts.join(' ');
}

/**
 * Build the full structured payload plus the three tailored outputs.
 *
 * @param {object} args
 * @param {string} args.message   Raw tenant intake text.
 * @param {object} args.triage    Result of classifyMaintenanceRequest().
 * @param {string} [args.tenantContact] Tenant phone/email for the tenant output.
 * @param {string} [args.unit]    Override unit (falls back to extracted entity).
 * @param {Date}   [args.now]     Injectable clock for deterministic scheduling.
 */
export function buildTriagePayload({ message = '', triage, tenantContact = null, unit = null, now = new Date() }) {
  const tier = toSpecTier(triage.severity);
  const entities = extractEntities(message);
  const resolvedUnit = unit || entities.unit || entities.address || 'Unspecified (confirm with tenant)';
  const slots = proposeSlots(triage.severity, now);
  const issue = String(message).trim() || '(no description provided)';
  const categoryLabel = CATEGORY_LABEL[triage.schemaCategory] ?? 'General';

  const tenantBody = buildTenantBody({
    tier,
    containment: triage.containment,
    slots,
    entryPermission: entities.entryPermission
  });

  const scheduleNote =
    tier === 'EMERGENCY'
      ? `immediate dispatch (${slots[0] ?? 'ASAP'})`
      : `proposed ${slots.join(' / ') || 'window pending'} (awaiting tenant confirmation)`;

  return {
    triage_summary: {
      priority: tier,
      category: triage.schemaCategory,
      containment_instructions_provided: triage.containment ?? null,
      proposed_schedule_slots: slots
    },
    tenant_message: {
      recipient: tenantContact ?? 'Tenant',
      body: tenantBody
    },
    maintenance_dispatch: {
      recipient: 'Maintenance Team',
      priority_banner: PRIORITY_BANNER[tier],
      unit: resolvedUnit,
      issue_description: `${categoryLabel}: ${issue}`,
      suggested_parts_tools: triage.parts ?? [],
      action_requested: ACTION_REQUESTED[tier]
    },
    manager_update: {
      recipient: 'Property Manager',
      status: MANAGER_STATUS[tier],
      summary_line: `${PRIORITY_BANNER[tier]} Unit ${resolvedUnit} - ${categoryLabel}: ${issue}. ${scheduleNote}.`
    },
    _meta: {
      internalSeverity: triage.severity,
      internalCategory: triage.category,
      entities
    }
  };
}

// SMS-friendly rendering of the maintenance dispatch output.
export function formatMaintenanceSms(payload) {
  const d = payload.maintenance_dispatch;
  const slots = payload.triage_summary.proposed_schedule_slots;
  return [
    `${d.priority_banner} ${payload.triage_summary.category} - Unit ${d.unit}`,
    `Issue: ${d.issue_description}`,
    `Proposed: ${slots.join(' OR ') || 'pending'}`,
    `Prep: ${d.suggested_parts_tools.join(', ') || 'n/a'}`,
    `Action: ${d.action_requested}`
  ].join('\n');
}

// SMS-friendly rendering of the property manager update output.
export function formatManagerSms(payload) {
  return payload.manager_update.summary_line;
}
