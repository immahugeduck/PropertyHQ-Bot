const RULES = [
  {
    severity: 'EMERGENCY',
    category: 'gas_or_co',
    patterns: [
      /smell(s|ed)? (like )?(natural )?(gas|propane)/i,
      /\b(gas|propane) (smell|odor|odour)\b/i,
      /\b(gas|propane) leak\b/i,
      /\bcarbon[ -]?monoxide\b/i,
      /\bco (alarm|detector)\b/i
    ],
    response: 'This may be an immediate safety hazard. Leave the affected area without operating switches or creating sparks. From a safe location, contact 911 or the gas utility/emergency service as appropriate. Do not wait for maintenance if you believe there is a gas leak or carbon monoxide danger.'
  },
  {
    severity: 'EMERGENCY',
    category: 'fire_smoke',
    patterns: [/\bfire\b/i, /\bflames?\b/i, /(heavy|thick) smoke/i, /smoke (coming|pouring|filling)/i, /smell of burning/i],
    response: 'This may be an immediate fire hazard. Get everyone to a safe location and call 911. Do not re-enter the property to troubleshoot the problem.'
  },
  {
    severity: 'EMERGENCY',
    category: 'electrical_hazard',
    patterns: [
      /\b(active )?sparks?\b/i,
      /electrical fire/i,
      /outlet.*(smoking|burning|hot)/i,
      /wire.*(smoking|burning|hot|exposed)/i,
      /\b(burning|hot) outlet\b/i
    ],
    response: 'This may be an immediate electrical/fire hazard. Keep away from the affected equipment. If there is fire, smoke, active arcing, or immediate danger, leave the area and call 911. Do not touch exposed wiring.'
  },
  {
    severity: 'EMERGENCY',
    category: 'major_water',
    patterns: [
      /water (is )?(pouring|gushing|shooting|leaking)/i,
      /\b(active(ly)?|currently|right now)\b.*\b(leak(ing)?|water)\b/i,
      /\b(roof|ceiling)\b.*\bleak(ing)?\b/i,
      /burst (pipe|water line)/i,
      /pipe (burst|broke)/i,
      /ceiling.*(pouring|gushing)/i,
      /\b(spray(s|ing)?|squirt(s|ing)?)\b/i,
      /\bflood(s|ing|ed)?\b/i,
      /water\b.*\b(everywhere|all over)\b/i,
      // A leak getting worse: "the water is coming a lot more now"
      /\b(water|leak(ing)?)\b.*\b(a lot more|more and more|getting worse|worse now|won'?t stop|can'?t stop)\b/i
    ],
    response: 'This appears to be an active major water leak. If you know where the main water shutoff is and can reach it without stepping into standing water near outlets or electrical equipment, shut the main water off now. If you don\'t know where it is, text back and ask, and we\'ll get you an answer from maintenance. Stay away from any sagging ceiling. If there is immediate danger to people, call 911. Maintenance is being alerted now.'
  },
  {
    severity: 'URGENT',
    category: 'sewage',
    patterns: [/sewage (backup|backing|overflow)/i, /sewer (backup|backing|overflow)/i, /toilet.*overflow/i, /wastewater/i],
    response: 'This is an urgent sanitation issue. Avoid contact with wastewater and keep children and pets away from the affected area. Stop using fixtures that may be contributing to the backup. Maintenance should be notified promptly.'
  },
  {
    severity: 'EMERGENCY',
    category: 'no_hvac',
    patterns: [/no heat/i, /furnace (is )?(not working|out|dead)/i, /heat (is )?(not working|out)/i, /no ac/i, /\bac (is )?(not working|out|dead)\b/i, /air condition(er|ing).*(not working|out|dead)/i],
    response: 'I have this as an emergency heating/cooling request. Please tell me the property address/unit and whether the thermostat has power. Do not use an oven or other unsafe appliance for heating.'
  },
  {
    severity: 'PRIORITY',
    category: 'water_leak',
    patterns: [/leak(ing)?/i, /dripping/i, /water under/i, /wet ceiling/i],
    response: 'I have this as a water/leak maintenance request. Please send the property address/unit, where the water is coming from, whether it is actively getting worse, and a photo if available. If it gets worse and you know where the main water shutoff is, shut it off. If you don\'t know where it is, text back and ask.'
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

/**
 * A tenant asking how or where to shut the water off. These get forwarded to
 * maintenance so the answer comes from someone who knows the building.
 */
const SHUTOFF_QUESTION = [
  /\b(where|how)\b.*\b(shut ?off|shut (it|the water|water) off|turn (it|the water|water) off|turn off (the )?water|valve|water main|main water)\b/i,
  /\b(shut ?off|valve|water main|main water)\b.*\?/i,
  /\b(don'?t|do not|can'?t|cannot) (know|find)\b.*\b(shut ?off|valve|water main|main water|turn (it|the water) off)\b/i
];

export function isShutoffQuestion(message = '') {
  const text = String(message);
  return SHUTOFF_QUESTION.some((pattern) => pattern.test(text));
}
