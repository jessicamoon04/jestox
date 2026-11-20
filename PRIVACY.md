# JESTOX Privacy Policy

*Last updated: 20 November 2026*

JESTOX is a chemical safety assistant (a Rovo agent) for Atlassian Jira, built on Atlassian Forge for the Codegeist 2026 hackathon. This policy explains what data JESTOX uses and where it goes.

## What JESTOX does with your data

**JESTOX does not store any personal data.** It has no database. It runs entirely on Atlassian's Forge platform.

When you use JESTOX, it may process:

| Data | Why | Where it goes |
|---|---|---|
| Chemical names or CAS numbers from your chat messages or Jira issues | To look up safety and property data | Sent to **PubChem** (pubchem.ncbi.nlm.nih.gov, run by the U.S. National Institutes of Health). Only the chemical name is sent, with no personal or account information. |
| The summary, description and recent comments of a Jira issue you ask JESTOX to check | To find the chemicals mentioned in the task | Processed during your request only, and not saved by JESTOX |
| Text you approve for a comment or follow-up tasks | To post a safety-check comment or create incident follow-up tasks in Jira | Written to **your own Jira site**, as you, and only after you confirm |

JESTOX accesses Jira **as the user who is chatting** (`asUser`), so it can only read or change what that user is already allowed to.

## Logs

The Forge platform keeps short technical logs for troubleshooting (for example, which chemical was looked up and whether the lookup succeeded). These logs are held by Atlassian and visible only to the app developer. They don't include your name or account details.

## AI processing

Conversations with JESTOX run through **Atlassian Rovo**. Atlassian's own terms and privacy policy cover how Rovo processes chat content: https://www.atlassian.com/legal/privacy-policy

## Third parties

- **Atlassian** (Forge, Jira, Rovo): hosts and runs the app.
- **PubChem / U.S. National Library of Medicine:** receives chemical names only. See https://www.ncbi.nlm.nih.gov/home/about/policies/

JESTOX doesn't sell, share or use your data for advertising or any other purpose.

## Safety disclaimer

JESTOX provides information from public scientific sources to support, not replace, professional judgement. Always verify against the supplier's Safety Data Sheet (SDS) and your safety officer or site procedures.

## Contact

Questions about this policy or JESTOX: **sweetami04real@gmail.com**
