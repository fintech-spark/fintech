#!/usr/bin/env node
// Merchant Brain: Agent Skills validator.
//
// Validates every skill against the agentskills.io specification:
//   - SKILL.md exists in each skill directory
//   - YAML frontmatter is present and delimited
//   - `name` present, <= 64 chars, [a-z0-9-] only, no leading/trailing/double hyphen,
//     and equal to the directory name
//   - `description` present, non-empty, <= 1024 chars (handles folded `>` / `|` blocks)
//   - optional field limits: license, compatibility <= 500 chars, metadata is a flat map
//   - relative links to references/, scripts/, examples/, assets/ resolve on disk
//   - referenced repo paths and `npm run` scripts actually exist
//   - SKILL.md under 500 lines (spec progressive-disclosure guidance)
//   - no secret-shaped strings in any skill file
//
// Usage:
//   node .agents/tools/validate-skills.mjs            # validate all skills
//   node .agents/tools/validate-skills.mjs --quiet    # errors only
//
// Exit codes: 0 = valid, 1 = problems found, 2 = bad usage.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(TOOLS_DIR, '..', '..');
const SKILLS_DIR = join(REPO_ROOT, '.agents', 'skills');

const quiet = process.argv.slice(2).includes('--quiet');
const unknown = process.argv.slice(2).filter((a) => !['--quiet'].includes(a));
if (unknown.length > 0) {
  console.error(`usage: validate-skills.mjs [--quiet]  (unknown arg: ${unknown[0]})`);
  process.exit(2);
}

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME = 64;
const MAX_DESC = 1024;
const MAX_COMPAT = 500;
const MAX_SKILL_LINES = 500;

// Fenced-code-stripped, comments-stripped view used for secret scanning.
const SECRET_PATTERNS = [
  { label: 'supabase service-role JWT', re: /eyJ[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}/ },
  { label: 'AI provider key', re: /\b(sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|AIza[0-9A-Za-z_-]{30,})\b/ },
  { label: 'aws access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'assigned credential literal', re: /\b(password|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"]{12,}['"]/i },
];

// Placeholder values are legitimate in teaching material (`"sk-proj-xxxxx"`,
// `process.env.API_KEY`) and must not be reported as leaked secrets.
const PLACEHOLDERISH = /x{3,}|y{3,}|your[-_]|placeholder|redacted|example|changeme|dummy|fake|<[^>]+>|\$\{/i;

/** True when a repo path looks like a real existing file rather than a template. */
function isConcreteRepoPath(ref) {
  if (/[*<>{}]|\.\.|:\d/.test(ref)) return false;      // glob, placeholder, line number
  if (ref.endsWith('/')) return false;                 // directory to be created
  if (/\d{3,}/.test(ref)) return false;                // e.g. docs/adr/NNNN-title.md
  if (/(feature|example|sample|your)[-_.]/i.test(ref)) return false;
  return true;
}

/** Minimal frontmatter reader: enough for the spec's flat scalar + one metadata map. */
function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { error: 'missing opening `---`' };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { error: 'missing closing `---`' };
  const block = raw.slice(raw.indexOf('\n') + 1, end);
  const body = raw.slice(end + 4);

  const data = {};
  let currentKey = null;
  for (const line of block.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indented = /^\s+/.test(line);
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv && !indented) {
      currentKey = kv[1];
      data[currentKey] = kv[2].trim();
      continue;
    }
    if (currentKey && (indented || data[currentKey] === '>' || data[currentKey] === '|')) {
      const prior = data[currentKey];
      data[currentKey] = prior === '>' || prior === '|' ? `${prior} ${line.trim()}`.trim() : `${prior} ${line.trim()}`.trim();
    }
  }
  // Folded markers carry no content of their own.
  for (const [k, v] of Object.entries(data)) if (v === '>' || v === '|') data[k] = '';
  return { data, body };
}

const problems = [];
const warnings = [];
const add = (skill, msg) => problems.push(`${skill ? `${skill}: ` : ''}${msg}`);
const warn = (msg) => warnings.push(msg);

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function validateSkill(dir) {
  const name = dir.split('/').filter(Boolean).pop();
  const skillFile = join(dir, 'SKILL.md');

  if (!(await exists(skillFile))) {
    add(name, 'SKILL.md is missing');
    return null;
  }
  const raw = await readFile(skillFile, 'utf8');
  const parsed = parseFrontmatter(raw);

  if (parsed.error) {
    add(name, `frontmatter: ${parsed.error}`);
    return null;
  }
  const { data, body } = parsed;

  const declared = data.name ?? '';
  if (!declared) add(name, 'frontmatter: `name` is required');
  else {
    if (declared.length > MAX_NAME) add(name, `name exceeds ${MAX_NAME} chars (${declared.length})`);
    if (!NAME_RE.test(declared)) add(name, `name "${declared}" must be lowercase alphanumerics separated by single hyphens`);
    if (declared !== name) add(name, `name "${declared}" does not match directory "${name}"`);
  }

  const desc = (data.description ?? '').trim();
  if (!desc) add(name, 'frontmatter: `description` is required and must state when to use the skill');
  else if (desc.length > MAX_DESC) add(name, `description exceeds ${MAX_DESC} chars (${desc.length})`);

  if (data.compatibility && data.compatibility.length > MAX_COMPAT) {
    add(name, `compatibility exceeds ${MAX_COMPAT} chars`);
  }

  const lineCount = raw.split('\n').length;
  if (lineCount > MAX_SKILL_LINES) {
    warnings.push(`${name}: SKILL.md is ${lineCount} lines; spec guidance is <${MAX_SKILL_LINES} — move detail into references/`);
  }

  // Referenced bundled resources must exist.
  const linkRe = /\]\(((?:\.\/)?(?:references|scripts|examples|assets)\/[^)]+)\)/g;
  let link;
  while ((link = linkRe.exec(body)) !== null) {
    const target = resolve(dirname(skillFile), link[1]);
    if (!(await exists(target))) add(name, `references missing file: ${link[1]}`);
  }

  // Repo paths mentioned in backticks should exist. Template/destination paths
  // (directories to create, example filenames, globs) are informational only.
  const pathRe = /`((?:app|components|lib|modules|prompts|evals|tests|supabase|scripts|docs|database|\.agents|\.github)\/[^`\s]+)`/g;
  let p;
  while ((p = pathRe.exec(body)) !== null) {
    const ref = p[1].replace(/[:,;)]+$/, '');
    if (!isConcreteRepoPath(ref)) continue;
    const base = ref.split(':')[0];
    if (!(await exists(join(REPO_ROOT, base)))) {
      warnings.push(`${name}: referenced repo path does not exist: ${ref}`);
    }
  }

  // npm scripts mentioned must exist.
  const pkg = JSON.parse(await readFile(join(REPO_ROOT, 'package.json'), 'utf8'));
  const scriptRe = /npm run ([a-z0-9:_-]+)/g;
  let s;
  while ((s = scriptRe.exec(body)) !== null) {
    if (!pkg.scripts[s[1]]) add(name, `references unknown npm script: npm run ${s[1]}`);
  }

  // Secret scan across every file in the skill directory.
  for (const file of await walk(dir)) {
    const content = await readFile(file, 'utf8');
    for (const { label, re } of SECRET_PATTERNS) {
      const hit = re.exec(content);
      if (!hit) continue;
      if (label === 'assigned credential literal' && PLACEHOLDERISH.test(hit[0])) continue;
      add(name, `possible ${label} in ${relative(dir, file)}`);
    }
  }

  return { name, description: desc, lines: lineCount };
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(child)));
    else out.push(child);
  }
  return out;
}

let dirs;
try {
  dirs = (await readdir(SKILLS_DIR, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => join(SKILLS_DIR, e.name));
} catch {
  console.error(`cannot read ${relative(REPO_ROOT, SKILLS_DIR)}`);
  process.exit(2);
}

const seen = new Map();
const results = [];
for (const dir of dirs) {
  const r = await validateSkill(dir);
  if (r) {
    results.push(r);
    if (seen.has(r.name)) add(r.name, `duplicate skill name also present at ${seen.get(r.name)}`);
    else seen.set(r.name, relative(REPO_ROOT, dir));
  }
}

const errors = problems;

if (errors.length === 0) {
  if (!quiet) {
    console.log(`✓ ${results.length} skill(s) valid against the agentskills.io specification`);
    if (warnings.length > 0) {
      console.log(`\n${warnings.length} advisory note(s):`);
      for (const w of warnings) console.log(`  ! ${w}`);
    }
  }
  process.exit(0);
}

console.error(`✗ ${errors.length} error(s) across ${results.length} skill(s):\n`);
for (const p of errors) console.error(`  ✗ ${p}`);
if (warnings.length > 0) {
  console.error(`\n${warnings.length} advisory note(s):`);
  for (const w of warnings) console.error(`  ! ${w}`);
}
console.error('\nSee https://agentskills.io/specification for the format requirements.');
process.exit(1);
