/* eslint-disable */
// Run: node --test packages/core/src/bridge/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from './bridge.mjs';

test('createBridge disabled → no-op passthrough to next()', () => {
  const handler = createBridge({ enabled: false });
  let nexted = false;
  handler({ url: '/__pointcut/agents' }, {}, () => {
    nexted = true;
  });
  assert.equal(nexted, true);
});

test('createBridge disabled never inspects req/res (pure passthrough)', () => {
  const handler = createBridge({ enabled: false });
  // A req/res with throwing accessors proves the disabled path touches neither.
  const trap = new Proxy(
    {},
    {
      get() {
        throw new Error('disabled Bridge must not read req/res');
      },
    },
  );
  let called = false;
  handler(trap, trap, () => {
    called = true;
  });
  assert.equal(called, true);
});

test('createBridge enabled returns a handler that routes unknown urls to next()', () => {
  const handler = createBridge({ enabled: true });
  let nexted = false;
  handler({ url: '/not-pointcut', method: 'GET' }, { setHeader() {}, end() {} }, () => {
    nexted = true;
  });
  assert.equal(nexted, true); // fell through editor-launch + probe + run
});
