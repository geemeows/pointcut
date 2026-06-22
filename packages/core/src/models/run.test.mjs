/* eslint-disable */
// Run: node --import tsx --test src/models/run.test.mjs
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentRun } from './run.mjs';

// A fake transport in the shape of streamAgentRun(request, handlers, fetchImpl):
// feeds scripted Actions, then ends. `end` = 'bridge' | 'stream' | 'error:<msg>'.
const fakeTransport = (script) => (request, h, _fetchImpl) => {
  for (const a of script.actions || []) h.onAction(a);
  for (const m of script.bridgeErrors || []) h.onBridgeError(m);
  const end = script.end || 'bridge';
  if (end === 'bridge') h.onBridgeEnd();
  else if (end === 'stream') h.onStreamEnd();
  else if (end.startsWith('error:')) h.onError(end.slice(6));
};

// Build an orchestrator with recording callbacks; returns { run, events }.
const harness = (overrides = {}) => {
  const events = [];
  const log = (...a) => events.push(a);
  let nodeSeq = 0;
  const deps = {
    transport: overrides.transport,
    fetchImpl: 'FETCH',
    request: (payload) => ({ agent: 'claude', ...payload }),
    markThinking: (ids) => log('markThinking', [...ids]),
    stopThinking: (errored) => log('stopThinking', errored),
    now: () => 1000,
    onProseOpen: () => { nodeSeq += 1; const node = 'node' + nodeSeq; log('proseOpen', node); return node; },
    onProse: (node, buf) => log('prose', node, buf),
    onProseFull: (node, text) => log('proseFull', node, text),
  };
  const run = createAgentRun(deps);
  return { run, events, deps };
};

describe('createAgentRun lifecycle', () => {
  test('flags flip running during a run and clear at finish', () => {
    let seenRunning = null;
    let runRef = null;
    const { run } = harness({
      transport: (req, h) => { seenRunning = runRef.isRunning(); h.onBridgeEnd(); },
    });
    runRef = run;
    run.run({ payload: { markdown: 'hi', resume: null }, onAction: () => {} });
    assert.equal(seenRunning, true, 'running was true mid-stream');
    assert.equal(run.isRunning(), false, 'running cleared on finish');
    assert.equal(run.isErrored(), false);
  });

  test('startAt is set from injected clock', () => {
    const { run } = harness({ transport: (r, h) => h.onBridgeEnd() });
    run.run({ payload: { markdown: 'x', resume: null }, onAction: () => {} });
    assert.equal(run.startedAt(), 1000);
  });

  test('callbacks fire in order: markThinking(arm) → stop → markThinking([]) → afterFinish', () => {
    const { run, events } = harness({ transport: fakeTransport({ actions: [], end: 'bridge' }) });
    run.run({
      payload: { markdown: 'x', resume: null },
      workingIds: ['c1', 'c2'],
      onAction: () => {},
      afterFinish: (errored) => events.push(['afterFinish', errored]),
    });
    assert.deepEqual(events, [
      ['markThinking', ['c1', 'c2']],
      ['stopThinking', false],
      ['markThinking', []],
      ['afterFinish', false],
    ]);
  });

  test('beforeFinish runs before stopThinking and while prose buffer is readable', () => {
    const order = [];
    const { run } = harness({
      transport: (req, h) => {
        h.onAction({ kind: 'text', text: 'hello ', delta: true });
        h.onAction({ kind: 'text', text: 'world', delta: true });
        h.onBridgeEnd();
      },
    });
    run.run({
      payload: { markdown: 'x', resume: null },
      onAction: (a) => { if (a.kind === 'text') run.streamText(a.text, a.delta); },
      beforeFinish: (reason) => order.push(['beforeFinish', reason, run.openBuf()]),
      afterFinish: () => order.push(['afterFinish']),
    });
    // trailing prose buffer is still readable in beforeFinish, cleared after
    assert.deepEqual(order, [['beforeFinish', null, 'hello world'], ['afterFinish']]);
    assert.equal(run.openText(), null, 'prose line closed after finish');
    assert.equal(run.openBuf(), '');
  });
});

describe('prose streaming', () => {
  test('delta chunks accumulate into one line; full block finalizes and closes', () => {
    const { run, events } = harness({ transport: (r, h) => h.onBridgeEnd() });
    run.run({ payload: { markdown: 'x', resume: null }, onAction: () => {} });
    // (run already finished — exercise the prose helpers directly as a render fn would)
    run.streamText('foo ', true);
    run.streamText('bar', true);
    run.streamText('FULL', false);
    assert.deepEqual(events.filter((e) => e[0].startsWith('prose')), [
      ['proseOpen', 'node1'],
      ['prose', 'node1', 'foo '],
      ['prose', 'node1', 'foo bar'],
      ['proseFull', 'node1', 'FULL'],
    ]);
    assert.equal(run.openText(), null, 'full block closes the line');
  });
});

describe('annotation resolution on end', () => {
  test('resolves on clean end (success)', () => {
    const { run, events } = harness({ transport: fakeTransport({ end: 'stream' }) });
    run.run({
      payload: { markdown: 'x', resume: 's1', mode: 'apply-once' },
      resolveAnnotations: ['a1', 'a2'],
      onAction: () => {},
      onResolved: (ids) => events.push(['resolved', ids]),
    });
    assert.deepEqual(events.filter((e) => e[0] === 'resolved'), [['resolved', ['a1', 'a2']]]);
    assert.deepEqual(run.pendingResolveIds(), [], 'pending cleared after resolve');
  });

  test('does NOT resolve when a bridge error errored the run', () => {
    const { run, events } = harness({
      transport: fakeTransport({ bridgeErrors: ['boom'], end: 'bridge' }),
    });
    run.run({
      payload: { markdown: 'x', resume: 's1' },
      resolveAnnotations: ['a1'],
      onAction: () => {},
      onBridgeError: (m) => events.push(['bridgeError', m]),
      onResolved: (ids) => events.push(['resolved', ids]),
    });
    assert.equal(run.isErrored(), true);
    assert.deepEqual(events.filter((e) => e[0] === 'resolved'), [], 'no resolve on error');
    assert.deepEqual(events.filter((e) => e[0] === 'bridgeError'), [['bridgeError', 'boom']]);
  });

  test('does NOT resolve when the request itself failed (onError)', () => {
    const { run, events } = harness({ transport: fakeTransport({ end: 'error:request failed (500)' }) });
    run.run({
      payload: { markdown: 'x', resume: 's1' },
      resolveAnnotations: ['a1'],
      onAction: () => {},
      beforeFinish: (reason) => events.push(['beforeFinish', reason]),
      onResolved: (ids) => events.push(['resolved', ids]),
    });
    assert.equal(run.isErrored(), true);
    assert.deepEqual(events.filter((e) => e[0] === 'resolved'), []);
    assert.deepEqual(events.filter((e) => e[0] === 'beforeFinish'), [['beforeFinish', 'request failed (500)']]);
  });
});

describe('error handling', () => {
  test('onError sets errored, passes reason to beforeFinish, stopThinking(true)', () => {
    const { run, events } = harness({ transport: fakeTransport({ end: 'error:nope' }) });
    run.run({
      payload: { markdown: 'x', resume: null },
      onAction: () => {},
      beforeFinish: (reason) => events.push(['beforeFinish', reason]),
    });
    assert.equal(run.isErrored(), true);
    assert.deepEqual(events.filter((e) => e[0] === 'stopThinking'), [['stopThinking', true]]);
    assert.deepEqual(events.filter((e) => e[0] === 'beforeFinish'), [['beforeFinish', 'nope']]);
  });

  test('markErrored() from a render fn flips errored before finish', () => {
    const { run, events } = harness({
      transport: (req, h) => {
        h.onAction({ kind: 'result', ok: false });
        h.onBridgeEnd();
      },
    });
    run.run({
      payload: { markdown: 'x', resume: null },
      onAction: (a) => { if (a.kind === 'result' && !a.ok) run.markErrored(); },
    });
    assert.equal(run.isErrored(), true);
    assert.deepEqual(events.filter((e) => e[0] === 'stopThinking'), [['stopThinking', true]]);
  });

  test('a stale terminal callback after finish is a no-op (guard on running)', () => {
    let handlers = null;
    const { run, events } = harness({ transport: (req, h) => { handlers = h; h.onBridgeEnd(); } });
    run.run({
      payload: { markdown: 'x', resume: null },
      onAction: () => {},
      afterFinish: () => events.push(['afterFinish']),
    });
    handlers.onStreamEnd(); // late duplicate
    handlers.onError('late'); // late duplicate
    assert.deepEqual(events.filter((e) => e[0] === 'afterFinish'), [['afterFinish']], 'finished exactly once');
  });
});

describe('request wiring', () => {
  test('payload is threaded through deps.request to the transport', () => {
    let seen = null;
    const { run } = harness({ transport: (req, h) => { seen = req; h.onBridgeEnd(); } });
    run.run({ payload: { markdown: 'MD', resume: 'sess', mode: 'apply' }, onAction: () => {} });
    assert.deepEqual(seen, { agent: 'claude', markdown: 'MD', resume: 'sess', mode: 'apply' });
  });
});
