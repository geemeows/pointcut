/* eslint-disable */
// Run: node --test packages/core/src/bridge/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, resolveSkills, createSkillsProbe } from './skills-probe.mjs';

// --- frontmatter parsing ----------------------------------------------------
test('parseFrontmatter reads name + plain description', () => {
  const fm = parseFrontmatter('---\nname: foo\ndescription: a short one\n---\nbody');
  assert.deepEqual(fm, { name: 'foo', description: 'a short one' });
});

test('parseFrontmatter folds a block-scalar description into one line', () => {
  const text = '---\nname: bar\ndescription: >-\n  first line\n  second line\n---\n# Heading';
  assert.deepEqual(parseFrontmatter(text), { name: 'bar', description: 'first line second line' });
});

test('parseFrontmatter returns nulls when there is no frontmatter', () => {
  assert.deepEqual(parseFrontmatter('# just a heading\ntext'), { name: null, description: null });
});

// --- a fake fs over an in-memory tree ---------------------------------------
// Keys are absolute-ish paths joined with '/'. Directories are listed by prefix.
const makeFs = (files) => ({
  readdir: async (dir) => {
    const prefix = dir.endsWith('/') ? dir : dir + '/';
    const names = new Set();
    let found = false;
    for (const path of Object.keys(files)) {
      if (path.startsWith(prefix)) {
        found = true;
        names.add(path.slice(prefix.length).split('/')[0]);
      }
    }
    if (!found) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return [...names];
  },
  readFile: async (file) => {
    if (!(file in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return files[file];
  },
});

test('resolveSkills discovers claude project skills, project commands, and personal skills', async () => {
  const fs = makeFs({
    '/proj/.claude/skills/pointcut-edits/SKILL.md': '---\nname: pointcut-edits\ndescription: edit handoff\n---\nbody',
    '/proj/.claude/skills/not-a-skill/README.md': 'no SKILL.md here',
    '/proj/.claude/commands/deploy.md': '---\ndescription: ship it\n---\nrun the deploy',
    '/proj/.claude/commands/raw.md': '# Raw\n\nDo the raw thing',
    '/home/.claude/skills/global-helper/SKILL.md': '---\nname: global-helper\ndescription: personal one\n---',
  });
  const skills = await resolveSkills({ agent: 'claude', cwd: '/proj', home: '/home', fs });
  assert.deepEqual(skills, [
    { name: 'pointcut-edits', description: 'edit handoff', kind: 'skill', scope: 'project' },
    { name: 'deploy', description: 'ship it', kind: 'command', scope: 'project' },
    { name: 'raw', description: 'Do the raw thing', kind: 'command', scope: 'project' }, // first content line
    { name: 'global-helper', description: 'personal one', kind: 'skill', scope: 'personal' },
  ]);
});

test('resolveSkills scans codex .agents/skills dirs (project + personal SKILL.md)', async () => {
  const fs = makeFs({
    '/proj/.agents/skills/scaffold/SKILL.md': '---\nname: scaffold\ndescription: scaffold a component\n---',
    '/home/.agents/skills/review/SKILL.md': '---\nname: review\ndescription: review a diff\n---',
    // Claude-only locations must NOT leak into the codex menu.
    '/proj/.claude/skills/claude-only/SKILL.md': '---\nname: claude-only\ndescription: nope\n---',
  });
  const skills = await resolveSkills({ agent: 'codex', cwd: '/proj', home: '/home', fs });
  assert.deepEqual(skills, [
    { name: 'scaffold', description: 'scaffold a component', kind: 'skill', scope: 'project' },
    { name: 'review', description: 'review a diff', kind: 'skill', scope: 'personal' },
  ]);
});

test('resolveSkills returns [] when nothing is installed', async () => {
  const skills = await resolveSkills({ agent: 'claude', cwd: '/empty', home: '/none', fs: makeFs({}) });
  assert.deepEqual(skills, []);
});

// --- endpoint: fake req/res + per-agent caching -----------------------------
const fakeRes = () => ({
  statusCode: 0,
  headers: {},
  body: '',
  setHeader(k, v) {
    this.headers[k] = v;
  },
  end(s) {
    if (s) this.body += s;
    this.ended = true;
  },
});

test('createSkillsProbe responds with skills and caches per agent', async () => {
  let reads = 0;
  const base = makeFs({
    '/proj/.claude/skills/a/SKILL.md': '---\nname: a\ndescription: alpha\n---',
  });
  const fs = { readdir: base.readdir, readFile: (f) => (reads++, base.readFile(f)) };
  const handler = createSkillsProbe({ enabled: true, cwd: '/proj', home: '/home', fs });

  const res1 = fakeRes();
  handler({ url: '/__pointcut/skills?agent=claude' }, res1);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(res1.statusCode, 200);
  assert.deepEqual(JSON.parse(res1.body).skills.map((s) => s.name), ['a']);
  const afterFirst = reads;

  const res2 = fakeRes();
  handler({ url: '/__pointcut/skills?agent=claude' }, res2);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(JSON.parse(res2.body).skills.map((s) => s.name), ['a']);
  assert.equal(reads, afterFirst, 'cached: disk not re-read for the same agent');
});

test('createSkillsProbe passes through non-matching urls to next()', () => {
  const handler = createSkillsProbe({ enabled: true, cwd: '/proj', home: '/home', fs: makeFs({}) });
  let nexted = false;
  handler({ url: '/__pointcut/agents' }, fakeRes(), () => {
    nexted = true;
  });
  assert.equal(nexted, true);
});

test('createSkillsProbe is a no-op passthrough when disabled', () => {
  const handler = createSkillsProbe({ enabled: false });
  let nexted = false;
  handler({ url: '/__pointcut/skills' }, fakeRes(), () => {
    nexted = true;
  });
  assert.equal(nexted, true);
});
