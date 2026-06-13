/* eslint-disable */
// Run: node --test packages/core/src/drivers/
// These interpret tests moved here from the client (the old claude-run.test.mjs)
// when Claude's interpreter became the claude Driver's parse().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretClaudeEvent, claude } from './claude.mjs';

test('interpretClaudeEvent: init captures the session id', () => {
  assert.deepEqual(interpretClaudeEvent({ type: 'system', subtype: 'init', session_id: 'abc' }), [
    { kind: 'session', id: 'abc' },
  ]);
  assert.deepEqual(interpretClaudeEvent({ type: 'system', subtype: 'init' }), []);
});

test('interpretClaudeEvent: assistant text + tool_use, in order', () => {
  const actions = interpretClaudeEvent({
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: '  hi  ' },
        { type: 'text', text: '   ' }, // blank → dropped
        { type: 'tool_use', name: 'Edit', input: { file_path: 'a/b.vue' } },
        { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
      ],
    },
  });
  assert.deepEqual(actions, [
    { kind: 'text', text: 'hi' },
    { kind: 'tool', name: 'Edit', file: 'a/b.vue', command: null },
    { kind: 'tool', name: 'Bash', file: null, command: 'ls' },
  ]);
});

test('interpretClaudeEvent: partial-message text deltas are marked delta:true', () => {
  assert.deepEqual(
    interpretClaudeEvent({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } }),
    [{ kind: 'text', text: 'hi', delta: true }],
  );
  // non-text deltas (e.g. input_json_delta) and other stream events are ignored
  assert.deepEqual(
    interpretClaudeEvent({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } } }),
    [],
  );
  assert.deepEqual(interpretClaudeEvent({ type: 'stream_event', event: { type: 'message_stop' } }), []);
});

test('interpretClaudeEvent: result success vs error', () => {
  assert.deepEqual(interpretClaudeEvent({ type: 'result', subtype: 'success' }), [
    { kind: 'result', ok: true },
  ]);
  assert.deepEqual(interpretClaudeEvent({ type: 'result', is_error: true, result: 'boom' }), [
    { kind: 'result', ok: false, errorText: 'boom' },
  ]);
});

test('interpretClaudeEvent: unknown / malformed events yield no actions', () => {
  assert.deepEqual(interpretClaudeEvent({ type: 'rate_limit_event' }), []);
  assert.deepEqual(interpretClaudeEvent(null), []);
});

test('claude.buildArgs: stream-json + acceptEdits, resume appended when present', () => {
  const base = claude.buildArgs({ markdown: 'do x', shots: [], resume: null });
  assert.equal(base[0], '-p');
  assert.ok(base.includes('stream-json') && base.includes('acceptEdits'));
  assert.ok(!base.includes('--resume'));
  const resumed = claude.buildArgs({ markdown: 'do x', shots: [], resume: 'sess1' });
  assert.deepEqual(resumed.slice(-2), ['--resume', 'sess1']);
});

test('claude.buildArgs: screenshot paths are listed in the prompt', () => {
  const args = claude.buildArgs({ markdown: 'do x', shots: [{ n: 1, file: '/tmp/a.png' }], resume: null });
  assert.match(args[1], /\/tmp\/a\.png/);
});

test('claude.buildArgs: mode picks the permission flag + directive', () => {
  // default / absent mode = apply → acceptEdits + edit directive
  const def = claude.buildArgs({ markdown: 'do x', shots: [], resume: null });
  assert.equal(def[def.indexOf('--permission-mode') + 1], 'acceptEdits');
  assert.match(def[1], /editing the source files/);
  // apply-once shares the apply (write) posture
  const once = claude.buildArgs({ markdown: 'do x', shots: [], resume: null, mode: 'apply-once' });
  assert.equal(once[once.indexOf('--permission-mode') + 1], 'acceptEdits');
  // discuss → plan + non-writing directive
  const disc = claude.buildArgs({ markdown: 'do x', shots: [], resume: null, mode: 'discuss' });
  assert.equal(disc[disc.indexOf('--permission-mode') + 1], 'plan');
  assert.match(disc[1], /Do not edit any files/);
});

test('claude.buildArgs: --model added only when a model is chosen', () => {
  assert.ok(!claude.buildArgs({ markdown: 'x', shots: [], resume: null, model: '' }).includes('--model'));
  const args = claude.buildArgs({ markdown: 'x', shots: [], resume: null, model: 'opus' });
  const i = args.indexOf('--model');
  assert.equal(args[i + 1], 'opus');
});
