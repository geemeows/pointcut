// @pointcut/core — agent-probe, the "which agents are installed" half of the Bridge.
//
// The client can't know which agent CLIs the developer actually has, so this
// endpoint answers it. It PATH-scans each Driver's `command` and returns ONLY
// the Drivers whose CLI is resolvable, each with its resolved models. A Driver's
// `models` may be a static array OR an async function (cursor discovers live) —
// either way we await it and CACHE the result, since neither PATH membership nor
// account entitlements change within a dev session.
//
// Framework-free and bundler-free: a connect-style handler the unplugin
// auto-attach and the sidecar both mount, gated by the same `enabled` hard guard.
import { DRIVERS } from '../drivers/registry.mjs';
import { commandOnPath } from './shared.mjs';

/**
 * Resolve the installed Agents once: PATH-scan each allowed Driver's command,
 * keep only the present ones, await + resolve their models. Pure helper so the
 * filtering/await logic is unit-testable without an HTTP round-trip.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.agents]              Allow-list; defaults to every Driver.
 * @param {Record<string, object>} [opts.drivers] Driver map (injectable for tests).
 * @param {(cmd: string) => Promise<boolean>} [opts.onPath] PATH probe (injectable).
 * @returns {Promise<Array<{ name: string, models: Array<{label:string,value:string}> }>>}
 */
export async function resolveAgents({ agents, drivers = DRIVERS, onPath = commandOnPath } = {}) {
  const names = agents && agents.length ? agents : Object.keys(drivers);
  const out = [];
  for (const name of names) {
    const driver = drivers[name];
    if (!driver) continue;
    if (!(await onPath(driver.command))) continue; // only-on-PATH
    const models = typeof driver.models === 'function' ? await driver.models() : driver.models;
    out.push({ name, models: Array.isArray(models) ? models : [] });
  }
  return out;
}

/**
 * Build the agent-probe handler.
 *
 * @param {object} opts
 * @param {boolean} opts.enabled   Hard guard: no-op unless design mode is active.
 * @param {string[]} [opts.agents] Allow-list of agent names; defaults to all Drivers.
 * @param {string} [opts.prefix]   Endpoint prefix; defaults to '/__pointcut/agents'.
 * @param {Record<string, object>} [opts.drivers] Driver map (injectable for tests).
 * @param {(cmd: string) => Promise<boolean>} [opts.onPath] PATH probe (injectable).
 * @returns {(req: any, res: any, next?: () => void) => void}
 */
export function createAgentProbe({
  enabled = false,
  agents,
  prefix = '/__pointcut/agents',
  drivers = DRIVERS,
  onPath = commandOnPath,
} = {}) {
  if (!enabled) return (_req, _res, next) => next?.();

  // Cache the resolved result for the dev session — PATH and entitlements are stable.
  let cached = null;

  return (req, res, next) => {
    if (!req.url || req.url.split('?')[0] !== prefix) return next?.();
    const send = (list) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ agents: list }));
    };
    if (cached) return send(cached);
    resolveAgents({ agents, drivers, onPath })
      .then((list) => {
        cached = list;
        send(list);
      })
      .catch((err) => {
        res.statusCode = 500;
        res.end(String((err && err.message) || err));
      });
  };
}
