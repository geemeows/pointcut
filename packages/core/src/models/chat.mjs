/* eslint-disable */
// Design Toolbar — Chat tab model (issue 0010, ADR 0003 / D10–D16).
//
// DOM-free state for the Chat tab's continuous "discuss" session:
//   - sessionId : the agent session to Resume, so follow-ups stay one thread (D11).
//   - entries   : the rendered transcript, persisted so a reload restores it (D15).
//   - apply     : the per-turn "Apply changes" toggle (D16) — default OFF (discuss),
//                 and consumed by takeMode() so an ON turn applies exactly once.
//
// Storage is injected so this is unit-testable without a browser; client.js owns
// every DOM concern (composer, transcript rendering, toggle UI). Synchronous —
// no async/await (project rule); the bridge round-trip lives in client.js.

const DISCUSS = 'discuss';
const APPLY_ONCE = 'apply-once';

export const createChat = ({ storage, storageKey }) => {
  let sessionId = null;
  let entries = [];
  let apply = false; // ephemeral — never persisted; resets after each send
  let chips = []; // per-turn context attachments (0011); ephemeral, never persisted
  let chipSeq = 0; // monotonic chip id source (no Date/random — keeps resume safe)

  const persist = () => {
    try {
      storage.setItem(storageKey, JSON.stringify({ sessionId, entries }));
    } catch (_) {}
  };

  // Restore session + transcript; bad/absent storage → safe empty defaults.
  try {
    const raw = storage.getItem(storageKey);
    if (raw) {
      const d = JSON.parse(raw);
      sessionId = typeof d.sessionId === 'string' ? d.sessionId : null;
      entries = Array.isArray(d.entries) ? d.entries : [];
    }
  } catch (_) {
    sessionId = null;
    entries = [];
  }

  return {
    entries: () => entries,
    record: (e) => { entries.push(e); persist(); },
    clear: () => { entries = []; persist(); },

    sessionId: () => sessionId,
    setSession: (id) => {
      const next = id || null;
      if (next === sessionId) return; // no-op write — resume id unchanged
      sessionId = next;
      persist();
    },

    applyOn: () => apply,
    setApply: (on) => { apply = !!on; },

    // Context chips (0011): elements picked while the Chat tab is active, attached
    // to the next turn only. Returned as a shallow array copy. Cleared after a
    // send (D13 — no auto-carry).
    chips: () => chips.slice(),
    addChip: (chip) => {
      chipSeq += 1;
      const c = { id: 'chip-' + chipSeq, ...chip };
      chips.push(c);
      return c;
    },
    removeChip: (id) => { chips = chips.filter((c) => c.id !== id); },
    clearChips: () => { chips = []; },
    // The mode for the next send; consumes the Apply toggle so ON applies for
    // exactly one turn, then falls back to discuss (D16).
    takeMode: () => {
      const m = apply ? APPLY_ONCE : DISCUSS;
      apply = false;
      return m;
    },
  };
};
