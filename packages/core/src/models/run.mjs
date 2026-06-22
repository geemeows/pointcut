/* eslint-disable */
// Design Toolbar — agent Run orchestrator (CONTEXT.md: "Run").
//
// Layered ABOVE the pure `agent-run.mjs` transport. Collapses the duplicated
// send→stream→finish boilerplate that lived inline at three client call sites
// (runAgent / runChat / sendCommentsToChat) into ONE stateful object.
//
// What this owns (the run-scoped lifecycle state, lifted out of the client
// closure): running, errored, startAt, the streamed-prose node ref + buffer
// (openTextMsg/openTextBuf), and the run-scoped pin/resolution id sets
// (workingIds, pendingResolveIds).
//
// What it does NOT own: queue-selection state (sentIds/selectedIds stay in the
// client — they outlive a single run), the picker (selectedAgent/Model), and
// ALL DOM. Every pixel of rendering is an INJECTED callback (the handler-bag
// pattern `agent-run.mjs` already uses): the orchestrator is DOM-free.
//
// requestTitle is deliberately NOT routed through here — it's a distinct
// lifecycle (own titleRunning flag, no surface, no annotation resolution) and
// stays a thin direct `streamAgentRun` call in the client.
//
// --- deps (injected once at createAgentRun) ---------------------------------
//   transport      : streamAgentRun (from agent-run.mjs)
//   fetchImpl      : the bridge fetch (passed through to the transport)
//   request        : ({agent, model, markdown, resume, mode}) → the wire request
//                    (lets the client supply selectedAgent/selectedModel without
//                    this model knowing the picker)
//   markThinking   : (ids) => void   — arm/clear the on-page pin pulse
//   stopThinking   : (errored) => void
//   now            : () => number     — clock (default Date.now); injectable for tests
//   onProseOpen    : () => node       — create a fresh prose row, return its node
//   onProse        : (node, buf) => void — render accumulated delta markup into node
//   onProseFull    : (node, text) => void — render an authoritative full block into node
//
// --- plan (passed per run) --------------------------------------------------
//   payload          : {markdown, resume, mode?}  — the turn body (→ deps.request)
//   workingIds       : ids to pulse for this run (panel: the sent comments;
//                      send-to-chat: the comments being resolved). [] = none.
//   resolveAnnotations : ids to drop from the queue on SUCCESS (send-to-chat).
//                        [] = nothing to resolve.
//   onAction         : (action) => void  — the per-Action render fn for this
//                      surface (renderAction for the panel, renderChatAction for
//                      the transcript). It may call markErrored()/streamText().
//   onBridgeError    : (msg) => void      — a {t:'error'} line (run continues to
//                      onBridgeEnd); errored is already set when this fires
//   beforeFinish     : (reason|null) => void — run-specific finish DOM run while
//                      the prose line is still OPEN: flush trailing openBuf
//                      (finishChat records it), and log/record the error when
//                      reason is non-null (errored is already set)
//   afterFinish      : (errored) => void  — run-specific finish tail, AFTER the
//                      shared stop/resolve (removeSent + dismiss for the panel;
//                      renderChatHead + requestTitle + chatStateUpdate +
//                      updateCommentsActions for the transcript)
//   onResolved       : (ids) => void      — apply the queue resolution for the
//                      resolveAnnotations ids (success only); the client drops
//                      them from the queue + selection and repaints.

export const createAgentRun = (deps) => {
  let running = false;
  let errored = false;
  let startAt = 0;
  let openTextMsg = null; // opaque node ref the client's onProse rows write into
  let openTextBuf = '';
  let workingIds = [];
  let pendingResolveIds = [];

  // Prose buffering (was streamText/closeTextRow in the client closure). The
  // orchestrator owns the buffer; the client owns the DOM the markup lands in.
  const closeText = () => { openTextMsg = null; openTextBuf = ''; };

  // Stream assistant prose into ONE line: delta chunks accumulate, a full block
  // finalizes (authoritative) and closes the line. The client supplies the DOM
  // ops via deps.onProse (ensure-row + render buffer) and deps.onProseFull.
  const streamText = (text, isDelta) => {
    if (!openTextMsg) { openTextMsg = deps.onProseOpen(); openTextBuf = ''; }
    if (isDelta) {
      openTextBuf += text;
      deps.onProse(openTextMsg, openTextBuf);
    } else {
      deps.onProseFull(openTextMsg, text); // authoritative full text into the row
      closeText();
    }
  };

  const markErrored = () => { errored = true; };

  // The uniform finish: idempotent (guards on running). The exact sequence is
  // shared by both original finishers (finishAgent / finishChat):
  //   1. flip running=false
  //   2. beforeFinish(reason) — surface-specific, runs while the prose line is
  //      still OPEN so it can flush trailing openBuf (finishChat records it) and
  //      log/record the error (reason sets errored first)
  //   3. closeText() — clear the prose line
  //   4. stopThinking(errored) + markThinking([]) — stop spinner + pin pulse
  //   5. resolve annotations on SUCCESS only (send-to-chat)
  //   6. afterFinish(errored) — surface-specific tail (removeSent / dismiss /
  //      renderChatHead + requestTitle + chatStateUpdate, updateActions)
  const finish = (reason) => {
    if (!running) return;
    running = false;
    const plan = current;
    if (reason) errored = true; // set BEFORE beforeFinish, as both originals do
    if (plan && plan.beforeFinish) plan.beforeFinish(reason || null);
    closeText();
    deps.stopThinking(errored);
    workingIds = [];
    deps.markThinking([]); // stop the pin pulse
    if (plan && plan.resolveAnnotations && plan.resolveAnnotations.length) {
      if (!errored && plan.onResolved) plan.onResolved(plan.resolveAnnotations);
      pendingResolveIds = [];
    }
    if (plan && plan.afterFinish) plan.afterFinish(errored);
  };

  let current = null; // the in-flight plan (drives finish)

  // Run one turn: flip the gate, arm the pins, stream, and finish uniformly.
  // The client has already prepared the surface (wiped the feed / switched tab /
  // echoed the user turn) before calling — that's surface DOM, not lifecycle.
  const run = (plan) => {
    current = plan;
    running = true;
    errored = false;
    closeText();
    startAt = deps.now ? deps.now() : Date.now();
    workingIds = plan.workingIds || [];
    pendingResolveIds = plan.resolveAnnotations || [];
    if (workingIds.length) deps.markThinking(workingIds);
    deps.transport(
      deps.request(plan.payload),
      {
        onAction: plan.onAction,
        onBridgeError: (m) => { errored = true; if (plan.onBridgeError) plan.onBridgeError(m); },
        onBridgeEnd: () => finish(null),
        onStreamEnd: () => finish(null),
        onError: (m) => finish(m),
      },
      deps.fetchImpl,
    );
  };

  return {
    run,
    // Prose helpers the client's render fns delegate to (replaces the closure's
    // streamText/closeTextRow — the buffer now lives here).
    streamText,
    closeText,
    // State the per-Action render fns flip mid-stream.
    markErrored,
    // Getters the client reads.
    isRunning: () => running,
    isErrored: () => errored,
    startedAt: () => startAt,
    openText: () => openTextMsg,
    openBuf: () => openTextBuf,
    workingIds: () => workingIds.slice(),
    pendingResolveIds: () => pendingResolveIds.slice(),
  };
};
