/* eslint-disable */
// Run: node --test packages/core/src/drivers/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretCursorEvent, parseCursorModels, cursor } from './cursor.mjs';

test('interpretCursorEvent: init captures the session id', () => {
  assert.deepEqual(interpretCursorEvent({ type: 'system', subtype: 'init', session_id: 'abc' }), [
    { kind: 'session', id: 'abc' },
  ]);
  assert.deepEqual(interpretCursorEvent({ type: 'system', subtype: 'init' }), []);
});

test('interpretCursorEvent: consolidated assistant block (no timestamp) is complete, trimmed', () => {
  const actions = interpretCursorEvent({
    type: 'assistant',
    message: { content: [{ type: 'text', text: '  hi  ' }, { type: 'text', text: '   ' }] },
  });
  assert.deepEqual(actions, [{ kind: 'text', text: 'hi' }]);
});

test('interpretCursorEvent: partial deltas (timestamp_ms) are delta:true and untrimmed', () => {
  assert.deepEqual(
    interpretCursorEvent({ type: 'assistant', timestamp_ms: 123, message: { content: [{ type: 'text', text: ' there' }] } }),
    [{ kind: 'text', text: ' there', delta: true }],
  );
  // an empty delta yields nothing
  assert.deepEqual(
    interpretCursorEvent({ type: 'assistant', timestamp_ms: 123, message: { content: [{ type: 'text', text: '' }] } }),
    [],
  );
});

test('interpretCursorEvent: tool_call started → one tool action (completed ignored)', () => {
  const started = interpretCursorEvent({
    type: 'tool_call',
    subtype: 'started',
    tool_call: { readToolCall: { args: { path: '/a/b.vue' } } },
  });
  assert.deepEqual(started, [{ kind: 'tool', name: 'Read', file: '/a/b.vue', command: null }]);
  assert.deepEqual(
    interpretCursorEvent({
      type: 'tool_call',
      subtype: 'completed',
      tool_call: { readToolCall: { args: { path: '/a/b.vue' } } },
    }),
    [],
  );
});

test('interpretCursorEvent: shell tool_call carries the command', () => {
  assert.deepEqual(
    interpretCursorEvent({
      type: 'tool_call',
      subtype: 'started',
      tool_call: { shellToolCall: { args: { command: 'ls' } } },
    }),
    [{ kind: 'tool', name: 'Shell', file: null, command: 'ls' }],
  );
});

test('interpretCursorEvent: result success vs error', () => {
  assert.deepEqual(interpretCursorEvent({ type: 'result', subtype: 'success' }), [
    { kind: 'result', ok: true },
  ]);
  assert.deepEqual(interpretCursorEvent({ type: 'result', is_error: true, result: 'boom' }), [
    { kind: 'result', ok: false, errorText: 'boom' },
  ]);
});

test('interpretCursorEvent: unknown / malformed events yield no actions', () => {
  assert.deepEqual(interpretCursorEvent({ type: 'user' }), []);
  assert.deepEqual(interpretCursorEvent(null), []);
});

test('parseCursorModels: value - label lines, header skipped', () => {
  const out = 'Available models\n\nauto - Auto\ngpt-5.2 - GPT-5.2\ncomposer-2.5 - Composer 2.5 (current)\n';
  assert.deepEqual(parseCursorModels(out), [
    { value: 'auto', label: 'Auto' },
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'composer-2.5', label: 'Composer 2.5 (current)' },
  ]);
});

test('cursor.models is a function (resolved live by the Bridge)', () => {
  assert.equal(typeof cursor.models, 'function');
});

test('cursor.buildArgs: stream-json + force, resume/model appended when present', () => {
  const base = cursor.buildArgs({ markdown: 'do x', shots: [], resume: null, model: '' });
  assert.equal(base[0], '-p');
  assert.ok(base.includes('stream-json') && base.includes('--force'));
  assert.ok(!base.includes('--resume') && !base.includes('--model'));
  const full = cursor.buildArgs({ markdown: 'do x', shots: [], resume: 'sess1', model: 'auto' });
  assert.deepEqual(full.slice(-4), ['--model', 'auto', '--resume', 'sess1']);
});

test('cursor.buildArgs: discuss mode drops --force and uses the non-writing directive', () => {
  const disc = cursor.buildArgs({ markdown: 'do x', shots: [], resume: null, mode: 'discuss' });
  assert.ok(!disc.includes('--force'));
  assert.match(disc[1], /Do not edit any files/);
  // apply-once keeps the write posture
  assert.ok(cursor.buildArgs({ markdown: 'do x', shots: [], resume: null, mode: 'apply-once' }).includes('--force'));
});

test('cursor.buildArgs: screenshot paths are listed in the prompt', () => {
  const args = cursor.buildArgs({ markdown: 'do x', shots: [{ n: 1, file: '/tmp/a.png' }], resume: null });
  assert.match(args[1], /\/tmp\/a\.png/);
});
