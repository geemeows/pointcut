// @pointcut/core — editor-launch, the jump-to-source half of the Bridge.
//
// Lifted from the source toolbar's `/__luciq_open` endpoint, name-neutralized to
// the `/__pointcut/*` prefix. A clicked DOM node carries a Source Stamp
// (`data-pointcut-loc="file:line:col"`); the client posts that here and we open
// the user's editor at that spot. The relative loc is resolved against the
// project root before launching.
//
// Framework-free and bundler-free: it's a connect-style handler the unplugin
// auto-attach and the sidecar both mount. Gated by `enabled` so it inherits the
// same design-mode hard guard as the rest of the Bridge — a disabled handler
// no-ops straight to next().
import path from 'node:path';
import launch from 'launch-editor';

/**
 * Build the editor-launch handler.
 *
 * @param {object} opts
 * @param {boolean} opts.enabled  Hard guard: no-op unless design mode is active.
 * @param {string} [opts.cwd]     Project root relative locs resolve against.
 * @param {string} [opts.prefix]  Endpoint prefix; defaults to '/__pointcut/open'.
 * @returns {(req: any, res: any, next?: () => void) => void}
 */
export function createEditorLaunch({ enabled = false, cwd = process.cwd(), prefix = '/__pointcut/open' } = {}) {
  if (!enabled) return (_req, _res, next) => next?.();

  return (req, res, next) => {
    if (!req.url || req.url.split('?')[0] !== prefix) return next?.();
    const params = new URL(req.url, 'http://localhost').searchParams;
    const file = params.get('file');
    if (!file) {
      res.statusCode = 400;
      res.end('missing file');
      return;
    }
    const line = params.get('line') || 1;
    const col = params.get('col') || 1;
    // Resolve the relative source loc against the project root before launching.
    launch(`${path.resolve(cwd, file)}:${line}:${col}`);
    res.statusCode = 204;
    res.end();
  };
}
