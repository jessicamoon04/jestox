/**
 * compatibility.js — the check-compatibility workflow:
 *   names → PubChem lookups → classify each chemical → test every pair → summary
 *
 * Like pubchem.js, it takes `fetchFn` as a parameter so it can be tested
 * outside Forge. The rules themselves live in rules.js.
 */
import { lookupChemicalSafety } from './pubchem.js';
import { CITATION, GROUP_LABELS, LEVEL_ORDER, VERDICTS, checkPair, classify, storageNotes } from './rules.js';

const MAX_CHEMICALS = 6; // 6 chemicals = 15 pairs = 12 PubChem requests: fast enough for Forge's 25 s limit
const PAUSE_BETWEEN_LOOKUPS_MS = 250; // each lookup makes 2 requests; this keeps us under PubChem's 5 requests/second

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Split the agent's input into separate chemical names.
 * The action description asks for a comma-separated list, but we also accept
 * semicolons and new lines. We deliberately don't split on "and", because
 * chemical names can contain it.
 */
export function splitChemicalList(text) {
  const seen = new Set();
  return String(text || '')
    .split(/[,;\n|]+/)
    .map((s) => s.trim())
    .filter((s) => {
      const key = s.toLowerCase();
      if (!s || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export async function checkCompatibility(chemicalsText, fetchFn) {
  const names = splitChemicalList(chemicalsText);
  if (names.length < 2) {
    return {
      ok: false,
      message: 'A compatibility check needs at least two chemicals. Ask the user which chemicals to compare.',
    };
  }
  const tooMany = names.length > MAX_CHEMICALS ? names.slice(MAX_CHEMICALS) : [];
  const toCheck = names.slice(0, MAX_CHEMICALS);

  // 1. Look up each chemical one after another (not in parallel) to respect PubChem's rate limit.
  const lookups = [];
  for (const [i, name] of toCheck.entries()) {
    if (i > 0) await sleep(PAUSE_BETWEEN_LOOKUPS_MS);
    lookups.push(await lookupChemicalSafety(name, fetchFn));
  }

  const found = lookups.filter((r) => r.found);
  const notFound = lookups.filter((r) => !r.found).map((r) => ({ query: r.query, message: r.message }));

  // 2. Classify each chemical that was found.
  const chemicals = found.map((r) => {
    const groups = classify(r);
    return {
      query: r.query,
      name: r.name,
      cid: r.cid,
      pubchemUrl: r.pubchemUrl,
      signalWord: r.ghs?.signalWord || null,
      reactiveGroups: r.reactiveGroups,
      hazardGroups: [...groups].map((k) => GROUP_LABELS[k]),
      storageNotes: storageNotes(r),
      _groups: groups, // internal, removed below
    };
  });

  // 3. Check every pair.
  const pairs = [];
  for (let i = 0; i < chemicals.length; i++) {
    for (let j = i + 1; j < chemicals.length; j++) {
      const result = checkPair(chemicals[i]._groups, chemicals[j]._groups);
      pairs.push({ chemicals: [chemicals[i].name, chemicals[j].name], ...result });
    }
  }
  pairs.sort((x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level]);

  const overall = pairs[0]?.level || 'none';
  const incomplete = chemicals.filter((c) => c.reactiveGroups.length === 0).map((c) => c.name);

  return {
    ok: true,
    overallVerdict: VERDICTS[overall],
    pairs,
    chemicals: chemicals.map(({ _groups, ...rest }) => rest),
    notFound,
    ...(tooMany.length ? { notChecked: tooMany, notCheckedReason: `Only ${MAX_CHEMICALS} chemicals can be checked at once.` } : {}),
    ...(incomplete.length
      ? { incompleteData: incomplete, incompleteReason: 'No CAMEO reactive groups in PubChem for these, so the acid/base and gas-release rules could not be applied to them.' }
      : {}),
    citation: CITATION,
    concentrationCaveat:
      'GHS data describes the pure substance; classification changes with concentration, so check the product SDS. ' +
      'The CAMEO-based rules (acid/base, toxic gas release) still apply to dilute solutions.',
    note:
      'A pair with no matching rule is NOT confirmed safe: say "no incompatibility found in these rules" and tell the user to check both SDSs. ' +
      'If any chemical is in notFound or incompleteData, say the check is incomplete.',
  };
}
