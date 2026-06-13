// @pointcut/core — agent-run, the spawn-and-stream half of the Bridge.
//
// POST a Turn here ({ agent, markdown, images, resume, model, mode }) and the
// Bridge: decodes the screenshot data-URLs to temp PNGs, asks the chosen Driver
// to build the CLI argv, spawns that CLI (stdin ignored), then reads its
// newline-delimited JSON stdout — buffering partial lines across chunks — and
// normalizes each native event through `driver.parse()` into Actions. Each Turn
// streams back as uniform NDJSON: {t:'action',a} | {t:'error',m} | {t:'end',code}.
//
// The wire protocol is agent-agnostic on purpose (CONTEXT.md / the Driver ADR):
// the client never sees a raw CLI event, only Actions. On client disconnect we
// kill the child AND clean up the temp PNGs, so an abandoned run leaves nothing.
//
// `X-Accel-Buffering:no` defeats proxy buffering so Actions arrive incrementally;
// `X-Content-Type-Options:nosniff` keeps the NDJSON from being content-sniffed.
import { spawn as nodeSpawn } from 'node:child_process';
import { getDriver } from '../drivers/registry.mjs';
import { readJsonBody, writeShots, cleanupShots } from './shared.mjs';

// Pump a child's stdout: split on '\n', carry the trailing partial across reads,
// parse each complete line as JSON, and feed it to `onEvent`. Non-JSON lines are
// skipped (CLIs interleave the odd non-JSON log line). Returns the flush() that
// drains any final un-terminated line on close.
const lineBuffer = (onEvent) => {
  let buf = '';
  const handle = (line) => {
    const l = line.trim();
    if (!l) return;
    let event;
    try {
      event = JSON.parse(l);
    } catch (_) {
      return; // non-JSON noise — skip
    }
    onEvent(event);
  };
  return {
    push(chunk) {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        handle(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    },
    flush() {
      if (buf) handle(buf);
      buf = '';
    },
  };
};

/**
 * Build the agent-run handler.
 *
 * @param {object} opts
 * @param {boolean} opts.enabled    Hard guard: no-op unless design mode is active.
 * @param {string} [opts.cwd]       Project root the agent CLI runs in.
 * @param {string[]} [opts.agents]  Allow-list of agent names; absent = any Driver.
 * @param {string} [opts.prefix]    Endpoint prefix; defaults to '/__pointcut/agent'.
 * @param {(cmd: string, args: string[], opts: object) => any} [opts.spawn] Injectable spawn.
 * @param {(name: string) => object|null} [opts.resolveDriver] Driver lookup (injectable).
 * @returns {(req: any, res: any, next?: () => void) => void}
 */
export function createAgentRun({
  enabled = false,
  cwd = process.cwd(),
  agents,
  prefix = '/__pointcut/agent',
  spawn = nodeSpawn,
  resolveDriver = getDriver,
} = {}) {
  if (!enabled) return (_req, _res, next) => next?.();

  return (req, res, next) => {
    if (!req.url || req.url.split('?')[0] !== prefix || (req.method || 'GET') !== 'POST') {
      return next?.();
    }

    readJsonBody(req)
      .then((turn) => run(turn))
      .catch((err) => {
        res.statusCode = 400;
        res.end(String((err && err.message) || err));
      });

    const run = async (turn) => {
      const { agent, markdown = '', images, resume = null, model = '', mode = 'apply' } = turn || {};
      if (agents && agents.length && !agents.includes(agent)) {
        res.statusCode = 403;
        res.end('agent not allowed');
        return;
      }
      const driver = resolveDriver(agent);
      if (!driver) {
        res.statusCode = 404;
        res.end('unknown agent');
        return;
      }

      // NDJSON stream — unbuffered, un-sniffed (see the file header).
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const write = (obj) => res.write(JSON.stringify(obj) + '\n');

      // Decode screenshots to temp PNGs, then build argv + spawn the CLI.
      const written = await writeShots(images, {});
      const args = driver.buildArgs({ markdown, shots: written.shots, resume, model, mode });

      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        return cleanupShots(written, {});
      };

      let child;
      try {
        child = spawn(driver.command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        write({ t: 'error', m: String((err && err.message) || err) });
        write({ t: 'end', code: 1 });
        res.end();
        await cleanup();
        return;
      }

      // Normalize each native event through the Driver into zero+ Actions.
      const buffer = lineBuffer((event) => {
        for (const a of driver.parse(event) || []) write({ t: 'action', a });
      });
      child.stdout?.on('data', (chunk) => buffer.push(String(chunk)));
      // The CLI's stderr is diagnostic, not protocol — surface it as an error line.
      child.stderr?.on('data', (chunk) => {
        const m = String(chunk).trim();
        if (m) write({ t: 'error', m });
      });
      child.on('error', (err) => write({ t: 'error', m: String((err && err.message) || err) }));
      child.on('close', async (code) => {
        buffer.flush();
        write({ t: 'end', code: code == null ? 0 : code });
        res.end();
        await cleanup();
      });

      // Client disconnect: kill the child AND clean up the temp PNGs.
      const onClose = () => {
        try {
          child.kill();
        } catch (_) {
          /* already gone */
        }
        cleanup();
      };
      res.on('close', onClose);
    };
  };
}

export { lineBuffer };
