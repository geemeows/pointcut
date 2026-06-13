/* eslint-disable */
// Run: node --test packages/core/src/bridge/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgents, createAgentProbe } from './agent-probe.mjs';

// A fake Driver set: two with static models, one with async (live-discovered) models.
const fakeDrivers = {
  alpha: { command: 'alpha-cli', models: [{ label: 'A1', value: 'a1' }] },
  beta: { command: 'beta-cli', models: () => Promise.resolve([{ label: 'B1', value: 'b1' }]) },
  gamma: { command: 'gamma-cli', models: [{ label: 'G1', value: 'g1' }] },
};

// Only alpha + beta are "installed"; gamma is absent from PATH.
const onPath = (cmd) => Promise.resolve(cmd === 'alpha-cli' || cmd === 'beta-cli');

test('resolveAgents returns only installed Drivers, with resolved models', async () => {
  const agents = await resolveAgents({ drivers: fakeDrivers, onPath });
  assert.deepEqual(agents, [
    { name: 'alpha', models: [{ label: 'A1', value: 'a1' }] },
    { name: 'beta', models: [{ label: 'B1', value: 'b1' }] }, // async models awaited
  ]);
});

test('resolveAgents honors the allow-list (intersected with PATH)', async () => {
  const agents = await resolveAgents({ agents: ['beta', 'gamma'], drivers: fakeDrivers, onPath });
  assert.deepEqual(agents.map((a) => a.name), ['beta']); // gamma not on PATH
});

// --- endpoint: fake req/res + caching ---------------------------------------
const fakeRes = () => {
  const res = {
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
  };
  return res;
};

test('createAgentProbe responds with installed agents and caches the resolution', async () => {
  let calls = 0;
  const countingPath = (cmd) => {
    calls++;
    return onPath(cmd);
  };
  const handler = createAgentProbe({ enabled: true, drivers: fakeDrivers, onPath: countingPath });
  const res1 = fakeRes();
  handler({ url: '/__pointcut/agents' }, res1);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(res1.statusCode, 200);
  assert.deepEqual(JSON.parse(res1.body).agents.map((a) => a.name), ['alpha', 'beta']);
  const afterFirst = calls;

  // Second hit serves the cache — no further PATH probing.
  const res2 = fakeRes();
  handler({ url: '/__pointcut/agents' }, res2);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(JSON.parse(res2.body).agents.map((a) => a.name), ['alpha', 'beta']);
  assert.equal(calls, afterFirst, 'cached: PATH not re-probed');
});

test('createAgentProbe passes through non-matching urls to next()', () => {
  const handler = createAgentProbe({ enabled: true, drivers: fakeDrivers, onPath });
  let nexted = false;
  handler({ url: '/something-else' }, fakeRes(), () => {
    nexted = true;
  });
  assert.equal(nexted, true);
});
