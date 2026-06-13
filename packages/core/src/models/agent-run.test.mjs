/* eslint-disable */
// Run: node --test vite/design-toolbar/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBridgeLine, streamAgentRun } from './agent-run.mjs';

test('parseBridgeLine returns the envelope or null on noise', () => {
  assert.deepEqual(parseBridgeLine('{"t":"end","code":0}'), { t: 'end', code: 0 });
  assert.equal(parseBridgeLine('not json'), null);
});

// --- streamAgentRun: drive a fake NDJSON body and assert handler order -------
const ndjsonResponse = (lines) => ({
  ok: true,
  body: {
    getReader() {
      const chunks = lines.map((l) => new TextEncoder().encode(l));
      let i = 0;
      return {
        read() {
          if (i < chunks.length) return Promise.resolve({ done: false, value: chunks[i++] });
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  },
});

test('streamAgentRun pumps lines, splitting across chunk boundaries', async () => {
  const events = [];
  const handlers = {
    onAction: (a) => events.push(['action', a.kind]),
    onBridgeError: (m) => events.push(['bridgeError', m]),
    onBridgeEnd: () => events.push(['bridgeEnd']),
    onStreamEnd: () => events.push(['streamEnd']),
    onError: (m) => events.push(['error', m]),
  };
  // An action line split mid-way across two reads, then an end line.
  const fakeFetch = () =>
    Promise.resolve(
      ndjsonResponse([
        '{"t":"action","a":{"kind":"sessi',
        'on","id":"s1"}}\n{"t":"end","code":0}\n',
      ]),
    );
  await streamAgentRun({ agent: 'claude', markdown: 'x' }, handlers, fakeFetch);
  assert.deepEqual(events, [['action', 'session'], ['bridgeEnd'], ['streamEnd']]);
});

test('streamAgentRun reports a failed request via onError', async () => {
  const events = [];
  const handlers = {
    onAction: () => {},
    onBridgeError: () => {},
    onBridgeEnd: () => {},
    onStreamEnd: () => {},
    onError: (m) => events.push(m),
  };
  const fakeFetch = () => Promise.resolve({ ok: false, status: 500, body: null });
  await streamAgentRun({ agent: 'claude', markdown: 'x' }, handlers, fakeFetch);
  assert.deepEqual(events, ['request failed (500)']);
});
