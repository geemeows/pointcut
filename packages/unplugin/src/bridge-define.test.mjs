/* eslint-disable */
// Run: node --import tsx --test packages/unplugin/src/
//
// The Bridge base-URL stamp (AC #2): the unplugin replaces the client's
// __POINTCUT_BRIDGE__ placeholder with the Sidecar URL when `bridge.port` is
// set (dev-server-less), and with the empty string (same-origin) otherwise.
// The universal substitution lives in the shared `transform` hook, so we drive
// that hook directly — it is what Rollup/Rolldown/esbuild/Farm execute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unpluginFactory } from './index.ts';

// The client module's relevant line, verbatim from @pointcut/core/client.
const CLIENT_SNIPPET =
  "export const bridgeBase = typeof __POINTCUT_BRIDGE__ === 'string' ? __POINTCUT_BRIDGE__ : '';";

/** Run the factory's universal `transform` hook over a chunk of client source. */
function stampClient(options) {
  const plugin = unpluginFactory(options);
  // The transform hook is a plain function here (no ObjectHook wrapper).
  return plugin.transform.call({}, CLIENT_SNIPPET, '/node_modules/@pointcut/core/dist/client.js');
}

test('bridge.port set → placeholder stamped as the Sidecar URL', () => {
  const out = stampClient({ bridge: { port: 7321 } });
  assert.ok(out, 'transform should return a result when the placeholder is present');
  assert.match(out.code, /"http:\/\/localhost:7321"/);
  assert.doesNotMatch(out.code, /__POINTCUT_BRIDGE__/);
  // Evaluating the stamped expression yields the Sidecar base URL.
  assert.equal(evalBridgeBase(out.code), 'http://localhost:7321');
});

test('a custom bridge.port flows through verbatim', () => {
  const out = stampClient({ bridge: { port: 4321 } });
  assert.equal(evalBridgeBase(out.code), 'http://localhost:4321');
});

test('no bridge → placeholder stamped as empty string (same-origin auto-attach)', () => {
  const out = stampClient({});
  assert.ok(out);
  assert.doesNotMatch(out.code, /__POINTCUT_BRIDGE__/);
  assert.equal(evalBridgeBase(out.code), '');
});

test('bridge present but no port → empty string (same-origin)', () => {
  const out = stampClient({ bridge: {} });
  assert.equal(evalBridgeBase(out.code), '');
});

test('modules without the placeholder are left untouched', () => {
  const plugin = unpluginFactory({ bridge: { port: 7321 } });
  const out = plugin.transform.call({}, 'export const x = 1;', '/src/unrelated.js');
  assert.equal(out, undefined);
});

test('Vite native define mirrors the stamped value (auto-attach = empty)', () => {
  const plugin = unpluginFactory({});
  const cfg = plugin.vite.config();
  assert.equal(cfg.define.__POINTCUT_BRIDGE__, JSON.stringify(''));
});

test('Vite native define carries the Sidecar URL when bridge.port is set', () => {
  const plugin = unpluginFactory({ bridge: { port: 7321 } });
  const cfg = plugin.vite.config();
  assert.equal(cfg.define.__POINTCUT_BRIDGE__, JSON.stringify('http://localhost:7321'));
});

test('esbuild native define mutates build options the same way', () => {
  const plugin = unpluginFactory({ bridge: { port: 7321 } });
  const buildOptions = {};
  plugin.esbuild.config(buildOptions);
  assert.equal(buildOptions.define.__POINTCUT_BRIDGE__, JSON.stringify('http://localhost:7321'));
});

/** Evaluate the stamped client line and read back its `bridgeBase` constant. */
function evalBridgeBase(code) {
  // The snippet is `export const bridgeBase = …`; strip the export to eval it.
  const expr = code.replace('export const bridgeBase =', 'return');
  // eslint-disable-next-line no-new-func
  return new Function(expr)();
}
