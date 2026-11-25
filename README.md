# JESTOX

**JESTOX is a toxicologist on your team, inside Jira.** It looks up chemical hazards, checks storage compatibility and helps with incident response, with every answer sourced.

JESTOX (**Jes**sica + **Tox**icology) is an Atlassian Forge app with a Rovo agent, built for **Codegeist 2026** (Apps for Specialized Industries).

## What it does

- **Chemical lookup:** GHS hazards, exposure limits, PPE, first aid, storage, spill response and disposal, live from PubChem
- **Compatibility check:** 19 sourced rules (Cornell EHS, CDC/ATSDR, OSHA) with verdicts 🔴 do not mix · 🟡 segregate · 🟢 compatible with conditions · ⚪ no rule matched
- **Chemistry questions:** formula, molecular weight, acid/base strength, pH, solubility, uses and lab calculations
- **Jira task safety checks:** reads an issue, finds the chemicals and posts a safety-check comment (with your OK)
- **Incident mode:** emergency-first response steps, then creates follow-up Jira tasks (with your OK)

## How it's built

An Atlassian Forge app (Node.js 24) with a `rovo:agent`, six Rovo actions and a `rovo:mcp` module.

| File | What it does |
|---|---|
| [manifest.yml](manifest.yml) | The agent, its actions, the MCP tools, Jira scopes and the PubChem egress permission |
| [prompts/agent-prompt.txt](prompts/agent-prompt.txt) | The agent's instructions: sourcing, emergencies first, Jira checks, incident mode |
| [src/rules.js](src/rules.js) | The 19 compatibility rules and storage notes, each with linked sources |
| [COMPATIBILITY-RULES.md](COMPATIBILITY-RULES.md) | The same rules in plain English, with the builder's decisions and sources |
| [src/pubchem.js](src/pubchem.js) | Fetches and trims PubChem safety data (GHS, PPE, first aid, NOAA CAMEO reactive groups) |
| [src/compatibility.js](src/compatibility.js) | Checks every pair of 2–6 chemicals against the rules |
| [src/properties.js](src/properties.js) | Chemistry properties: formula, molecular weight, pKa, solubility, uses |
| [src/jira.js](src/jira.js) | Reads a Jira issue and posts the safety-check comment (as the user) |
| [src/incident.js](src/incident.js) | Creates the incident follow-up tasks in Jira (as the user) |

To deploy your own copy: install the [Forge CLI](https://developer.atlassian.com/platform/forge/getting-started/), run `npm install`, then `forge register`, `forge deploy` and `forge install` on a Jira site with Rovo enabled.

## Privacy

See [PRIVACY.md](PRIVACY.md). JESTOX stores no personal data.

## Safety disclaimer

JESTOX supports, but does not replace, professional judgement. Always verify against the supplier's Safety Data Sheet (SDS) and your safety officer.

## Contact

sweetami04real@gmail.com
