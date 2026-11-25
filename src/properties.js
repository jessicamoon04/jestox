/**
 * properties.js — the chemical-properties action: identity, classification,
 * physical/chemical properties and uses of ONE chemical, from PubChem.
 *
 * Answers coursework-style questions such as "what is its formula / molecular
 * weight / pH / solubility?", "is it an acid, base or salt?", "is it an
 * oxidizer?", "what is it used for?". It also returns the molecular weight the
 * agent needs for molarity and standard-solution calculations.
 *
 * PubChem requests per call (made one after another, to respect PubChem's
 * limit of 5 requests/second):
 *   1. name → CID
 *   2. basic properties (formula, molecular weight, IUPAC name)
 *   3. synonyms (common names, CAS number)
 *   4. "Chemical and Physical Properties" section
 *   5. "Use and Manufacturing" section
 *   6. "Safety and Hazards" section (for classification and water reactions)
 */
import {
  PubChemError,
  buildSourceMap,
  clean,
  collectSnippets,
  fetchSafetyRecord,
  findSection,
  getJson,
  resolveCid,
  summariseSafetyRecord,
} from './pubchem.js';
import { GROUP_LABELS, classify } from './rules.js';

const BASE = 'https://pubchem.ncbi.nlm.nih.gov';
const PAUSE_MS = 200;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Property fields → PubChem headings in "Chemical and Physical Properties".
// Two snippets per field: sources often disagree on units or conditions.
const PROPERTY_HEADINGS = {
  physicalDescription: ['Physical Description'],
  colorForm: ['Color/Form'],
  odor: ['Odor'],
  meltingPoint: ['Melting Point'],
  boilingPoint: ['Boiling Point'],
  density: ['Density'],
  solubility: ['Solubility'],
  pH: ['pH'],
  dissociationConstants: ['Dissociation Constants'], // pKa: helps answer strong vs weak acid/base, electrolyte
  vaporPressure: ['Vapor Pressure'],
  stability: ['Stability/Shelf Life'],
  decomposition: ['Decomposition'],
  corrosivity: ['Corrosivity'],
};

/** GET a PUG View section; returns its sections array, or [] if PubChem has none. */
async function fetchSection(cid, heading, fetchFn) {
  const url = `${BASE}/rest/pug_view/data/compound/${cid}/JSON?heading=${encodeURIComponent(heading)}`;
  const json = await getJson(url, fetchFn);
  return { sections: json?.Record?.Section || [], sources: buildSourceMap(json?.Record) };
}

/**
 * Pick readable common names and the CAS number from PubChem's synonym list
 * (which is long and full of registry codes like "UNII-55X04QC32I").
 */
function pickNames(synonyms) {
  const cas = synonyms.find((s) => /^\d{2,7}-\d{2}-\d$/.test(s)) || null;
  const common = synonyms
    .filter((s) => s.length <= 40 && /^[A-Za-z][A-Za-z ,()'-]*$/.test(s) && !/[A-Z]{3,}/.test(s.replace(/^[A-Z]+$/, '')))
    .slice(0, 6);
  return { casNumber: cas, commonNames: common };
}

export async function lookupChemicalProperties(chemicalName, fetchFn) {
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
          'or give the IUPAC name or CAS number.',
      };
    }

    // 2–3. Identity: formula, weight, names.
    await sleep(PAUSE_MS);
    const basic = await getJson(
      `${BASE}/rest/pug/compound/cid/${cid}/property/MolecularFormula,MolecularWeight,IUPACName,Title/JSON`,
      fetchFn,
    );
    const props = basic?.PropertyTable?.Properties?.[0] || {};
    await sleep(PAUSE_MS);
    const synonymJson = await getJson(`${BASE}/rest/pug/compound/cid/${cid}/synonyms/JSON`, fetchFn);
    const { casNumber, commonNames } = pickNames(synonymJson?.InformationList?.Information?.[0]?.Synonym || []);

    // 4. Physical and chemical properties.
    await sleep(PAUSE_MS);
    const physical = await fetchSection(cid, 'Chemical and Physical Properties', fetchFn);
    const properties = {};
    for (const [field, headings] of Object.entries(PROPERTY_HEADINGS)) {
      properties[field] = collectSnippets(physical.sections, headings, physical.sources, 2);
    }
    const chemicalClasses = collectSnippets(physical.sections, ['Chemical Classes'], physical.sources, 3);

    // 5. Uses.
    await sleep(PAUSE_MS);
    const useSection = await fetchSection(cid, 'Use and Manufacturing', fetchFn);
    const uses = collectSnippets(useSection.sections, ['Uses', 'Industry Uses', 'Consumer Uses'], useSection.sources, 4);

    // 6. Classification + water reactions, from the safety section.
    await sleep(PAUSE_MS);
    const safetyRecord = await fetchSafetyRecord(cid, fetchFn);
    const safety = safetyRecord ? summariseSafetyRecord(safetyRecord, cid, query) : null;
    const safetySources = buildSourceMap(safetyRecord?.Record);
    const reactionWithWater = safetyRecord
      ? collectSnippets(safetyRecord.Record.Section, ['Air and Water Reactions'], safetySources, 2)
      : [];
    const groups = safety ? classify(safety) : new Set();

    const result = {
      found: true,
      query,
      cid,
      name: props.Title || query,
      iupacName: props.IUPACName || null,
      commonNames,
      casNumber,
      formula: props.MolecularFormula || null,
      molecularWeight: props.MolecularWeight ? `${props.MolecularWeight} g/mol` : null,
      pubchemUrl: `${BASE}/compound/${cid}`,
      classification: {
        // Plain-English groups from the same logic as the compatibility rules,
        // e.g. ["strong base", "base", "aqueous solution / contains water"].
        hazardGroups: [...groups].map((k) => GROUP_LABELS[k]),
        reactiveGroups: safety?.reactiveGroups || [], // NOAA CAMEO
        chemicalClasses,
        ghsSignalWord: safety?.ghs?.signalWord || null,
        ghsPictograms: safety?.ghs?.pictograms || [],
        hazardCodes: safety?.hazardCodes || [],
      },
      properties: { ...properties, reactionWithWater },
      uses,
    };

    const missing = [];
    for (const field of ['formula', 'molecularWeight']) if (!result[field]) missing.push(field);
    for (const [field, value] of Object.entries(result.properties)) if (value.length === 0) missing.push(field);
    if (uses.length === 0) missing.push('uses');
    if (!safety) missing.push('classification');
    result.missing = missing;

    result.note =
      'Values are quoted from PubChem and the sources it cites, usually for the pure substance; ' +
      'solution values depend on concentration. Fields in "missing" have no PubChem data: say so, ' +
      'do not fill them from memory. For questions this data cannot answer (why a chemical is used ' +
      'in a specific experiment, alternatives, calculations), answer from general chemistry knowledge ' +
      'and label it clearly as general knowledge, not PubChem data.';
    return result;
  } catch (err) {
    if (err instanceof PubChemError) {
      return { found: false, query, error: true, message: `${err.message}. Tell the user the lookup failed and to try again shortly.` };
    }
    throw err;
  }
}
