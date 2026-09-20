// Deterministic maintenance triage.
//
// The engine keeps FOUR internal severity tiers (ROUTINE < PRIORITY < URGENT <
// EMERGENCY) because that granularity already drives dispatch policy and is
// covered by tests. The published agent spec speaks in THREE tiers
// (EMERGENCY / URGENT / ROUTINE); `toSpecTier` maps the internal tier onto that
// vocabulary (PRIORITY collapses into URGENT) for all outward-facing output.
//
// Classification is intentionally rule-based, not model-based: a safety-
// critical emergency must never be silently downgraded by a probabilistic
// system. Each rule also carries the metadata the downstream outputs need
// (schema category, suggested parts/tools, and tenant containment guidance).

const RULES = [
  {
    severity: 'EMERGENCY',
    category: 'gas_or_co',
    schemaCategory: 'GENERAL',
    patterns: [
      /smell(s|ed)? (like )?(natural )?(gas|propane)/i,
      /\b(gas|propane) (smell|odor|odour)\b/i,
      /\b(gas|propane) leak\b/i,
      /\bcarbon[ -]?monoxide\b/i,
      /\bco (alarm|detector)\b/i
    ],
    response:
      'This may be an immediate safety hazard. Leave the affected area without operating switches or creating sparks. From a safe location, contact 911 or the gas utility/emergency service as appropriate. Do not wait for maintenance if you believe there is a gas leak or carbon monoxide danger.',
    containment:
      'Leave the area now without using light switches, appliances, or anything that could spark, and call 911 or your gas utility from a safe location.',
    parts: ['Combustible gas detector', 'CO meter', 'Ventilation equipment']
  },
  {
    severity: 'EMERGENCY',
    category: 'fire_smoke',
    schemaCategory: 'GENERAL',
    patterns: [/\bfire\b/i, /\bflames?\b/i, /(heavy|thick) smoke/i, /smoke (coming|pouring|filling)/i, /smell of burning/i],
    response:
      'This may be an immediate fire hazard. Get everyone to a safe location and call 911. Do not re-enter the property to troubleshoot the problem.',
    containment: 'Get everyone out and call 911. Do not re-enter the property to troubleshoot.',
    parts: ['Fire extinguisher (ABC)', 'Thermal detection']
  },
  {
    severity: 'EMERGENCY',
    category: 'electrical_hazard',
    schemaCategory: 'ELECTRICAL',
    patterns: [
      /\b(active )?sparks?\b/i,
      /electrical fire/i,
      /outlet.*(smoking|burning|hot)/i,
      /wire.*(smoking|burning|hot|exposed)/i,
      /\b(burning|hot) outlet\b/i
    ],
    response:
      'This may be an immediate electrical/fire hazard. Keep away from the affected equipment. If there is fire, smoke, active arcing, or immediate danger, leave the area and call 911. Do not touch exposed wiring.',
    containment:
      'Keep away from the outlet or wiring and do not touch it. If you see fire, smoke, or arcing, leave and call 911. If you can safely reach the breaker for that circuit, switch it off.',
    parts: ['Insulated screwdrivers', 'Multimeter', 'Replacement outlets/GFCI', 'Breaker assortment']
  },
  {
    severity: 'EMERGENCY',
    category: 'major_water',
    schemaCategory: 'PLUMBING',
    patterns: [
      /water (is )?(pouring|gushing|shooting|leaking)/i,
      /\b(active(ly)?|currently|right now)\b.*\b(leak(ing)?|water)\b/i,
      /\b(roof|ceiling)\b.*\bleak(ing)?\b/i,
      /burst (pipe|water line)/i,
      /pipe (burst|broke)/i,
      /ceiling.*(pouring|gushing)/i
    ],
    response:
      'This appears to be an active major water leak. If you can safely reach the appropriate water shutoff without entering standing water near electrical equipment, shut the water off. Avoid electrical hazards and move away from any sagging ceiling. If there is immediate danger to people, call 911. Maintenance should be escalated immediately.',
    containment:
      'If you can safely reach the water shut-off (fixture valve or the main), turn it off, and stay clear of standing water near outlets or a sagging ceiling.',
    parts: [
      'Pipe wrenches',
      'Slip-joint pliers',
      'PEX/copper cutters',
      'Replacement supply lines',
      'Shut-off valves',
      'Wet/dry vac'
    ]
  },
  {
    severity: 'URGENT',
    category: 'sewage',
    schemaCategory: 'PLUMBING',
    patterns: [/sewage (backup|backing|overflow)/i, /sewer (backup|backing|overflow)/i, /toilet.*overflow/i, /wastewater/i],
    response:
      'This is an urgent sanitation issue. Avoid contact with wastewater and keep children and pets away from the affected area. Stop using fixtures that may be contributing to the backup. Maintenance should be notified promptly.',
    containment:
      'Avoid contact with the wastewater, keep children and pets away, and stop using any fixtures that feed the backup.',
    parts: ['Drain auger/snake', 'Plunger', 'Wet/dry vac', 'PPE (gloves, eye protection)', 'Enzyme cleaner']
  },
  {
    severity: 'EMERGENCY',
    category: 'no_hvac',
    schemaCategory: 'HVAC',
    patterns: [
      /no heat/i,
      /furnace (is )?(not working|out|dead)/i,
      /heat (is )?(not working|out)/i,
      /no ac/i,
      /\bac (is )?(not working|out|dead)\b/i,
      /air condition(er|ing).*(not working|out|dead)/i
    ],
    response:
      'I have this as an emergency heating/cooling request. Please tell me the property address/unit and whether the thermostat has power. Do not use an oven or other unsafe appliance for heating.',
    containment:
      'Do not use an oven or other unsafe appliance for heat. Keep the thermostat set and let us know right away if anyone in the unit is medically at risk from the temperature.',
    parts: ['Thermostat/batteries', 'Igniter', 'Flame sensor', 'Capacitor', 'Multimeter', 'Filters']
  },

  // --- Spec Tier 2 (URGENT) additions -------------------------------------
  // Placed above the PRIORITY water/electrical rules so these specific,
  // higher-impact cases win before the generic leak/electrical patterns match.
  {
    severity: 'URGENT',
    category: 'appliance_failure',
    schemaCategory: 'APPLIANCE',
    patterns: [
      /(refrigerator|fridge|freezer).*(not|stopped|isn'?t|is'?nt|died|dead|warm|not cold|failed|failing|broken)/i,
      /(refrigerator|fridge|freezer) (is )?(out|dead|broken|not working)/i,
      /food.*(spoil|going bad|warm)/i
    ],
    response:
      'I have this as an urgent appliance failure (refrigeration). Please confirm the property address/unit. We will target a service window within the next 12-24 hours.',
    containment: 'If possible, move perishable food to a cooler or another working refrigerator to limit spoilage.',
    parts: ['Multimeter', 'Start relay/capacitor', 'Thermostat', 'Condenser fan motor', 'Coil cleaning kit']
  },
  {
    severity: 'URGENT',
    category: 'clogged_toilet',
    schemaCategory: 'PLUMBING',
    patterns: [
      /toilet.*(clog|clogged|blocked|won'?t flush|wont flush|not flush|backing up)/i,
      /clogged toilet/i,
      /(only|single|one).*(bathroom|toilet).*(clog|not work)/i
    ],
    response:
      'I have this as an urgent clogged toilet. Please confirm the property address/unit and whether this is the only bathroom. We will target a service window within the next 12-24 hours.',
    containment: 'Stop flushing to avoid an overflow. If you have a second bathroom, please use that one in the meantime.',
    parts: ['Toilet auger', 'Heavy-duty plunger', 'Wax ring', 'Gloves']
  },
  {
    severity: 'URGENT',
    category: 'water_heater',
    schemaCategory: 'PLUMBING',
    patterns: [
      /water heater.*(leak|leaking|dripping|pooling)/i,
      /(hot water|water) (tank|heater).*(leak|leaking|drip)/i,
      /water heater (is )?(leaking|dripping)/i
    ],
    response:
      'I have this as an urgent (slow) water heater leak. Please confirm the property address/unit. We will target a service window within the next 12-24 hours.',
    containment:
      'If water is pooling, place a bucket and towels under the leak. If you are comfortable doing so, close the cold-water supply valve on top of the water heater.',
    parts: ['Replacement T&P valve', 'Drain pan', 'Pipe wrench', 'Thread sealant/PTFE tape', 'Shop towels']
  },
  {
    severity: 'URGENT',
    category: 'security_lock',
    schemaCategory: 'STRUCTURAL',
    patterns: [
      /(broken|jammed|busted|won'?t lock|wont lock|not lock(ing)?|can'?t lock|cant lock).*(lock|latch|deadbolt|door|window)/i,
      /(door|window) (lock|latch|deadbolt).*(broke|broken|jammed|stuck|fail)/i,
      /(ground[ -]?floor|first[ -]?floor).*(window|door).*(latch|lock|won'?t|open)/i,
      /can'?t (secure|lock).*(door|window|unit|apartment)/i
    ],
    response:
      'I have this as an urgent security issue (lock/latch). Please confirm the property address/unit. We will prioritize this with a service window within the next 12-24 hours.',
    containment:
      'If the unit cannot be secured, please stay somewhere safe and let us know. We are treating this as a priority.',
    parts: ['Replacement deadbolt/latch set', 'Strike plate', 'Screwdriver/drill', 'Lock lubricant', 'Shims']
  },

  // --- Spec Tier 3 boundary: PRIORITY (maps to URGENT in spec vocabulary) ---
  {
    severity: 'PRIORITY',
    category: 'water_leak',
    schemaCategory: 'PLUMBING',
    patterns: [/leak(ing)?/i, /dripping/i, /water under/i, /wet ceiling/i],
    response:
      'I have this as a water/leak maintenance request. Please send the property address/unit, where the water is coming from, whether it is actively getting worse, and a photo if available.',
    containment: 'Place a bucket or towels under the drip and let us know if it starts getting worse.',
    parts: ['Slip-joint pliers', "Plumber's tape", 'Replacement washers/supply line', 'Bucket & towels']
  },
  {
    severity: 'PRIORITY',
    category: 'electrical',
    schemaCategory: 'ELECTRICAL',
    patterns: [/outlet.*not working/i, /breaker.*trip/i, /power (is )?out/i, /no power/i],
    response:
      'I have this as an electrical maintenance request. Please send the property address/unit and what fixtures or circuits are affected. If you notice smoke, burning, exposed live wiring, or active arcing, move away from the area and treat it as an emergency.',
    containment:
      'If you see smoke, smell burning, or notice arcing, treat it as an emergency and move away from the area.',
    parts: ['Multimeter', 'Replacement outlet/GFCI', 'Breaker', 'Insulated screwdrivers']
  }
];

const DEFAULT_RESULT = {
  severity: 'ROUTINE',
  category: 'general_maintenance',
  schemaCategory: 'GENERAL',
  response:
    'Thanks for contacting maintenance. Please send the property address/unit, a short description of the problem, when it started, and a photo or video if that would help show the issue.',
  containment: null,
  parts: ['General hand tools', 'Lubricant', 'Fasteners/hardware', 'Caulk', 'Touch-up materials']
};

export function classifyMaintenanceRequest(message = '') {
  const text = String(message).trim();
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return {
        severity: rule.severity,
        category: rule.category,
        schemaCategory: rule.schemaCategory,
        response: rule.response,
        containment: rule.containment ?? null,
        parts: rule.parts ?? [],
        specTier: toSpecTier(rule.severity),
        matched: true
      };
    }
  }

  return {
    ...DEFAULT_RESULT,
    parts: [...DEFAULT_RESULT.parts],
    specTier: toSpecTier(DEFAULT_RESULT.severity),
    matched: false
  };
}

export const severityRank = Object.freeze({ ROUTINE: 1, PRIORITY: 2, URGENT: 3, EMERGENCY: 4 });

// Internal 4-tier severity -> published 3-tier spec vocabulary.
export const SPEC_TIER = Object.freeze({
  ROUTINE: 'ROUTINE',
  PRIORITY: 'URGENT',
  URGENT: 'URGENT',
  EMERGENCY: 'EMERGENCY'
});

export function toSpecTier(severity) {
  return SPEC_TIER[severity] ?? 'ROUTINE';
}
