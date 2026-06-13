// Run: node --import tsx --test
//
// Auto-attach parity tests (issue #11): Webpack and Rspack must mount the SAME
// Bridge as Vite, through the dev-server middleware hook
// (`devServer.setupMiddlewares`), with a production hard guard, and the Source
// Stamp must run as a webpack/rspack PRE-loader (before vue-loader/babel-loader).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unpluginFactory } from './index.ts';

// Build the raw unplugin object (the factory return) so we can poke its
// per-bundler hooks directly. `webpack(compiler)` / `rspack(compiler)` are plain
// functions on that object — exactly what unplugin invokes at apply-time.
const factory = (opts) => unpluginFactory(opts);

// A minimal fake webpack/rspack Compiler exposing only the structural subset the
// auto-attach touches: `options.mode`, `options.context`, `options.devServer`.
function fakeCompiler({ mode = 'development', context = '/project', devServer } = {}) {
  return { options: { mode, context, ...(devServer !== undefined ? { devServer } : {}) } };
}

// Drive a freshly-installed `setupMiddlewares` and return the resulting chain.
function runSetup(compiler) {
  const setup = compiler.options.devServer.setupMiddlewares;
  assert.equal(typeof setup, 'function', 'setupMiddlewares should be installed');
  const middlewares = [];
  const returned = setup(middlewares, /* devServerInstance */ {});
  return returned;
}

for (const bundler of ['webpack', 'rspack']) {
  test(`${bundler}: mounts the Bridge via devServer.setupMiddlewares`, () => {
    const plugin = factory({ framework: 'vue' });
    assert.equal(typeof plugin[bundler], 'function', `${bundler} hook should exist`);

    const compiler = fakeCompiler();
    plugin[bundler](compiler);

    const chain = runSetup(compiler);
    const bridgeEntry = chain.find((m) => m && m.name === 'pointcut-bridge');
    assert.ok(bridgeEntry, 'a pointcut-bridge middleware should be registered');
    // The Bridge is a connect-style (req,res,next) handler.
    assert.equal(typeof bridgeEntry.middleware, 'function');
    assert.ok(bridgeEntry.middleware.length >= 2, 'handler takes (req,res,next?)');
  });

  test(`${bundler}: Bridge is prepended ahead of the user's middleware chain`, () => {
    const plugin = factory({});
    const compiler = fakeCompiler();
    plugin[bundler](compiler);
    const chain = runSetup(compiler);
    assert.equal(chain[0]?.name, 'pointcut-bridge', 'Bridge must see requests first');
  });

  test(`${bundler}: wraps an existing setupMiddlewares (user's hook still runs)`, () => {
    let userCalled = false;
    const userMiddleware = { name: 'user-mw', middleware: () => {} };
    const devServer = {
      setupMiddlewares: (mws) => {
        userCalled = true;
        mws.push(userMiddleware);
        return mws;
      },
    };
    const plugin = factory({});
    const compiler = fakeCompiler({ devServer });
    plugin[bundler](compiler);

    const chain = runSetup(compiler);
    assert.ok(userCalled, "the user's setupMiddlewares must still be invoked");
    assert.equal(chain[0]?.name, 'pointcut-bridge', 'Bridge prepended');
    assert.ok(chain.some((m) => m && m.name === 'user-mw'), "user's middleware preserved");
  });

  test(`${bundler}: production hard guard no-ops (never touches devServer)`, () => {
    const plugin = factory({});
    const compiler = fakeCompiler({ mode: 'production' });
    plugin[bundler](compiler);
    assert.equal(
      compiler.options.devServer,
      undefined,
      'no devServer / setupMiddlewares should be created in a production build',
    );
  });

  test(`${bundler}: defaults to process.cwd() when compiler has no context`, () => {
    const plugin = factory({});
    const compiler = { options: { mode: 'development' } }; // no context
    // Must not throw, and must still install the hook.
    plugin[bundler](compiler);
    const chain = runSetup(compiler);
    assert.equal(chain[0]?.name, 'pointcut-bridge');
  });
}

test('webpack and rspack mount the identical Bridge factory (same handler shape)', () => {
  // Both bundlers route through the same makeBridge helper as Vite, so the
  // handler they register is structurally the same connect-style middleware.
  const wp = factory({});
  const rp = factory({});
  const wpCompiler = fakeCompiler();
  const rpCompiler = fakeCompiler();
  wp.webpack(wpCompiler);
  rp.rspack(rpCompiler);
  const wpBridge = runSetup(wpCompiler)[0].middleware;
  const rpBridge = runSetup(rpCompiler)[0].middleware;
  assert.equal(typeof wpBridge, 'function');
  assert.equal(typeof rpBridge, 'function');
  assert.equal(wpBridge.length, rpBridge.length, 'same handler arity across bundlers');
});

test("Vite path mounts the same Bridge handler shape via configureServer", () => {
  // AC #3: no divergence between the Vite auto-attach and Webpack/Rspack. The
  // Vite block uses the same makeBridge helper, so the mounted handler matches.
  const plugin = factory({});
  let viteHandler;
  plugin.vite.configureServer({
    config: { root: '/project' },
    middlewares: { use: (h) => { viteHandler = h; } },
  });
  const wpCompiler = fakeCompiler();
  plugin.webpack(wpCompiler);
  const wpHandler = runSetup(wpCompiler)[0].middleware;
  assert.equal(typeof viteHandler, 'function');
  assert.equal(viteHandler.length, wpHandler.length, 'Vite and Webpack mount the same handler shape');
});

test("enforce:'pre' — Stamper runs before the framework loader (webpack pre-loader ordering)", () => {
  // unplugin maps `plugin.enforce` straight onto the generated webpack/rspack
  // module rule's `enforce` field; webpack runs `enforce:'pre'` loaders BEFORE
  // normal loaders (vue-loader/babel-loader). Asserting the factory still
  // declares `enforce:'pre'` guards the ordering contract from regressing.
  const plugin = factory({ framework: 'vue' });
  assert.equal(plugin.enforce, 'pre', "must stay a pre-loader so the Source Stamp runs before vue-loader/babel-loader");
});
