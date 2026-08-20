const RULES = [
  {
    severity: 'EMERGENCY',
    category: 'gas_or_co',
    patterns: [/smell(s|ed)? (like )?gas/i, /gas leak/i, /carbon monoxide/i, /\bco alarm\b/i],
    response: 'This may be an immediate safety hazard. Leave the affected area without operating switches or creating sparks. From a safe location, contact 911 or the gas utility/emergency service as appropriate. Do not wait for maintenance if you believe there is a gas leak or carbon monoxide danger.'
  },
  {
    severity: 'EMERGENCY',
    category: 'fire_smoke',
    patterns: [/\bfire\b/i, /flames?/i, /heavy smoke/i, /smoke (coming|pouring)/i],
    response: 'This may be an immediate fire hazard. Get everyone to a safe location and call 911. Do not re-enter the property to troubleshoot the problem.'
  },
  {
    severity: 'EMERGENCY',
    category: 'electrical_hazard',
    patterns: [/sparks? (coming|shooting|from)/i, /electrical fire/i, /outlet.*(smoking|burning)/i, /wire.*(smoking|burning)/i],
    response: 'This may be an immediate electrical/fire hazard. Keep away from the affected equipment. If there is fire, smoke, active arcing, or immediate danger, leave the area and call 911. Do not touch exposed wiring.'
  },
  {
    severity: 'EMERGENCY',
    category: 'major_water',
    patterns: [/water (is )?(pouring|gushing|shooting)/i, /burst (pipe|water line)/i, /pipe (burst|broke)/i, /ceiling.*(pouring|gushing)/i],
    response: 'This appears to be an active major water leak. If you can safely reach the appropriate water shutoff without entering standing water near electrical equipment, shut the water off. Avoid electrical hazards and move away from any sagging ceiling. If there is immediate danger to people, call 911. Maintenance should be escalated immediately.'
  },
  {
    severity: 'URGENT',
    category: 'sewage',
    patterns: [/sewage (backup|backing|overflow)/i, /sewer (backup|backing)/i, /toilet.*overflow.*won.t stop/i],
    response: 'This is an urgent sanitation issue. Avoid contact with wastewater and keep children and pets away from the affected area. Stop using fixtures that may be contributing to the backup. Maintenance should be notified promptly.'
  },
  {
    severity: 'URGENT',
    category: 'no_heat',
    patterns: [/no heat/i, /furnace (is )?(not working|out|dead)/i, /heat (is )?(not working|out)/i],
    response: 'I have this as an urgent no-heat request. Please tell me the property address/unit and whether the thermostat has power. Do not use an oven or other unsafe appliance for space heating.'
  },
  {
    severity: 'PRIORITY',
    category: 'water_leak',
    patterns: [/leak(ing)?/i, /dripping/i, /water under/i, /wet ceiling/i],
    response: 'I have this as a water/leak maintenance request. Please send the property address/unit, where the water is coming from, whether it is actively getting worse, and a photo if available.'
  },
  {
    severity: 'PRIORITY',
    category: 'electrical',
    patterns: [/outlet.*not working/i, /breaker.*trip/i, /power (is )?out/i, /no power/i],
    response: 'I have this as an electrical maintenance request. Please send the property address/unit and what fixtures or circuits are affected. If you notice smoke, burning, exposed live wiring, or active arcing, move away from the area and treat it as an emergency.'
  }
];

export function classifyMaintenanceRequest(message = '') {
  const text = String(message).trim();
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return { severity: rule.severity, category: rule.category, response: rule.response, matched: true };
    }
  }

  return {
    severity: 'ROUTINE',
    category: 'general_maintenance',
    response: 'Thanks for contacting maintenance. Please send the property address/unit, a short description of the problem, when it started, and a photo or video if that would help show the issue.',
    matched: false
  };
}

export const severityRank = Object.freeze({ ROUTINE: 1, PRIORITY: 2, URGENT: 3, EMERGENCY: 4 });
