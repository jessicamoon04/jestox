/**
 * rules.js — the chemical compatibility rules, written by the builder
 * (environmental management & toxicology). Mirrors COMPATIBILITY-RULES.md in
 * the project root: if you change a rule there, change it here too.
 *
 * How it works:
 *   1. classify() puts each chemical into hazard groups, using:
 *        - NOAA CAMEO reactive groups (from PubChem): tells acids from bases,
 *          finds cyanides, sulfides, azides, water-reactive metals…
 *        - GHS H-codes (from PubChem): flammability, gases, peroxides…
 *   2. checkPair() tests every rule in PAIR_RULES against two classified chemicals.
 *   3. storageNotes() adds single-chemical storage advice.
 *
 * Every rule cites sources from SOURCES below, so the agent can link them.
 * Pure functions only, with no network calls, so it can be tested anywhere.
 */

// ---------------------------------------------------------------------------
// Sources. Every rule cites one or more of these by key.
// "checked" = date the page was opened and the rule's claim confirmed in it.
// ---------------------------------------------------------------------------

export const SOURCES = {
  cornellL: {
    name: 'Cornell EHS Laboratory Safety Manual, Appendix L: EHS Segregation Scheme',
    url: 'https://ehs.cornell.edu/research-safety/chemical-safety/laboratory-safety-manual/appendix-l-ehs-segregation-scheme',
    checked: '2026-11-19',
  },
  cornellK: {
    name: 'Cornell EHS Laboratory Safety Manual, Appendix K: Incompatible Chemicals',
    url: 'https://ehs.cornell.edu/research-safety/chemical-safety/laboratory-safety-manual/appendix-k-incompatible-chemicals',
    checked: '2026-11-19',
  },
  cornell711: {
    name: 'Cornell EHS Laboratory Safety Manual, 7.11 Chemical Segregation',
    url: 'https://ehs.cornell.edu/research-safety/chemical-safety/laboratory-safety-manual/chapter-7-safe-chemical-use/711-chemical',
    checked: '2026-11-19',
  },
  cornellJ: {
    name: 'Cornell EHS Laboratory Safety Manual, Appendix J: Peroxide Forming Chemicals',
    url: 'https://ehs.cornell.edu/research-safety/chemical-safety/laboratory-safety-manual/appendix-j-peroxide-forming-chemicals',
    checked: '2026-11-19 (search summary)',
  },
  atsdrChlorine: {
    name: 'CDC / ATSDR, Public Health Statement: Chlorine',
    url: 'https://www.atsdr.cdc.gov/toxprofiles/tp172-c1-b.pdf',
    checked: '2026-11-19 (search summary)',
  },
  waDohBleach: {
    name: 'Washington State Department of Health, Bleach Mixing Dangers',
    url: 'https://doh.wa.gov/YouandYourFamily/HealthyHome/Contaminants/BleachMixingDangers',
    checked: '2026-11-19 (search summary)',
  },
  atsdrChloroform: {
    name: 'CDC / ATSDR, Toxicological Profile for Chloroform, Ch. 5: Potential for Human Exposure',
    url: 'https://www.atsdr.cdc.gov/toxprofiles/tp6-c5.pdf',
    checked: '2026-11-20 (search summary): chloroform can form when bleach is mixed with e.g. isopropyl alcohol',
  },
  cdcAzide: {
    name: 'CDC Chemical Emergencies Fact Sheet: Sodium Azide',
    url: 'https://www.cdc.gov/chemical-emergencies/chemical-fact-sheets/sodium-azide.html',
    checked: '2026-11-19 (search summary)',
  },
  osha253: {
    name: 'OSHA 29 CFR 1910.253, Oxygen-fuel gas welding and cutting',
    url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.253',
    checked: '2026-11-19 (search summary)',
  },
  osha106: {
    name: 'OSHA 29 CFR 1910.106, Flammable liquids',
    url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.106',
    checked: '2026-11-19: (d)(3) cabinets max 60 gal Cat 1-3, "Flammable - Keep Fire Away"; (d)(7)(iv) no water-reactives in same room',
  },
  osha1450: {
    name: 'OSHA 29 CFR 1910.1450, Occupational exposure to hazardous chemicals in laboratories',
    url: 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.1450',
    checked: '2026-11-19: (e)(3)(viii)(A) designated area for select carcinogens, reproductive toxins, high acute toxicity',
  },
  cameo: {
    name: 'NOAA CAMEO Chemicals, Reactive Group Datasheets',
    url: 'https://cameochemicals.noaa.gov/browse/react',
    checked: '2026-11-19 (search summary)',
  },
  nihTable: {
    name: 'NIH Division of Safety, Chemical Segregation and Storage Table',
    url: 'https://ors.od.nih.gov/sr/ds/Documents/chemical-segregation-table.pdf',
    checked: 'not yet opened (site unreachable from build machine)',
  },
  prudent: {
    name: 'Prudent Practices in the Laboratory (National Research Council, 2011)',
    url: 'https://www.nap.edu/catalog/12654',
    checked: 'catalog only',
  },
};

export const CITATION =
  'Compatibility logic: NOAA CAMEO Chemicals reactive groups (via PubChem). ' +
  'Segregation rules: Cornell EHS Laboratory Safety Manual (Appendices K and L), CDC/ATSDR, ' +
  'and OSHA 29 CFR 1910.106 / 1910.253.';

export const VERDICTS = {
  red: '🔴 DO NOT MIX / STORE APART',
  yellow: '🟡 SEGREGATE / STORE SEPARATELY',
  green: '🟢 COMPATIBLE: SAME STORAGE CLASS (conditions apply)',
  none: '⚪ NO RULE MATCHED (not the same as safe)',
};

// Severity order, worst first. 'none' ranks above 'green' on purpose: when a set
// of chemicals has one unknown pair, the overall answer must not look positive.
export const LEVEL_ORDER = { red: 0, yellow: 1, none: 2, green: 3 };

/** Turn a list of source keys into [{ name, url }] for the agent. */
function cite(keys) {
  return keys.map((key) => ({ name: SOURCES[key].name, url: SOURCES[key].url }));
}

// ---------------------------------------------------------------------------
// Part A — group definitions
// ---------------------------------------------------------------------------

/** "H361d" → "H361", "EUH014" stays "EUH014". Lets us match base codes. */
function baseCode(code) {
  const match = String(code).match(/^(EU)?H\d{3}/);
  return match ? match[0] : code;
}

const FLAMMABLE_CODES = ['H220', 'H221', 'H222', 'H223', 'H224', 'H225', 'H226', 'H228'];

// CAMEO organic families (fuel for oxidizers). Matched loosely so small
// wording differences in CAMEO's group names still count.
// \bOrganic\b matters: a plain /Organic/ would also match "Inorganic"
// (e.g. "Cyanides, Inorganic") and wrongly call sodium cyanide organic.
const ORGANIC_FAMILY =
  /Hydrocarbons|Ketones|Alcohols|Ethers|Esters|Aldehydes|Amines|Amides|Phenols|Thiols|Nitriles|Epoxides|Carboxylic|Anhydrides|Isocyanates|Carbamates|\bOrganic\b|Polymerizable/i;

/**
 * Work out which hazard groups a chemical belongs to.
 * @param chem { name, query, hazardCodes: string[], reactiveGroups: string[] }
 * @returns Set of group keys, e.g. Set { 'anyAcid', 'strongAcid', 'inorganicAcid' }
 */
export function classify(chem) {
  const rg = chem.reactiveGroups || [];
  const codes = new Set((chem.hazardCodes || []).map(baseCode));
  const hasRg = (pattern) => rg.some((g) => pattern.test(g));
  const hasCode = (...list) => list.some((c) => codes.has(c));
  const nameText = `${chem.name || ''} ${chem.query || ''}`;

  const g = new Set();
  const add = (key, condition) => condition && g.add(key);

  add('strongAcid', hasRg(/^Acids, Strong (Oxidizing|Non-oxidizing)/i));
  add('inorganicAcid', g.has('strongAcid'));
  add('organicAcid', hasRg(/^Acids, Carboxylic/i));
  // H314 + H272 is only a FALLBACK for chemicals with no CAMEO data: on its own it
  // also matches non-acid oxidizers such as potassium permanganate.
  add('oxidizingAcid', hasRg(/^Acids, Strong Oxidizing/i) || (rg.length === 0 && hasCode('H314') && hasCode('H272')));
  add('anyAcid', g.has('strongAcid') || g.has('organicAcid') || hasRg(/^Acids, Weak/i) || hasRg(/^Salts, Acidic/i));

  add('strongBase', hasRg(/^Bases, Strong/i));
  add('anyBase', g.has('strongBase') || hasRg(/^Bases, Weak/i) || hasRg(/^Salts, Basic/i));

  add('oxidizer', hasRg(/^Oxidizing Agents, Strong/i) || hasRg(/^Acids, Strong Oxidizing/i) || hasCode('H270', 'H271', 'H272'));
  add('reducingAgent', hasRg(/^Reducing Agents, Strong/i));

  add('flammable', hasCode(...FLAMMABLE_CODES));
  add('flammableLiquid', hasCode('H224', 'H225', 'H226'));
  // H227 = combustible liquid (GHS Category 4). Only used by rule 18 (OSHA covers both).
  add('flammableOrCombustibleLiquid', g.has('flammableLiquid') || hasCode('H227'));
  // e.g. glacial acetic acid: a flammable liquid that is also a (weak, organic) acid.
  add('flammableOrganicAcid', g.has('organicAcid') && g.has('flammableLiquid') && !g.has('strongAcid'));
  add('organic', g.has('flammable') || hasRg(ORGANIC_FAMILY));

  add('cyanide', hasRg(/^Cyanides/i));
  add('sulfide', hasRg(/^Sulfides, Inorganic/i));
  add('azide', hasRg(/Azide Compounds/i));

  add('waterReactive', hasCode('H260', 'H261') || hasRg(/^Metals, Alkali, Very Active|Metal Hydrides|Water[- ]Reactive/i));
  // Rule 7: alkali metals (Na, K, Li…) and active metals (Mg, Ca, powdered Al…), by CAMEO group.
  add('activeMetal', hasRg(/^Metals, Alkali, Very Active|^Metals, Elemental and Powder, Active/i));
  // Rule 7: CHLORINATED hydrocarbons only, because that's what Cornell Appendix K names.
  // CAMEO's group covers all halogens, so "chlor" in the name narrows it
  // (chloroform, carbon tetrachloride, dichloromethane / methylene chloride, trichloroethylene…).
  add('chlorinatedHydrocarbon', hasRg(/Halogenated Organic Compounds|Aryl Halides/i) && /chlor/i.test(nameText));
  add('aqueous', hasRg(/^Water and Aqueous Solutions/i));
  add('pyrophoric', hasCode('H250'));
  add('organicPeroxide', hasCode('H240', 'H241', 'H242') || hasRg(/^Peroxides, Organic/i));
  add('flammableGas', hasCode('H220', 'H221'));
  add('oxidizingGas', hasCode('H270'));

  // The only two name-based groups (approved by the builder): specific enough
  // that false matches are unlikely, and they cover the classic cleaning-product accidents.
  add('hypochlorite', /hypochlorite/i.test(nameText));
  // Rule 19 (haloform reaction): ketones by CAMEO group; isopropyl alcohol by name,
  // because ATSDR names it specifically (other alcohols aren't sourced yet).
  add('haloformSubstrate', hasRg(/^Ketones/i) || /isopropyl alcohol|isopropanol|propan-2-ol|2-propanol|rubbing alcohol/i.test(nameText));
  add('ammonia', /ammoni(a|um)/i.test(nameText));

  return g;
}

// Plain-English labels for the groups, so the agent can explain WHY a rule fired.
export const GROUP_LABELS = {
  strongAcid: 'strong acid',
  inorganicAcid: 'inorganic acid',
  organicAcid: 'organic (carboxylic) acid',
  oxidizingAcid: 'oxidizing acid',
  anyAcid: 'acid',
  strongBase: 'strong base',
  anyBase: 'base',
  oxidizer: 'oxidizer',
  reducingAgent: 'strong reducing agent',
  flammable: 'flammable',
  flammableLiquid: 'flammable liquid',
  flammableOrCombustibleLiquid: 'flammable or combustible liquid',
  flammableOrganicAcid: 'flammable organic acid (e.g. glacial acetic acid)',
  organic: 'fuel (flammable or organic)',
  cyanide: 'cyanide',
  sulfide: 'inorganic sulfide',
  azide: 'azide',
  waterReactive: 'water-reactive',
  activeMetal: 'alkali or alkaline-earth / active metal',
  chlorinatedHydrocarbon: 'chlorinated hydrocarbon (chlorinated solvent)',
  aqueous: 'aqueous solution / contains water',
  pyrophoric: 'pyrophoric',
  organicPeroxide: 'organic peroxide / self-reactive',
  flammableGas: 'flammable gas',
  oxidizingGas: 'oxidizing gas',
  hypochlorite: 'hypochlorite',
  haloformSubstrate: 'ketone (e.g. acetone) or isopropyl alcohol',
  ammonia: 'ammonia / ammonium compound',
};

// ---------------------------------------------------------------------------
// Part B — pair rules. `a` and `b` are lists of groups: the rule fires when one
// chemical is in ANY group of `a` and the other is in ANY group of `b`.
// ---------------------------------------------------------------------------

export const PAIR_RULES = [
  {
    id: 1, level: 'red', a: ['hypochlorite'], b: ['anyAcid'],
    reason: 'Releases chlorine gas, even with weak acids such as vinegar.',
    sources: ['atsdrChlorine', 'waDohBleach', 'cornellK'],
  },
  {
    id: 2, level: 'red', a: ['hypochlorite'], b: ['ammonia'],
    reason: 'Produces toxic chloramine gases.',
    sources: ['waDohBleach', 'cornellK'],
  },
  {
    id: 3, level: 'red', a: ['anyAcid'], b: ['cyanide'],
    reason: 'Releases hydrogen cyanide gas.',
    sources: ['cornellL', 'cornellK'],
  },
  {
    id: 4, level: 'red', a: ['anyAcid'], b: ['sulfide'],
    reason: 'Releases hydrogen sulfide gas.',
    sources: ['cornellK'],
  },
  {
    id: 5, level: 'red', a: ['anyAcid'], b: ['azide'],
    reason: 'Forms hydrazoic acid, a toxic gas that can be explosive.',
    sources: ['cornellK', 'cdcAzide'],
  },
  {
    id: 6, level: 'yellow', a: ['anyAcid'], b: ['anyBase'],
    reason:
      'Store separately. Mixing neutralises them into a salt and water; with concentrated ' +
      'strong acids or bases this releases a lot of heat and can boil and spatter.',
    sources: ['cornellL', 'cornell711'],
  },
  {
    // Builder, 2026-11-25, from Cornell Appendix K: "Alkaline and alkaline earth metals, such as
    // Sodium, Potassium, Cesium, Lithium, Magnesium, Calcium" vs "Carbon tetrachloride and other
    // chlorinated hydrocarbons". Reuses id 7, which was free after the old rule 7 merged into rule 6.
    id: 7, level: 'red', a: ['activeMetal'], b: ['chlorinatedHydrocarbon'],
    reason:
      'Alkali and alkaline-earth metals (e.g. sodium, potassium, lithium, magnesium, calcium) can react violently, ' +
      'even explosively, with carbon tetrachloride, chloroform and other chlorinated solvents. Store them apart, ' +
      'and never use a chlorinated solvent near these metals. On a metal fire, do not use water, foam, carbon dioxide ' +
      'or carbon tetrachloride: use a Class D extinguisher or dry sand.',
    sources: ['cornellK'],
  },
  {
    id: 8, level: 'red', a: ['oxidizer'], b: ['flammable', 'organic'],
    reason: 'The oxidizer feeds combustion: fire or explosion risk, and fires burn hotter.',
    sources: ['cornellL', 'cornell711'],
  },
  {
    id: 9, level: 'red', a: ['oxidizer'], b: ['reducingAgent'],
    reason: 'Violent redox reaction.',
    sources: ['cornellL', 'cameo'],
  },
  {
    id: 10, level: 'red', a: ['oxidizingAcid'], b: ['organicAcid', 'organic'],
    reason: 'Oxidizing acids (e.g. nitric) react violently with organic acids and organics (e.g. acetic acid).',
    sources: ['cornellL', 'cornellK'],
  },
  {
    id: 11, level: 'yellow', a: ['inorganicAcid'], b: ['organicAcid'],
    reason: 'Keep inorganic and organic acids in separate cabinets.',
    // Cornell L covers OXIDIZING acids vs other acids; the general inorganic vs
    // organic split relies on the NIH table, which hasn't been opened yet.
    sources: ['cornellL', 'nihTable'],
  },
  {
    id: 12, level: 'red', a: ['waterReactive'], b: ['aqueous', 'anyAcid'],
    reason: 'Reacts violently with water or acids, releasing heat and flammable or toxic gas.',
    sources: ['cornellL', 'cornellK', 'cameo'],
  },
  {
    id: 13, level: 'red', a: ['pyrophoric'], b: ['flammable', 'oxidizer'],
    reason: 'Ignites spontaneously in air; the fire spreads to neighbouring materials.',
    sources: ['cornellL', 'prudent'],
  },
  {
    id: 14, level: 'red', a: ['organicPeroxide'], b: ['oxidizer', 'reducingAgent', 'strongAcid', 'strongBase'],
    reason: 'Can decompose violently.',
    sources: ['cornellL', 'cornellK', 'prudent'],
  },
  {
    id: 15, level: 'red', a: ['oxidizingGas'], b: ['flammableGas'],
    reason:
      'Store cylinders at least 20 ft (6.1 m) apart, or separated by a non-combustible barrier at least ' +
      '5 ft (1.5 m) high with a fire-resistance rating of at least half an hour.',
    sources: ['osha253'],
  },
  {
    // Builder, 2026-11-19, from OSHA 1910.106(d)(7)(iv).
    id: 18, level: 'red', a: ['waterReactive'], b: ['flammableOrCombustibleLiquid'],
    reason:
      'Do not store in the same room or area. OSHA prohibits storing water-reactive materials in the same room ' +
      'as flammable or combustible liquids, and putting the water-reactive material in a separate cabinet inside ' +
      'that room does not satisfy the rule. Moisture, humidity or fire-suppression water can make the ' +
      'water-reactive material release heat or flammable/toxic gas, creating a severe fire or explosion risk ' +
      'next to the flammable liquids.',
    sources: ['osha106'],
  },
  {
    // Builder, 2026-11-20: bleach + acetone → chloroform (haloform reaction).
    id: 19, level: 'red', a: ['hypochlorite'], b: ['haloformSubstrate'],
    reason:
      'Forms chloroform: hypochlorite (bleach) reacts with acetone and other methyl ketones, and with isopropyl ' +
      '(rubbing) alcohol, to produce chloroform, a toxic vapour (the haloform reaction). Do not mix, and ventilate ' +
      'if both have been used in the same area.',
    sources: ['atsdrChloroform'],
  },
];
// (The original rule 7 was merged into rule 6 on 2026-11-19; id 7 is now the active-metal rule above.)

/**
 * Rules 16–17 — compatible storage class (builder, 2026-11-19).
 * Only apply when NO hazard rule above fired, AND neither chemical has a
 * second hazard that changes where it's stored (`exclude`).
 */
const SAME_CLASS_RULES = [
  {
    id: 16, level: 'green', a: ['flammableLiquid'], b: ['flammableLiquid'],
    exclude: ['anyAcid', 'anyBase', 'oxidizer', 'waterReactive', 'pyrophoric', 'organicPeroxide'],
    reason:
      'Both are flammable liquids and compatible with each other, so they can generally be stored together. ' +
      'Because both are highly flammable, keep them in a fire-rated flammable storage cabinet, away from heat, ' +
      'ignition sources and oxidizers.',
    sources: ['cornellL', 'osha106'],
  },
  {
    // Builder, 2026-11-19: acetone + glacial acetic acid → yes, with strict precautions.
    // Cornell Appendix L agrees: organic liquid acids are "Stored in flammable cabinets
    // if concentration at or above 80%" and should be segregated from strong bases.
    id: 17, level: 'green', a: ['flammableLiquid'], b: ['flammableOrganicAcid'],
    exclude: ['strongAcid', 'anyBase', 'oxidizer', 'waterReactive', 'pyrophoric', 'organicPeroxide'],
    reason:
      'Both are flammable liquids, so they can be stored together with strict precautions. The organic acid ' +
      '(e.g. glacial acetic acid, 80–100%) is also corrosive: use secondary containment (a tray) inside a ' +
      'fire-rated flammable storage cabinet, away from heat, ignition sources, oxidizers, oxidizing acids such as ' +
      'nitric acid, and bases. Some guidelines keep organic acids separate from organic solvents instead, so ' +
      'follow your site\'s chemical storage plan.',
    sources: ['cornellL', 'osha106'],
  },
];

/** Which of `groupsWanted` does this chemical have? */
function overlap(groups, groupsWanted) {
  return groupsWanted.filter((key) => groups.has(key));
}

/**
 * Check one pair of classified chemicals against every rule.
 * Tests both directions (A–B and B–A), so rule order in the table doesn't matter.
 * @returns { level: 'red'|'yellow'|'green'|'none', verdict, findings: [...] }, worst findings first
 */
export function checkPair(groupsA, groupsB) {
  const findings = matchRules(PAIR_RULES, groupsA, groupsB);
  // Same-class (🟢) rules only count when no hazard rule fired.
  if (findings.length === 0) findings.push(...matchRules(SAME_CLASS_RULES, groupsA, groupsB));
  findings.sort((x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level]);
  const level = findings[0]?.level || 'none';
  return { level, verdict: VERDICTS[level], findings };
}

/** Test a list of rules against a pair, in both directions. */
function matchRules(rules, groupsA, groupsB) {
  const findings = [];
  for (const rule of rules) {
    // Skip rules that don't apply when either chemical has an excluded group.
    if (rule.exclude && rule.exclude.some((key) => groupsA.has(key) || groupsB.has(key))) continue;
    const forward = [overlap(groupsA, rule.a), overlap(groupsB, rule.b)];
    const backward = [overlap(groupsB, rule.a), overlap(groupsA, rule.b)];
    let because = null;
    if (forward[0].length && forward[1].length) because = { first: forward[0], second: forward[1] };
    else if (backward[0].length && backward[1].length) because = { first: backward[1], second: backward[0] };
    if (!because) continue;
    findings.push({
      rule: rule.id,
      level: rule.level,
      verdict: VERDICTS[rule.level],
      // e.g. "first chemical is: hypochlorite; second is: acid"
      matchedAs: {
        first: because.first.map((k) => GROUP_LABELS[k]),
        second: because.second.map((k) => GROUP_LABELS[k]),
      },
      reason: rule.reason,
      sources: cite(rule.sources),
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Part C — single-chemical storage notes. Each note carries its source.
// ---------------------------------------------------------------------------

export function storageNotes(chem) {
  const codes = new Set((chem.hazardCodes || []).map(baseCode));
  const rg = chem.reactiveGroups || [];
  const notes = [];
  const add = (note, sourceKeys) => notes.push({ note, sources: cite(sourceKeys) });

  if (codes.has('H260') || codes.has('H261') || rg.some((g) => /^Metals, Alkali, Very Active|Metal Hydrides|Water[- ]Reactive/i.test(g))) {
    // Builder, 2026-11-19.
    add(
      'Water-reactive: keep strictly isolated from water, moisture and flammable liquids, in a cool, dry place ' +
        '(under inert gas or mineral oil where required), with secondary containment and the right extinguisher ' +
        '(e.g. Class D for reactive metals). Never in the same room as flammable liquids.',
      ['cornellL', 'osha106'],
    );
  }
  if (codes.has('H290')) add('Corrosive to metals: use corrosion-resistant (not metal) shelving.', ['cornellL']);
  if (codes.has('H280') || codes.has('H281')) {
    add('Gas cylinder: store secured upright in a ventilated area, not in unventilated lockers or cupboards.', ['osha253']);
  }
  if (['H340', 'H350', 'H360'].some((c) => codes.has(c))) {
    add(
      'Carcinogen / mutagen / reproductive toxin: use a designated area under the OSHA Laboratory Standard ' +
        '(H-codes approximate OSHA\'s "select carcinogen" lists).',
      ['osha1450'],
    );
  }
  if (rg.some((g) => /^Ethers/i.test(g))) {
    add('May form explosive peroxides: date the container on receipt and on opening, and test periodically.', ['cornellJ']);
  }
  if (codes.has('H314')) {
    add('Corrosive at the classified (pure) concentration: check the product SDS for your actual concentration.', []);
  }
  return notes;
}
