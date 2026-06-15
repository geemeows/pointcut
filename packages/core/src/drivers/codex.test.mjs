/* eslint-disable */
// Run: node --test packages/core/src/drivers/
// NOTE: these assert the best-effort schema in codex.mjs (see its TODO(verify)).
// If a real `codex exec --json` run shows different event/field names, update
// codex.mjs AND these expectations together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretCodexEvent, codex } from './codex.mjs';

test('interpretCodexEvent: thread.started captures the session id', () => {
  assert.deepEqual(interpretCodexEvent({ type: 'thread.started', thread_id: 't1' }), [
    { kind: 'session', id: 't1' },
  ]);
  assert.deepEqual(interpretCodexEvent({ type: 'thread.started' }), []);
});

test('interpretCodexEvent: completed items → text / tool', () => {
  assert.deepEqual(
    interpretCodexEvent({ type: 'item.completed', item: { type: 'assistant_message', text: '  hi  ' } }),
    [{ kind: 'text', text: 'hi' }],
  );
  assert.deepEqual(
    interpretCodexEvent({ type: 'item.completed', item: { type: 'command_execution', command: 'ls' } }),
    [{ kind: 'tool', name: 'Bash', file: null, command: 'ls' }],
  );
  assert.deepEqual(
    interpretCodexEvent({ type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'a/b.vue' }] } }),
    [{ kind: 'tool', name: 'Edit', file: 'a/b.vue', command: null }],
  );
});

test('interpretCodexEvent: turn end success vs failure', () => {
  assert.deepEqual(interpretCodexEvent({ type: 'turn.completed' }), [{ kind: 'result', ok: true }]);
  assert.deepEqual(interpretCodexEvent({ type: 'turn.failed', error: { message: 'boom' } }), [
    { kind: 'result', ok: false, errorText: 'boom' },
  ]);
});

test('interpretCodexEvent: unknown / malformed events yield no actions', () => {
  assert.deepEqual(interpretCodexEvent({ type: 'token_count' }), []);
  assert.deepEqual(interpretCodexEvent(null), []);
});

test('codex.buildArgs: exec --json + sandbox, resume first, then the prompt', () => {
  const args = codex.buildArgs({ markdown: 'do x', resume: 't1' });
  assert.deepEqual(args.slice(0, 3), ['exec', 'resume', 't1']);
  assert.ok(args.includes('--json') && args.includes('--sandbox') && args.includes('workspace-write'));
  assert.ok(args.some((a) => /do x/.test(a)), 'prompt is passed');
});

test('codex.buildArgs: mode picks the sandbox flag + directive', () => {
  // default / absent mode = apply → workspace-write + edit directive
  const def = codex.buildArgs({ markdown: 'do x', resume: null });
  assert.equal(def[def.indexOf('--sandbox') + 1], 'workspace-write');
  assert.ok(def.some((a) => /editing the source files/.test(a)));
  // apply-once shares the apply (write) posture
  const once = codex.buildArgs({ markdown: 'do x', resume: null, mode: 'apply-once' });
  assert.equal(once[once.indexOf('--sandbox') + 1], 'workspace-write');
  // discuss → read-only + non-writing directive
  const disc = codex.buildArgs({ markdown: 'do x', resume: null, mode: 'discuss' });
  assert.equal(disc[disc.indexOf('--sandbox') + 1], 'read-only');
  assert.ok(disc.some((a) => /Do not edit any files/.test(a)));
});

test('codex.buildArgs: -m added only when a model is chosen', () => {
  assert.ok(!codex.buildArgs({ markdown: 'x', resume: null, model: '' }).includes('-m'));
  const args = codex.buildArgs({ markdown: 'x', resume: null, model: 'gpt-5-codex' });
  const i = args.indexOf('-m');
  assert.equal(args[i + 1], 'gpt-5-codex');
});
