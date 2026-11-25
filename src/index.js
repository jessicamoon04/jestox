/**
 * index.js — Forge function handlers for the Rovo agent's actions.
 *
 * Each exported function here is referenced by a `function` entry in
 * manifest.yml. Rovo calls it with:
 *   payload — the action inputs the agent extracted from the chat
 *             (LLM-generated, so treat as untrusted text), plus `context`
 *   context — trusted platform info such as the user's accountId
 *
 * Whatever we return (a string or JSON object) is handed back to the agent,
 * which turns it into a natural-language answer.
 *
 * api.fetch is Forge's fetch: it only allows hosts listed under
 * permissions.external.fetch.backend in manifest.yml (here, PubChem only).
 */
import api from '@forge/api';
import { lookupChemicalSafety } from './pubchem.js';
import { checkCompatibility } from './compatibility.js';
import { lookupChemicalProperties } from './properties.js';

// Jira actions live in their own file; re-exported so manifest handlers can use index.*
export { readJiraIssue, addSafetyComment } from './jira.js';
export { createIncidentTasks } from './incident.js';

/**
 * Action: lookup-chemical
 * Input:  payload.chemical — one chemical name, synonym or CAS number
 * Output: GHS classification, exposure limits, PPE, first aid, storage,
 *         incompatibilities, spill response and disposal, with PubChem links.
 */
export async function lookupChemical(payload) {
  const chemical = typeof payload?.chemical === 'string' ? payload.chemical : '';
  const result = await lookupChemicalSafety(chemical, api.fetch);

  // One short log line per lookup — useful in the Developer Console, small enough to stay cheap.
  console.log(
    `lookup-chemical query="${result.query}" found=${result.found}` +
      (result.cid ? ` cid=${result.cid}` : '') +
      (result.missing ? ` missing=${result.missing.join(',') || 'none'}` : ''),
  );
  return result;
}

/**
 * Action: chemical-properties
 * Input:  payload.chemical — one chemical name, synonym or CAS number
 * Output: names, formula, molecular weight, classification (acid/base/oxidizer…),
 *         physical/chemical properties (state, colour, pH, solubility, pKa…) and uses.
 */
export async function chemicalProperties(payload) {
  const chemical = typeof payload?.chemical === 'string' ? payload.chemical : '';
  const result = await lookupChemicalProperties(chemical, api.fetch);
  console.log(
    `chemical-properties query="${result.query}" found=${result.found}` +
      (result.cid ? ` cid=${result.cid}` : '') +
      (result.missing ? ` missing=${result.missing.join(',') || 'none'}` : ''),
  );
  return result;
}

/**
 * Action: check-compatibility
 * Input:  payload.chemicals — 2 to 6 chemical names, comma-separated
 * Output: a verdict for every pair (🔴 / 🟡 / ⚪) with the reason and source,
 *         plus storage notes for each chemical.
 */
export async function checkChemicalCompatibility(payload) {
  const chemicals = typeof payload?.chemicals === 'string' ? payload.chemicals : '';
  const result = await checkCompatibility(chemicals, api.fetch);

  console.log(
    `check-compatibility input="${chemicals.slice(0, 200)}" ok=${result.ok}` +
      (result.pairs ? ` pairs=${result.pairs.map((p) => `${p.chemicals.join('+')}:${p.level}`).join(';')}` : ''),
  );
  return result;
}
