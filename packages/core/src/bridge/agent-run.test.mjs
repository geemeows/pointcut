/* eslint-disable */
// Run: node --test packages/core/src/bridge/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { lineBuffer, createAgentRun } from './agent-run.mjs';

// --- lineBuffer: partial-line buffering across chunks ------------------------
test('lineBuffer reassembles a JSON event split across chunk boundaries', () => {
  const events = [];
  const b = lineBuffer((e) => events.push(e));
  b.push('{"type":"a"');
  b.push(',"n":1}\n{"type":"b"}\n'); // first event completed mid-second-chunk
  assert.deepEqual(events, [{ type: 'a', n: 1 }, { type: 'b' }]);
});

test('lineBuffer skips non-JSON noise lines and flushes a trailing partial', () => {
  const events = [];
  const b = lineBuffer((e) => events.push(e));
  b.push('garbage log line\n{"type":"x"}\n{"type":"y"}'); // last line has no newline
  assert.deepEqual(events, [{ type: 'x' }]); // y is still buffered
  b.flush();
  assert.deepEqual(events, [{ type: 'x' }, { type: 'y' }]);
});

// --- fakes -------------------------------------------------------------------
// A fake request: an EventEmitter that replays a JSON body, with url/method.
const fakeReq = (url, method, body) => {
  const req = new EventEmitter();
  req.url = url;
  req.method = method;
  process.nextTick(() => {
    if (body) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  return req;
};

// A fake response: an EventEmitter capturing writes and headers.
const fakeRes = () => {
  const res = new EventEmitter();
  res.statusCode = 0;
  res.headers = {};
  res.chunks = [];
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  res.write = (s) => res.chunks.push(s);
  res.end = (s) => {
    if (s) res.chunks.push(s);
    res.ended = true;
  };
  // NDJSON lines parsed back from the write chunks.
  res.lines = () =>
    res.chunks
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  return res;
};

// A fake child process: an EventEmitter with stdout/stderr emitters + kill flag.
const fakeChild = () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
};

// A fake Driver: passes through events as a single Action, records buildArgs input.
const makeDriver = () => ({
  command: 'fake-cli',
  models: [],
  buildArgs(input) {
    this.lastInput = input;
    return ['--fake'];
  },
  parse: (e) => (e && e.type === 'evt' ? [{ kind: 'text', text: e.text }] : []),
});

// Body parse (nextTick) → writeShots (real fs.mkdtemp) → buildArgs/spawn all
// chain through async boundaries; a few macrotask turns lets them settle.
const tick = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 2));
};

test('createAgentRun: disabled → no-op passthrough to next()', () => {
  const handler = createAgentRun({ enabled: false });
  let nexted = false;
  handler(fakeReq('/__pointcut/agent', 'POST', {}), fakeRes(), () => {
    nexted = true;
  });
  assert.equal(nexted, true);
});

test('createAgentRun: non-POST / wrong url falls through to next()', () => {
  const handler = createAgentRun({ enabled: true, spawn: () => fakeChild() });
  let nexted = 0;
  handler(fakeReq('/__pointcut/agent', 'GET'), fakeRes(), () => nexted++);
  handler(fakeReq('/other', 'POST', {}), fakeRes(), () => nexted++);
  assert.equal(nexted, 2);
});

test('createAgentRun: spawns the Driver, streams uniform NDJSON Actions + end', async () => {
  const driver = makeDriver();
  const child = fakeChild();
  let spawnedCmd, spawnedArgs, spawnedOpts;
  const handler = createAgentRun({
    enabled: true,
    cwd: '/proj',
    spawn: (cmd, args, opts) => {
      spawnedCmd = cmd;
      spawnedArgs = args;
      spawnedOpts = opts;
      return child;
    },
    resolveDriver: () => driver,
  });
  const res = fakeRes();
  handler(fakeReq('/__pointcut/agent', 'POST', { agent: 'fake', markdown: 'hi', mode: 'apply' }), res);
  await tick(); // let readJsonBody + writeShots resolve

  assert.equal(spawnedCmd, 'fake-cli');
  assert.deepEqual(spawnedArgs, ['--fake']);
  assert.equal(spawnedOpts.cwd, '/proj');
  assert.equal(spawnedOpts.stdio[0], 'ignore'); // stdin ignored
  assert.equal(res.headers['X-Accel-Buffering'], 'no');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');

  // Two events, the second split across two stdout chunks → two Actions.
  child.stdout.emit('data', Buffer.from('{"type":"evt","text":"one"}\n{"type":"evt"'));
  child.stdout.emit('data', Buffer.from(',"text":"two"}\n'));
  child.emit('close', 0);
  await tick();

  assert.deepEqual(res.lines(), [
    { t: 'action', a: { kind: 'text', text: 'one' } },
    { t: 'action', a: { kind: 'text', text: 'two' } },
    { t: 'end', code: 0 },
  ]);
  assert.equal(res.ended, true);
});

test('createAgentRun: client disconnect kills the child and cleans temp PNGs', async () => {
  const driver = makeDriver();
  const child = fakeChild();
  const handler = createAgentRun({
    enabled: true,
    spawn: () => child,
    resolveDriver: () => driver,
  });
  const res = fakeRes();
  const PNG = 'data:image/png;base64,' + Buffer.from('x').toString('base64');
  handler(
    fakeReq('/__pointcut/agent', 'POST', { agent: 'fake', markdown: 'm', images: [PNG] }),
    res,
  );
  await tick();

  // A temp PNG was decoded and named into buildArgs' shots.
  assert.equal(driver.lastInput.shots.length, 1);
  const tmpFile = driver.lastInput.shots[0].file;
  const fs = await import('node:fs');
  assert.equal(fs.existsSync(tmpFile), true, 'temp PNG written');

  // Simulate the client hanging up.
  res.emit('close');
  await tick();
  assert.equal(child.killed, true, 'child killed on disconnect');
  assert.equal(fs.existsSync(tmpFile), false, 'temp PNG cleaned up on disconnect');
});

test('createAgentRun: unknown agent → 404, no spawn', async () => {
  let spawned = false;
  const handler = createAgentRun({
    enabled: true,
    spawn: () => {
      spawned = true;
      return fakeChild();
    },
    resolveDriver: () => null,
  });
  const res = fakeRes();
  handler(fakeReq('/__pointcut/agent', 'POST', { agent: 'nope' }), res);
  await tick();
  assert.equal(res.statusCode, 404);
  assert.equal(spawned, false);
});

test('createAgentRun: agent not in allow-list → 403', async () => {
  const handler = createAgentRun({
    enabled: true,
    agents: ['claude'],
    spawn: () => fakeChild(),
    resolveDriver: () => makeDriver(),
  });
  const res = fakeRes();
  handler(fakeReq('/__pointcut/agent', 'POST', { agent: 'cursor' }), res);
  await tick();
  assert.equal(res.statusCode, 403);
});
