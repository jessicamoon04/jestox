/**
 * pubchem.js — everything that talks to PubChem and turns its (very large)
 * responses into a small, clean summary the Rovo agent can read.
 *
 * This file deliberately does NOT import anything from Forge. The caller passes
 * in a `fetchFn`, so the same code runs:
 *   - inside Forge (index.js passes Forge's fetch, which enforces egress rules)
 *   - on a laptop for testing (scripts pass Node's built-in fetch)
 *
 * PubChem APIs used (free, no API key, max 5 requests/second):
 *   1. PUG REST  — turn a name / synonym / CAS number into a compound ID (CID)
 *   2. PUG View  — fetch the "Safety and Hazards" section for that CID
 */

const BASE = 'https://pubchem.ncbi.nlm.nih.gov';

// Limits that keep the response small and readable for the agent.
// PubChem's safety section is 150–250 KB; we return a few KB.
const MAX_TEXT_LENGTH = 400; // characters per text snippet
const MAX_ITEMS_PER_FIELD = 4; // snippets per field (e.g. 4 first-aid notes)
const MAX_HAZARD_STATEMENTS = 15;
const REQUEST_TIMEOUT_MS = 10000; // Forge functions time out at 25 s, so stay well under

// Fields we pull out of the safety section, and the PubChem headings that feed
// each one. A heading can be missing for a given chemical — that's normal.
const FIELD_HEADINGS = {
  exposureLimits: [
    'Permissible Exposure Limit (PEL)',
    'Recommended Exposure Limit (REL)',
    'Threshold Limit Values (TLV)',
    'Immediately Dangerous to Life or Health (IDLH)',
    'Occupational Exposure Limits (OEL)',
  ],
  ppe: ['Personal Protective Equipment (PPE)'],
  firstAid: ['First Aid Measures'],
  storage: ['Safe Storage', 'Storage Conditions'],
  incompatibilities: ['Hazardous Reactivities and Incompatibilities'],
  spillResponse: ['Spillage Disposal', 'Cleanup Methods'],
  disposal: ['Disposal Methods'],
};

/** Small custom error so the caller can tell "PubChem is down" apart from bugs. */
export class PubChemError extends Error {}

/**
 * GET a PubChem URL and parse JSON.
 * Returns null on 404 (PubChem's way of saying "no such compound / no such section").
 * Throws PubChemError for anything else that goes wrong.
 */
export async function getJson(url, fetchFn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetchFn(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new PubChemError(`Could not reach PubChem (${err.name === 'AbortError' ? 'timed out' : err.message})`);
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 404) return null;
  if (response.status === 503) throw new PubChemError('PubChem is busy right now (rate limited). Try again in a moment.');
  if (!response.ok) throw new PubChemError(`PubChem returned HTTP ${response.status}`);
  return response.json();
}

/**
 * Step 1: name / synonym / CAS number → PubChem CID.
 * Returns the first (best-ranked) CID, or null if PubChem doesn't recognise the name.
 */
export async function resolveCid(chemicalName, fetchFn) {
  const url = `${BASE}/rest/pug/compound/name/${encodeURIComponent(chemicalName)}/cids/JSON`;
  const json = await getJson(url, fetchFn);
  const cids = json?.IdentifierList?.CID || [];
  return cids.find((cid) => cid > 0) || null; // PubChem uses CID 0 for "not found" in some cases
}

/** Step 2: CID → the raw "Safety and Hazards" record (or null if PubChem has none). */
export async function fetchSafetyRecord(cid, fetchFn) {
  const url = `${BASE}/rest/pug_view/data/compound/${cid}/JSON?heading=Safety+and+Hazards`;
  return getJson(url, fetchFn);
}

// ---------------------------------------------------------------------------
// Helpers for reading PubChem's PUG View JSON
// ---------------------------------------------------------------------------

/** Collapse whitespace and cut long text, so the agent gets tidy snippets. */
export function clean(text, maxLength = MAX_TEXT_LENGTH) {
  const tidy = String(text || '')
    // Some PubChem sources contain UTF-8 bytes mis-decoded as Latin-1 ("â€¢" instead of "•").
    .replace(/â(?:€|\u0080)¢/g, '•')
    .replace(/â(?:€|\u0080)(?:™|\u0099)/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return tidy.length > maxLength ? `${tidy.slice(0, maxLength - 1)}…` : tidy;
}

/**
 * Each PUG View "Information" item stores its text in Value.StringWithMarkup[].
 * Returns an array of strings (one per entry). For icon-only entries (pictograms)
 * the text is blank and the meaning lives in Markup[].Extra, so we use that instead.
 */
export function stringsOf(info) {
  // Some values are numbers with a unit (e.g. molecular weight) rather than text.
  if (Array.isArray(info?.Value?.Number)) {
    const unit = info.Value.Unit ? ` ${info.Value.Unit}` : '';
    return info.Value.Number.map((n) => `${n}${unit}`);
  }
  const entries = info?.Value?.StringWithMarkup || [];
  return entries
    .map((entry) => {
      const text = (entry.String || '').trim();
      if (text) return text;
      return (entry.Markup || []).map((m) => m.Extra).filter(Boolean).join(', ');
    })
    .filter(Boolean);
}

/** Depth-first search for a section by its heading. */
export function findSection(sections, heading) {
  for (const section of sections || []) {
    if (section.TOCHeading === heading) return section;
    const found = findSection(section.Section, heading);
    if (found) return found;
  }
  return null;
}

/** Map of ReferenceNumber → source name (e.g. "CAMEO Chemicals"), for citations. */
export function buildSourceMap(record) {
  const map = new Map();
  for (const ref of record?.Reference || []) {
    map.set(ref.ReferenceNumber, ref.SourceName || 'PubChem');
  }
  return map;
}

/**
 * Collect short, de-duplicated snippets from one or more headings.
 * Each snippet keeps its label (e.g. "Eye First Aid") and its original source,
 * so the agent can cite where the information came from.
 */
export function collectSnippets(sections, headings, sources, maxItems = MAX_ITEMS_PER_FIELD) {
  const snippets = [];
  const seen = new Set();
  for (const heading of headings) {
    const section = findSection(sections, heading);
    for (const info of section?.Information || []) {
      const text = clean(stringsOf(info).join(' '));
      if (!text || seen.has(text)) continue;
      seen.add(text);
      snippets.push({
        // Fall back to the section heading so e.g. an unlabelled limit still says
        // whether it is an OSHA PEL, a NIOSH REL or an ACGIH TLV.
        label: info.Name || heading,
        text,
        source: sources.get(info.ReferenceNumber) || 'PubChem',
      });
      if (snippets.length >= maxItems) return snippets;
    }
  }
  return snippets;
}

/**
 * GHS classification. PubChem lists the classification once per data source
 * (e.g. a regulator, then ECHA notifications). We report the FIRST source in
 * full and count the others, plus a union of every H-code from all sources —
 * that union is what the compatibility rules (step 3) will key off.
 */
function summariseGhs(sections, sources) {
  const ghsSection = findSection(sections, 'GHS Classification');
  const infos = ghsSection?.Information || [];
  if (infos.length === 0) return { ghs: null, hazardCodes: [] };

  // Group the GHS entries by the source they came from, keeping PubChem's order.
  const bySource = new Map();
  for (const info of infos) {
    if (!bySource.has(info.ReferenceNumber)) bySource.set(info.ReferenceNumber, []);
    bySource.get(info.ReferenceNumber).push(info);
  }

  // Every H-code (and EU-specific EUH-code) mentioned by any source, e.g. "H314".
  const hazardCodes = new Set();
  for (const info of infos) {
    if (info.Name !== 'GHS Hazard Statements') continue;
    for (const s of stringsOf(info)) {
      for (const match of s.matchAll(/\b(?:EU)?H\d{3}[A-Za-z]{0,2}\b/g)) hazardCodes.add(match[0]);
    }
  }

  // Primary source = first source that actually has a signal word or H-statements.
  const [primaryRef, primaryInfos] =
    [...bySource.entries()].find(([, list]) =>
      list.some((i) => i.Name === 'Signal' || i.Name === 'GHS Hazard Statements'),
    ) || [];
  if (!primaryInfos) return { ghs: null, hazardCodes: [...hazardCodes].sort() };

  const pick = (name) => primaryInfos.find((i) => i.Name === name);
  const pictogramInfo = pick('Pictogram(s)');
  const pictograms = (pictogramInfo?.Value?.StringWithMarkup || [])
    .flatMap((entry) => (entry.Markup || []).map((m) => m.Extra))
    .filter(Boolean);

  const ghs = {
    source: sources.get(primaryRef) || 'PubChem',
    signalWord: stringsOf(pick('Signal'))[0] || null,
    pictograms,
    hazardStatements: stringsOf(pick('GHS Hazard Statements'))
      .slice(0, MAX_HAZARD_STATEMENTS)
      .map((s) => clean(s, 200)),
    precautionaryCodes: clean(
      (stringsOf(pick('Precautionary Statement Codes'))[0] || '').replace(/\s*\(click each P-code.*\)$/i, ''),
      300,
    ) || null,
    otherSourcesCount: Math.max(0, bySource.size - 1),
  };
  return { ghs, hazardCodes: [...hazardCodes].sort() };
}

/**
 * NOAA CAMEO Chemicals reactive groups, e.g. bleach → ["Salts, Basic",
 * "Oxidizing Agents, Strong", "Water and Aqueous Solutions"].
 * PubChem stores each group as its own string, so no text parsing is needed.
 * These drive the compatibility rules in rules.js (they tell acids from bases,
 * which GHS H-codes cannot).
 */
function extractReactiveGroups(sections) {
  const section = findSection(sections, 'Reactive Group');
  const groups = new Set();
  for (const info of section?.Information || []) {
    for (const entry of info?.Value?.StringWithMarkup || []) {
      const name = (entry.String || '').trim();
      if (name) groups.add(name);
    }
  }
  return [...groups];
}

/**
 * Turn the raw PubChem record into the compact object the agent receives.
 * Anything PubChem doesn't have is listed in `missing`, so the agent can say
 * "no data" instead of filling the gap from memory.
 */
export function summariseSafetyRecord(record, cid, query) {
  const sections = record?.Record?.Section || [];
  const sources = buildSourceMap(record?.Record);
  const { ghs, hazardCodes } = summariseGhs(sections, sources);

  const summary = {
    found: true,
    query,
    name: record?.Record?.RecordTitle || query,
    cid,
    pubchemUrl: `${BASE}/compound/${cid}`,
    safetySectionUrl: `${BASE}/compound/${cid}#section=Safety-and-Hazards`,
    ghs,
    hazardCodes,
    reactiveGroups: extractReactiveGroups(sections),
  };

  for (const [field, headings] of Object.entries(FIELD_HEADINGS)) {
    summary[field] = collectSnippets(sections, headings, sources);
  }

  const missing = [];
  if (!ghs) missing.push('ghs');
  if (summary.reactiveGroups.length === 0) missing.push('reactiveGroups');
  for (const field of Object.keys(FIELD_HEADINGS)) {
    if (summary[field].length === 0) missing.push(field);
  }
  summary.missing = missing;
  summary.note =
    'All data above is quoted from PubChem and the sources it cites. Fields listed in "missing" ' +
    'have no PubChem data for this compound: say so, do not fill them in from general knowledge.';
  return summary;
}

/**
 * The whole lookup: name → CID → safety record → summary.
 * Always resolves to a plain object (never throws), so the agent always gets
 * something it can explain to the user.
 */
export async function lookupChemicalSafety(chemicalName, fetchFn) {
  const query = clean(chemicalName, 120);
  if (!query) {
    return { found: false, query, message: 'No chemical name was provided. Ask the user which chemical they mean.' };
  }

  try {
    const cid = await resolveCid(query, fetchFn);
    if (!cid) {
      return {
        found: false,
        query,
        message:
          `PubChem has no compound matching "${query}". Ask the user to check the spelling, ` +
          'or give the IUPAC name or CAS number. Trade names and mixtures often are not in PubChem.',
      };
    }

    const record = await fetchSafetyRecord(cid, fetchFn);
    if (!record) {
      return {
        found: false,
        query,
        cid,
        pubchemUrl: `${BASE}/compound/${cid}`,
        message:
          `PubChem knows "${query}" (CID ${cid}) but has no safety and hazard data for it. ` +
          'Do not supply hazard information from memory; point the user to the supplier SDS.',
      };
    }

    return summariseSafetyRecord(record, cid, query);
  } catch (err) {
    if (err instanceof PubChemError) {
      return { found: false, query, error: true, message: `${err.message}. Tell the user the lookup failed and to try again shortly.` };
    }
    throw err; // genuine bug: let it surface in the Forge logs
  }
}
