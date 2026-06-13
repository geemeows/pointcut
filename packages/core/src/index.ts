// @pointcut/core — bundler-free, framework-free guts.
//
// Owns the design-mode hard guard (ADR-0001 sibling: see docs/adr/0002): the
// Bridge refuses to construct unless explicitly enabled, so every consumer
// (unplugin auto-attach AND the sidecar) inherits the same gate. There is
// exactly one Bridge implementation; bundlers only mount the handler.
import type { IncomingMessage, ServerResponse } from 'node:http';
// The Bridge guts are framework-free `.mjs` ESM (editor-launch + agent-probe +
// agent-run, assembled in bridge.mjs). `createBridge` below delegates to it; the
// type surface (Action / AgentMode / Driver / BridgeOptions / BridgeHandler)
// stays here so consumers import everything from one typed entry point.
import { createBridge as createBridgeImpl } from './bridge/bridge.mjs';

// Pure authoring models, lifted verbatim from the source toolbar (issue #2).
// Framework-free factories with injected collaborators (storage, doc/win,
// tokens, fetch), so they carry no DOM or bundler dependency. Tokens and
// Provenance move here as-lifted; their design-system-agnostic rework is a
// separate slice. Co-located `*.test.mjs` suites run under `node --test`.
export * from './models/queue.mjs';
export * from './models/locator.mjs';
export * from './models/tokens.mjs';
export * from './models/provenance.mjs';
export * from './models/spacing.mjs';
export * from './models/color.mjs';
export * from './models/typography.mjs';
export * from './models/copy.mjs';
export * from './models/chat.mjs';
export * from './models/handoff.mjs';
export * from './models/agent-run.mjs';

// Agent Drivers + registry, lifted verbatim from the source toolbar (issue #3).
// The Driver seam is the whole extensibility story: adding an agent is one
// Driver module plus one registry entry — Bridge / protocol / client never
// change. `getDriver(name)` + the `DRIVERS` map, the shared per-mode directive
// and permission helpers, and the claude / codex / cursor drivers (cursor's
// `models` discovers live). Co-located `*.test.mjs` suites run under `node --test`.
export * from './drivers/shared.mjs';
export * from './drivers/registry.mjs';
export * from './drivers/claude.mjs';
export * from './drivers/codex.mjs';
export * from './drivers/cursor.mjs';

// Editor-launch — the jump-to-source half of the Bridge, mountable on its own
// ahead of the full `createBridge()` (issue #4 tracer bullet). The agent-probe
// and agent-run endpoints (issue #5) compose with it inside `createBridge()`.
export * from './bridge/editor-launch.mjs';
export * from './bridge/agent-probe.mjs';
export * from './bridge/agent-run.mjs';

/** The agent run mode — sets the chosen Driver's permission posture. */
export type AgentMode = 'apply' | 'apply-once' | 'discuss';

/** A normalized event in the uniform NDJSON stream the Bridge emits. */
export type Action = { t: 'action'; a: unknown } | { t: 'error'; m: string } | { t: 'end'; code: number };

export interface DriverModel {
  label: string;
  value: string;
}

/**
 * A per-agent module. Adding an agent = one Driver + one registry entry;
 * Bridge / protocol / client never change.
 */
export interface Driver {
  command: string;
  models: DriverModel[] | (() => Promise<DriverModel[]>);
  buildArgs(input: {
    markdown: string;
    shots: Array<{ n: number; file: string }>;
    resume: string | null;
    model: string;
    mode: AgentMode;
  }): string[];
  parse(event: unknown): unknown[];
}

export interface BridgeOptions {
  /** Hard guard: the Bridge no-ops unless design mode is explicitly active. */
  enabled: boolean;
  /** Project root the agent CLI runs in. Defaults to process.cwd(). */
  cwd?: string;
  /** Allow-list of agent names; defaults to every Driver whose CLI is on PATH. */
  agents?: string[];
}

/** A connect-style middleware handler, mountable on any Node HTTP server. */
export type BridgeHandler = (req: IncomingMessage, res: ServerResponse, next?: () => void) => void;

/**
 * Build the Bridge handler (editor-launch + agent-probe + agent-run → NDJSON).
 * Returns a no-op passthrough when `enabled` is false so it can never run in prod.
 *
 * Delegates to the framework-free guts in `./bridge/bridge.mjs`; this typed
 * wrapper is the single entry point consumers import.
 */
export function createBridge(options: BridgeOptions): BridgeHandler {
  return createBridgeImpl(options) as BridgeHandler;
}
