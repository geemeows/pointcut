// @pointcut/core — skills-probe, the "which skills does this project expose" half of the Bridge.
//
// The toolbar's chat composer offers a "/" menu, but the client can't read the
// developer's disk. This endpoint answers "what can I invoke here?" by scanning
// the SAME locations the chosen agent CLI loads at this project root — so the
// menu mirrors what the agent would actually pick up at runtime:
//
//   claude → <cwd>/.claude/skills/<name>/SKILL.md  (project skills)
//            <cwd>/.claude/commands/<name>.md       (project slash-commands)
//            ~/.claude/skills/<name>/SKILL.md        (personal skills)
//   codex  → <cwd>/.agents/skills/<name>/SKILL.md   (project skills)
//            ~/.agents/skills/<name>/SKILL.md        (personal skills)
//
// Codex paths follow the official docs (developers.openai.com/codex/skills): it
// reads SKILL.md from `.agents/skills` (cwd up to repo root) and `~/.agents/skills`,
// same name+description frontmatter as Claude, and triggers implicitly by
// description — which is why it works under our headless `codex exec` runs. We
// scan the cwd level (the Bridge's project root); the full cwd→root walk is a
// later refinement. Codex custom prompts (~/.codex/prompts) are deliberately
// skipped: they're deprecated and only expand in interactive mode, not exec.
//
// Per-agent: the menu shown for `claude` differs from `codex`, because the two
// CLIs load different things. Each item is { name, description, kind, scope }.
// `kind` drives how the client turns a pick into prompt text (a skill becomes an
// instruction; a command/prompt is invoked literally by /name — see the client).
//
// Framework-free and bundler-free, like its sibling probes: a connect-style
// handler gated by the same `enabled` hard guard, with the result cached per
// agent for the dev session (skills on disk don't change mid-session).
import { promises as nodeFs } from 'node:fs';
import { homedir as nodeHomedir } from 'node:os';
import { join } from 'node:path';

const MAX_DESC = 200;

// Default fs surface — narrowed to the two ops we need, so tests can inject a
// fake without touching disk. readdir lists names; readFile returns UTF-8 text.
const defaultFs = {
  readdir: (dir) => nodeFs.readdir(dir),
  readFile: (file) => nodeFs.readFile(file, 'utf8'),
};

// Parse a markdown file's leading YAML-ish frontmatter. Returns { name, description }
// (either may be null). Handles plain scalars (`name: foo`), quoted values, and
// folded/literal block scalars (`description: >-` then indented lines) — the form
// the skill examples use. Deliberately tiny: we only need these two keys.
export const parseFrontmatter = (text) => {
  const out = { name: null, description: null };
  if (typeof text !== 'string') return out;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return out;
  let i = 1;
  for (; i < lines.length; i++) {
    if (lines[i].trim() === '---') break; // end of frontmatter
    const m = lines[i].match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    if (/^[>|][-+]?\s*$/.test(value)) {
      // Block scalar: gather the indented run that follows, fold into one line.
      const block = [];
      while (i + 1 < lines.length && (lines[i + 1].trim() === '' || /^\s+\S/.test(lines[i + 1]))) {
        i++;
        if (lines[i].trim() === '---') { i--; break; }
        block.push(lines[i].trim());
      }
      value = block.join(' ').trim();
    } else {
      value = value.replace(/^['"]|['"]$/g, '').trim();
    }
    if (key === 'name' || key === 'description') out[key] = value || null;
  }
  return out;
};

// First human-readable line of a file with no `description` frontmatter (the
// common case for slash-commands): skip frontmatter, blank lines, and headings.
const firstContentLine = (text) => {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  let i = 0;
  if (lines[0]?.trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '---') i++;
    i++; // past the closing ---
  }
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || l.startsWith('#')) continue;
    return l.length > MAX_DESC ? l.slice(0, MAX_DESC - 1) + '…' : l;
  }
  return null;
};

const clampDesc = (d) => (d && d.length > MAX_DESC ? d.slice(0, MAX_DESC - 1) + '…' : d);

// The scan recipe per agent: where to look and how each location is laid out.
//   layout 'dir'  → each subdirectory holds a SKILL.md
//   layout 'flat' → each *.md file is one item, named by its filename
const sourcesFor = (agent, cwd, home) =>
  agent === 'codex'
    ? [
        { dir: join(cwd, '.agents', 'skills'), kind: 'skill', scope: 'project', layout: 'dir' },
        { dir: join(home, '.agents', 'skills'), kind: 'skill', scope: 'personal', layout: 'dir' },
      ]
    : [
        { dir: join(cwd, '.claude', 'skills'), kind: 'skill', scope: 'project', layout: 'dir' },
        { dir: join(cwd, '.claude', 'commands'), kind: 'command', scope: 'project', layout: 'flat' },
        { dir: join(home, '.claude', 'skills'), kind: 'skill', scope: 'personal', layout: 'dir' },
      ];

const readText = async (fs, file) => {
  try {
    return await fs.readFile(file);
  } catch (_) {
    return null;
  }
};

// One item from a 'dir'-layout source (a skill folder with a SKILL.md inside).
const readSkillDir = async (fs, src, entry) => {
  const text = await readText(fs, join(src.dir, entry, 'SKILL.md'));
  if (text == null) return null; // no SKILL.md → not a skill folder
  const fm = parseFrontmatter(text);
  return { name: fm.name || entry, description: clampDesc(fm.description) || null, kind: src.kind, scope: src.scope };
};

// One item from a 'flat'-layout source (a single .md file = one command/prompt).
const readFlatFile = async (fs, src, file) => {
  if (!file.endsWith('.md')) return null;
  const text = await readText(fs, join(src.dir, file));
  if (text == null) return null;
  const fm = parseFrontmatter(text);
  const base = file.slice(0, -3);
  return {
    name: fm.name || base,
    description: clampDesc(fm.description) || firstContentLine(text),
    kind: src.kind,
    scope: src.scope,
  };
};

/**
 * Discover the invocable skills/commands for one agent at this project root.
 * Pure helper (injectable fs) so the scan/parse logic is unit-testable without
 * an HTTP round-trip. Missing directories are skipped, never an error. Dedups by
 * kind+name, keeping the first occurrence (project sources are listed first, so
 * a project skill wins over a same-named personal one).
 *
 * @param {object} [opts]
 * @param {string} [opts.agent]  Selected agent name ('claude' | 'codex'); defaults to 'claude'.
 * @param {string} [opts.cwd]    Project root.
 * @param {string} [opts.home]   Home dir (for personal skills/prompts).
 * @param {{readdir:(d:string)=>Promise<string[]>, readFile:(f:string)=>Promise<string>}} [opts.fs]
 * @returns {Promise<Array<{ name:string, description:string|null, kind:string, scope:string }>>}
 */
export async function resolveSkills({ agent = 'claude', cwd = process.cwd(), home = nodeHomedir(), fs = defaultFs } = {}) {
  const out = [];
  const seen = new Set();
  for (const src of sourcesFor(agent, cwd, home)) {
    let entries;
    try {
      entries = await fs.readdir(src.dir);
    } catch (_) {
      continue; // directory absent — nothing to offer from here
    }
    for (const entry of [...entries].sort()) {
      const item = src.layout === 'dir' ? await readSkillDir(fs, src, entry) : await readFlatFile(fs, src, entry);
      if (!item) continue;
      const key = item.kind + ':' + item.name;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/**
 * Build the skills-probe handler. Mirrors agent-probe: hard-guarded by `enabled`,
 * result cached per agent for the session, JSON `{ skills: [...] }` response.
 *
 * @param {object} opts
 * @param {boolean} opts.enabled  Hard guard: no-op unless design mode is active.
 * @param {string} [opts.cwd]     Project root the skills are scanned under.
 * @param {string} [opts.home]    Home dir (injectable for tests).
 * @param {string} [opts.prefix]  Endpoint prefix; defaults to '/__pointcut/skills'.
 * @param {object} [opts.fs]      fs surface (injectable for tests).
 * @returns {(req: any, res: any, next?: () => void) => void}
 */
export function createSkillsProbe({
  enabled = false,
  cwd = process.cwd(),
  home = nodeHomedir(),
  prefix = '/__pointcut/skills',
  fs = defaultFs,
} = {}) {
  if (!enabled) return (_req, _res, next) => next?.();

  // Cache per agent — claude and codex scan different locations.
  const cache = new Map();

  return (req, res, next) => {
    const [pathPart, query = ''] = (req.url || '').split('?');
    if (pathPart !== prefix) return next?.();
    const agent = new URLSearchParams(query).get('agent') || 'claude';
    const send = (list) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ skills: list }));
    };
    if (cache.has(agent)) return send(cache.get(agent));
    resolveSkills({ agent, cwd, home, fs })
      .then((list) => {
        cache.set(agent, list);
        send(list);
      })
      .catch((err) => {
        res.statusCode = 500;
        res.end(String((err && err.message) || err));
      });
  };
}
