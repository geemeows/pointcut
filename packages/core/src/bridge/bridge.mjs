// @pointcut/core — the Bridge, assembled.
//
// The dev-server runtime surface that turns toolbar intent into agent edits
// (CONTEXT.md). It is exactly one connect-style handler composed of the three
// endpoints under the neutral `/__pointcut/*` prefix: editor-launch (jump to
// source), agent-probe (which agents are installed), and the agent run (spawn
// the chosen agent CLI, stream a uniform NDJSON Action stream).
//
// The design-mode hard guard lives here so every consumer inherits it: when
// `enabled` is false the Bridge is a no-op passthrough — it can never run in
// prod (ADR-0001/0002). Each sub-handler also honors the guard, but composing
// short-circuits at the top so a disabled Bridge does no work at all.
import { createEditorLaunch } from './editor-launch.mjs';
import { createAgentProbe } from './agent-probe.mjs';
import { createAgentRun } from './agent-run.mjs';

/**
 * Build the Bridge handler (editor-launch + agent-probe + agent-run → NDJSON).
 * Returns a no-op passthrough when `enabled` is false so it can never run in prod.
 *
 * @param {object} options
 * @param {boolean} options.enabled  Hard guard: no-op unless design mode is active.
 * @param {string} [options.cwd]     Project root the agent CLI runs in / locs resolve against.
 * @param {string[]} [options.agents] Allow-list of agent names; absent = every Driver on PATH.
 * @returns {(req: any, res: any, next?: () => void) => void}
 */
export function createBridge({ enabled = false, cwd = process.cwd(), agents } = {}) {
  if (!enabled) return (_req, _res, next) => next?.();

  // Each endpoint owns its own prefix and falls through to the next; the last
  // call to next() is the consumer's. Order is irrelevant (disjoint prefixes).
  const editorLaunch = createEditorLaunch({ enabled, cwd });
  const agentProbe = createAgentProbe({ enabled, agents });
  const agentRun = createAgentRun({ enabled, cwd, agents });

  return (req, res, next) => {
    editorLaunch(req, res, () => agentProbe(req, res, () => agentRun(req, res, next)));
  };
}
