// @pointcut/core/client — the in-page toolbar (browser ESM).
//
// Injected in design mode only. Renders into a Shadow DOM (vanilla, no
// framework). Reaches the Bridge via a base URL stamped at build time:
// empty for same-origin auto-attach, http://localhost:<port> for the sidecar.

/** Replaced at build time by the unplugin `define`; '' means same-origin. */
declare const __POINTCUT_BRIDGE__: string | undefined;

export const bridgeBase: string = typeof __POINTCUT_BRIDGE__ === 'string' ? __POINTCUT_BRIDGE__ : '';

/** Mount the toolbar into the page. Stub — the vanilla client ports here. */
export function mount(): void {
  // ported client.js renders into a shadow root here
}
