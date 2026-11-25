/**
 * incident.js — the create-incident-tasks action (incident mode).
 *
 * After a chemical incident (spill, splash, release), the agent gives the
 * immediate response in chat, then — only if the user agrees — calls this
 * action to create the follow-up work as Jira tasks:
 *   1. Clean up and decontaminate          (always)
 *   2. Report the incident to EHS          (always)
 *   3. Medical follow-up                   (only if a person was exposed)
 *   4. Investigate cause, prevent recurrence (always)
 *   5. Dispose of contaminated materials and restock (always)
 *
 * The task TITLES and STRUCTURE are fixed here in code (predictable, reviewable);
 * the agent only supplies the incident facts and the PubChem-based guidance
 * text that goes into each description.
 *
 * Security: api.asUser() — tasks are created as the chat user, only in projects
 * where that user can create issues. It's a CREATE action, so Rovo asks the
 * user to confirm first.
 */
import api, { route } from '@forge/api';
import { textToAdf } from './jira.js';

const PROJECT_KEY = /^[A-Z][A-Z0-9_]+$/;
const ISSUE_KEY = /^([A-Z][A-Z0-9_]+)-\d+$/;
const FOOTER =
  'Created by JESTOX from PubChem data and sourced safety rules. Verify against the supplier SDS and your site procedures.';

/** Short, single-line text for issue titles (Jira's limit is 255). */
function oneLine(text, max = 80) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Multi-line text for descriptions, with a fallback when the agent sent nothing. */
function block(text, fallback) {
  const t = String(text || '').trim();
  return t || fallback;
}

/**
 * Which project? The key the user named (if valid), else the project of the
 * issue/page they are viewing (from Rovo's trusted context).
 */
function resolveProjectKey(payload) {
  const typed = typeof payload?.projectKey === 'string' ? payload.projectKey.trim().toUpperCase() : '';
  if (PROJECT_KEY.test(typed)) return typed;
  const fromIssueKey = typed.match(ISSUE_KEY); // the agent may pass an issue key by mistake
  if (fromIssueKey) return fromIssueKey[1];
  const ctx = payload?.context?.jira;
  if (typeof ctx?.projectKey === 'string' && PROJECT_KEY.test(ctx.projectKey)) return ctx.projectKey;
  const ctxIssue = typeof ctx?.issueKey === 'string' ? ctx.issueKey.match(ISSUE_KEY) : null;
  return ctxIssue ? ctxIssue[1] : null;
}

/** Find a standard (non-sub-task) issue type in the project, preferring "Task". */
async function pickIssueType(projectKey) {
  const response = await api.asUser().requestJira(route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes`);
  if (!response.ok) return { error: response.status };
  const json = await response.json();
  const types = (json.issueTypes || json.values || []).filter((t) => !t.subtask);
  const task = types.find((t) => /^task$/i.test(t.name)) || types[0];
  return task ? { id: task.id, name: task.name } : { error: 'no-issue-type' };
}

/** Create one issue. Tries with a label first; some projects don't allow labels, so retry without. */
async function createIssue(projectKey, issueTypeId, summary, descriptionText) {
  const fields = {
    project: { key: projectKey },
    issuetype: { id: issueTypeId },
    summary: oneLine(summary, 250),
    description: textToAdf(`${descriptionText}\n${FOOTER}`),
  };
  const post = (body) =>
    api.asUser().requestJira(route`/rest/api/3/issue`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: body }),
    });

  let response = await post({ ...fields, labels: ['jestox-incident'] });
  if (response.status === 400) response = await post(fields); // labels field not available in this project
  if (!response.ok) return { ok: false, summary: fields.summary, status: response.status };
  const created = await response.json();
  return { ok: true, key: created.key, summary: fields.summary };
}

/** Action: create-incident-tasks */
export async function createIncidentTasks(payload) {
  const projectKey = resolveProjectKey(payload);
  if (!projectKey) {
    return {
      ok: false,
      message: 'No project known. Ask the user which Jira project (key, e.g. "LAB") the tasks should go in.',
    };
  }

  const chemical = oneLine(payload?.chemical || 'chemical', 60);
  const location = oneLine(payload?.location || 'location not given', 60);
  const summary = block(payload?.incidentSummary, 'No incident summary was provided.');
  const exposed = payload?.personExposed === true || /^(true|yes)$/i.test(String(payload?.personExposed || ''));
  const sourceIssue = payload?.context?.jira?.issueKey ? `Related issue: ${payload.context.jira.issueKey}` : '';

  const type = await pickIssueType(projectKey);
  if (type.error) {
    return {
      ok: false,
      projectKey,
      message: `Couldn't create tasks in project ${projectKey} (Jira said: ${type.error}). The project may not exist, or the user may not have permission to create issues there.`,
    };
  }

  // The follow-up tasks. Titles are fixed; descriptions combine the incident
  // facts with the PubChem-based guidance the agent passed in.
  const tasks = [
    {
      summary: `Clean up and decontaminate after ${chemical} incident – ${location}`,
      description: [
        `Incident: ${summary}`,
        sourceIssue,
        'PPE for clean-up:',
        block(payload?.ppe, '- Check the SDS section 8 for PPE.'),
        'Clean-up / spill response:',
        block(payload?.cleanupSteps, '- Follow the SDS section 6 (accidental release measures).'),
      ].filter(Boolean).join('\n'),
    },
    {
      summary: `Report ${chemical} incident to EHS / safety officer – ${location}`,
      description: [
        `Incident: ${summary}`,
        sourceIssue,
        'Include in the report:',
        '- Date, time and exact location',
        `- Chemical (${chemical}), concentration and approximate quantity`,
        '- People involved or exposed, and any first aid given',
        '- Immediate actions taken (evacuation, containment, clean-up)',
        '- Photos and the SDS used',
      ].filter(Boolean).join('\n'),
    },
    ...(exposed
      ? [
          {
            summary: `Medical follow-up for person exposed to ${chemical}`,
            description: [
              `Incident: ${summary}`,
              sourceIssue,
              'First aid guidance (from PubChem):',
              block(payload?.firstAid, '- See the SDS section 4 (first-aid measures).'),
              '- Make sure the exposed person has been assessed by a medical professional, and record the outcome.',
            ].filter(Boolean).join('\n'),
          },
        ]
      : []),
    {
      summary: `Investigate cause of ${chemical} incident and prevent recurrence`,
      description: [
        `Incident: ${summary}`,
        sourceIssue,
        '- Identify the root cause (storage, handling, labelling, training, equipment)',
        '- Check chemical storage and compatibility in the area (ask JESTOX to check the chemicals stored there)',
        '- Agree corrective actions, owners and dates',
      ].filter(Boolean).join('\n'),
    },
    {
      summary: `Dispose of contaminated materials and restock ${chemical} – ${location}`,
      description: [
        `Incident: ${summary}`,
        sourceIssue,
        'Disposal guidance (from PubChem):',
        block(payload?.disposal, '- Follow the SDS section 13 and local hazardous-waste rules.'),
        '- Restock only in compatible storage.',
      ].filter(Boolean).join('\n'),
    },
  ];

  // Create one at a time so a failure partway is reported clearly.
  const results = [];
  for (const task of tasks) {
    results.push(await createIssue(projectKey, type.id, task.summary, task.description));
  }
  const created = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  return {
    ok: created.length > 0,
    projectKey,
    issueType: type.name,
    created: created.map((r) => ({ key: r.key, summary: r.summary })),
    ...(failed.length ? { failed: failed.map((r) => ({ summary: r.summary, httpStatus: r.status })) } : {}),
    message:
      `${created.length} of ${tasks.length} follow-up tasks created in ${projectKey}` +
      (failed.length ? `; ${failed.length} failed (likely permissions or required fields).` : '.'),
  };
}
