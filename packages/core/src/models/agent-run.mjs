/* eslint-disable */
// Design Toolbar — agent run (see ../design-toolbar-plugin.js).
//
// The seam between the toolbar UI and the dev-server Bridge — now fully
// agent-agnostic. The Bridge normalizes events server-side (per-agent Drivers)
// and emits one uniform wire protocol, so the client only transports and
// dispatches Actions: no per-agent branching, no raw CLI events on the wire.
// (Claude's interpreter moved server-side to the claude Driver — see the ADR.)
//
//   - parseBridgeLine: one NDJSON line → envelope ({t,...}) or null on noise.
//   - streamAgentRun:  POST a Turn, pump the NDJSON body, feed each line to handlers.
// Promise-chain only (project rule). The caller owns rendering and surface choice,
// so a run never touches the DOM — panel and drawer are just two sets of handlers.

// Parse one bridge NDJSON line. Returns the envelope ({t,...}) or null on noise.
export const parseBridgeLine = (line) => {
  try {
    return JSON.parse(line);
  } catch (_) {
    return null;
  }
};

// Dispatch one already-trimmed, non-empty NDJSON line to the handlers. The wire
// protocol is uniform across agents: {t:'action',a} | {t:'error',m} | {t:'end',code}.
const dispatchLine = (line, h) => {
  const msg = parseBridgeLine(line);
  if (!msg) return; // non-JSON noise — skip
  if (msg.t === 'error') h.onBridgeError(msg.m || 'error');
  else if (msg.t === 'end') h.onBridgeEnd();
  else if (msg.t === 'action' && msg.a) h.onAction(msg.a);
};

// POST the Turn to the bridge and stream its NDJSON reply into `handlers`:
//   onAction(action)   — a normalized Action (see the Drivers' parse())
//   onBridgeError(msg) — a {t:'error'} line from the bridge (run continues to onBridgeEnd)
//   onBridgeEnd()      — the {t:'end'} line (child exited)
//   onStreamEnd()      — the HTTP body closed (reader done)
//   onError(msg)       — the request itself failed (never reached the bridge)
// `request` is { agent, markdown, resume, model, mode }. `fetchImpl` is injectable for tests.
export const streamAgentRun = (request, handlers, fetchImpl) => {
  const h = handlers;
  const doFetch = fetchImpl || fetch;
  return doFetch('/__pointcut/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
    .then((resp) => {
      if (!resp.ok || !resp.body) throw new Error('request failed (' + resp.status + ')');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const pump = () =>
        reader.read().then(({ done, value }) => {
          if (done) {
            h.onStreamEnd();
            return;
          }
          buf += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const l = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (l) dispatchLine(l, h);
          }
          return pump();
        });
      return pump();
    })
    .catch((err) => h.onError(String(err.message || err)));
};
