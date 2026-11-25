/**
 * jira.js — the two Jira actions:
 *   read-jira-issue     (GET)    read an issue's text so the agent can find the chemicals in it
 *   add-safety-comment  (CREATE) post the safety check back to the issue as a comment
 *
 * Security:
 *   - Every request uses api.asUser(): it runs with the CHAT USER's own Jira
 *     permissions, so the agent can only read or comment on issues that person
 *     could read or comment on themselves.
 *   - The issue key typed into the chat is LLM-extracted (untrusted), so we
 *     validate its format. If it's missing or invalid, we fall back to the
 *     issue the user is currently viewing, which Rovo passes in payload.context.
 *   - add-safety-comment is a CREATE action, so Rovo asks the user to confirm
 *     before it runs.
 */
import api, { route } from '@forge/api';

const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
const MAX_TEXT = 4000; // characters of issue text returned to the agent
const MAX_COMMENTS = 5; // most recent comments to include
const MAX_COMMENT_LENGTH = 8000;

/**
 * Pick the issue key: the one the user named (if it looks valid), else the
 * issue currently open in Jira (from Rovo's context), else null.
 */
function resolveIssueKey(payload) {
  const typed = typeof payload?.issueKey === 'string' ? payload.issueKey.trim().toUpperCase() : '';
  if (ISSUE_KEY.test(typed)) return typed;
  const fromContext = payload?.context?.jira?.issueKey;
  if (typeof fromContext === 'string' && ISSUE_KEY.test(fromContext)) return fromContext;
  return null;
}

/**
 * Jira stores rich text (descriptions, comments) as Atlassian Document Format
 * (ADF): a tree of nodes. Flatten it to plain text, one line per block.
 */
function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  const inner = (node.content || []).map(adfToText).join('');
  const blockTypes = ['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote', 'tableRow'];
  return blockTypes.includes(node.type) ? `${inner}\n` : inner;
}

function tidy(text, max) {
  const t = String(text || '').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Action: read-jira-issue */
export async function readJiraIssue(payload) {
  const issueKey = resolveIssueKey(payload);
  if (!issueKey) {
    return {
      found: false,
      message:
        'No issue key was given and the user is not viewing a Jira issue. Ask the user for the issue key (e.g. LAB-12).',
    };
  }

  const response = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,description,comment,status,issuetype`);

  if (response.status === 404 || response.status === 403) {
    return {
      found: false,
      issueKey,
      message: `Issue ${issueKey} doesn't exist or the user doesn't have permission to view it.`,
    };
  }
  if (!response.ok) {
    return { found: false, issueKey, error: true, message: `Jira returned HTTP ${response.status}. Ask the user to try again.` };
  }

  const issue = await response.json();
  const fields = issue.fields || {};
  const comments = (fields.comment?.comments || [])
    .slice(-MAX_COMMENTS)
    .map((c) => ({ author: c.author?.displayName || 'unknown', text: tidy(adfToText(c.body), 800) }))
    .filter((c) => c.text);

  return {
    found: true,
    issueKey,
    summary: fields.summary || '',
    issueType: fields.issuetype?.name || null,
    status: fields.status?.name || null,
    description: tidy(adfToText(fields.description), MAX_TEXT),
    recentComments: comments,
    note:
      'Find every chemical, chemical product or household product named in the summary, description and comments. ' +
      'List what you found and how you interpreted it (e.g. "bleach → sodium hypochlorite"). Then call check-compatibility ' +
      'with all of them (2 to 6), or lookup-chemical if there is only one. If none are found, say so.',
  };
}

/**
 * The agent sometimes writes markdown (backticks around URLs, **bold**) even
 * when asked for plain text. Jira comments don't render markdown, so strip it.
 */
function stripMarkdown(text) {
  return String(text)
    .replace(/`+/g, '') // code marks / fences
    .replace(/\*\*(.+?)\*\*/g, '$1') // **bold**
    .replace(/__(.+?)__/g, '$1') // __bold__
    .replace(/^\s*-\s*\n/gm, ''); // bullet markers left alone on a line
}

/**
 * Split a line into ADF text nodes, turning every URL into a clickable link.
 * e.g. "Source: https://x.org/a" → [text "Source: ", link "https://x.org/a"]
 */
function inlineNodes(line) {
  const nodes = [];
  let last = 0;
  for (const match of line.matchAll(/https?:\/\/[^\s)<>\]]+/g)) {
    const url = match[0].replace(/[.,;:]+$/, ''); // don't swallow trailing punctuation
    if (match.index > last) nodes.push({ type: 'text', text: line.slice(last, match.index) });
    nodes.push({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] });
    last = match.index + url.length;
  }
  if (last < line.length) nodes.push({ type: 'text', text: line.slice(last) });
  return nodes;
}

/**
 * Turn the agent's plain-text comment into ADF: one paragraph per line,
 * lines starting with "- ", "• " or "* " become a bullet list, URLs become links.
 */
export function textToAdf(text) {
  const content = [];
  let bullets = null;
  for (const raw of stripMarkdown(text).split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-•*])\s+(.*)$/);
    if (bullet) {
      bullets = bullets || { type: 'bulletList', content: [] };
      if (!bullet[1].trim()) continue; // empty bullet
      bullets.content.push({ type: 'listItem', content: [{ type: 'paragraph', content: inlineNodes(bullet[1]) }] });
      continue;
    }
    if (bullets) {
      content.push(bullets);
      bullets = null;
    }
    if (line.trim()) content.push({ type: 'paragraph', content: inlineNodes(line) });
  }
  if (bullets) content.push(bullets);
  return { type: 'doc', version: 1, content };
}

/** Action: add-safety-comment */
export async function addSafetyComment(payload) {
  const issueKey = resolveIssueKey(payload);
  const comment = typeof payload?.comment === 'string' ? payload.comment.trim() : '';
  if (!issueKey) return { ok: false, message: 'No valid issue key. Ask the user which issue to comment on.' };
  if (!comment) return { ok: false, message: 'The comment text was empty. Nothing was posted.' };

  const header = '🧪 Chemical safety check by JESTOX';
  const footer =
    'Generated from PubChem data and sourced compatibility rules. Verify against the supplier SDS and your safety officer before acting.';
  const fullText = `${header}\n${comment.slice(0, MAX_COMMENT_LENGTH)}\n${footer}`;

  const response = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: textToAdf(fullText) }),
  });

  if (!response.ok) {
    return {
      ok: false,
      issueKey,
      message: `Jira returned HTTP ${response.status}: the comment was NOT posted (the user may lack permission to comment on ${issueKey}).`,
    };
  }
  const created = await response.json();
  return { ok: true, issueKey, commentId: created.id, message: `Safety check posted as a comment on ${issueKey}.` };
}
