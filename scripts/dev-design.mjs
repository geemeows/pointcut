// Race-free design-mode dev runner.
//
// Plain `pnpm -r --parallel dev` starts the package watchers and the example
// servers at the same instant. The watchers' first `tsup` build rewrites
// packages/*/dist, and the eager bundlers (webpack, esbuild) compile everything
// up front — so they read dist/client/index.js mid-rewrite and crash with ENOENT
// / "could not resolve" before self-healing. (Vite dodges this: it resolves
// lazily, on browser request, by which time dist is stable.)
//
// The fix is to sequence startup: run the package watchers, wait until their
// initial build has finished and output has gone quiet, and only THEN start the
// example servers — which now read a settled dist. Live rebuilds on later edits
// still work, and webpack/esbuild's own watch debounces reads until writes
// settle, so the only sharp race (cold start) is gone.
//
// Bonus: because we own both child processes we print only the served URLs,
// keeping the console to exactly what's useful.
import { spawn } from 'node:child_process';

/** Spawn pnpm with piped stdio so we can read/filter output. */
function pnpm(args, env) {
  return spawn('pnpm', args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: env ? { ...process.env, ...env } : process.env,
  });
}

// Matches a dev-server URL line from any example: Vite ("➜  Local: …"),
// webpack-dev-server ("Loopback: …"), and the esbuild demo ("app: …").
const URL_LINE = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\b\S*/i;

// --- 1. Package watchers ----------------------------------------------------
// tsup prints "Watching for changes" once each config finishes its first build.
// We wait for that marker AND for output to fall quiet (covers core's three
// configs), so the example servers below only ever see a fully-written dist.
const watchers = pnpm(['--filter', './packages/*', '--parallel', 'dev']);

let lastOutput = Date.now();
let builtOnce = false;
const noteWatcher = (buf) => {
  lastOutput = Date.now();
  if (/Watching for changes/.test(buf.toString())) builtOnce = true;
};
watchers.stdout.on('data', noteWatcher);
watchers.stderr.on('data', noteWatcher);

await new Promise((resolve) => {
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const idleFor = Date.now() - lastOutput;
    // Settled: watchers reported a build and have been quiet for 800ms. Safety
    // valve: proceed after 20s regardless, so a watcher build error can't hang us.
    if ((builtOnce && idleFor > 800) || Date.now() - startedAt > 20_000) {
      clearInterval(timer);
      resolve();
    }
  }, 100);
});

// --- 2. Example servers (design mode) --------------------------------------
console.log('▶ examples running in DESIGN mode:');
const examples = pnpm(['--filter', './examples/*', '--parallel', 'dev'], { DESIGN: '1' });

const printUrls = (buf) => {
  for (const line of buf.toString().split('\n')) {
    if (URL_LINE.test(line)) process.stdout.write(line.trimEnd() + '\n');
  }
};
examples.stdout.on('data', printUrls);
examples.stderr.on('data', printUrls);

// --- 3. Lifecycle -----------------------------------------------------------
// Forward Ctrl-C to both child trees; tear everything down if either exits.
const shutdown = (code = 0) => {
  watchers.kill('SIGINT');
  examples.kill('SIGINT');
  process.exit(code);
};
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
examples.on('exit', (code) => shutdown(code ?? 0));
watchers.on('exit', (code) => shutdown(code ?? 0));
