/* eslint-disable */
// Design Toolbar — Chat tab model (issue 0010, ADR 0003 / D10–D16).
//
// DOM-free state for the Chat tab. The tab now holds *multiple* conversations
// (start a fresh chat, switch back to a previous one) while every per-chat read
// (entries/sessionId) and write (record/setSession/clear) targets the *current*
// conversation, so client.js needs no per-call id threading:
//   - chats     : the saved conversations, each with its own Resume session (D11)
//                 and rendered transcript (D15), persisted so a reload restores
//                 the whole set and which one was open.
//   - currentId : the open conversation; newChat/selectChat/deleteChat move it.
//   - mode      : the sticky agent posture (Claude-Code-style) cycled with
//                 Shift+Tab between 'discuss' (read-only, the default) and
//                 'apply' (edits files). Unlike the old per-turn toggle it does
//                 NOT reset after a send, and it persists across reloads.
//
// Storage is injected so this is unit-testable without a browser; client.js owns
// every DOM concern (composer, transcript rendering, history menu). Synchronous —
// no async/await, no Date/random (keeps the persisted shape resume-safe).

const DISCUSS = 'discuss';
const APPLY = 'apply';
const STORE_V = 2;

const newConversation = (id) => ({ id, sessionId: null, entries: [], seq: 0, title: null });

export const createChat = ({ storage, storageKey }) => {
  let chats = [];
  let currentId = null;
  let idSeq = 0; // monotonic source of conversation ids ('chat-N')
  let seq = 0; // monotonic recency stamp — drives history order without Date
  let mode = DISCUSS; // sticky posture (discuss|apply); cycled by Shift+Tab, persisted
  let chips = []; // per-turn context attachments (0011); ephemeral, never persisted
  let chipSeq = 0; // monotonic chip id source (no Date/random — keeps resume safe)

  const persist = () => {
    try {
      storage.setItem(storageKey, JSON.stringify({ v: STORE_V, currentId, idSeq, seq, mode, chats }));
    } catch (_) {}
  };

  const cur = () => chats.find((c) => c.id === currentId) || null;
  // Stamp the current conversation as the most-recently-active one.
  const touch = () => {
    const c = cur();
    if (c) {
      seq += 1;
      c.seq = seq;
    }
  };

  // Restore the conversation set; bad/absent storage → a single empty chat.
  // v1 (single chat: { sessionId, entries }) migrates into one conversation.
  try {
    const raw = storage.getItem(storageKey);
    if (raw) {
      const d = JSON.parse(raw);
      if (Array.isArray(d.chats)) {
        chats = d.chats
          .filter((c) => c && typeof c === 'object')
          .map((c) => ({
            id: String(c.id),
            sessionId: typeof c.sessionId === 'string' ? c.sessionId : null,
            entries: Array.isArray(c.entries) ? c.entries : [],
            seq: typeof c.seq === 'number' ? c.seq : 0,
            title: typeof c.title === 'string' ? c.title : null,
          }));
        idSeq = typeof d.idSeq === 'number' ? d.idSeq : chats.length;
        seq = typeof d.seq === 'number' ? d.seq : 0;
        mode = d.mode === APPLY ? APPLY : DISCUSS;
        currentId = chats.some((c) => c.id === d.currentId) ? d.currentId : (chats[0] && chats[0].id) || null;
      } else if (Array.isArray(d.entries) || typeof d.sessionId === 'string') {
        idSeq = 1;
        seq = 1;
        const c = newConversation('chat-1');
        c.sessionId = typeof d.sessionId === 'string' ? d.sessionId : null;
        c.entries = Array.isArray(d.entries) ? d.entries : [];
        c.seq = 1;
        chats = [c];
        currentId = c.id;
      }
    }
  } catch (_) {
    chats = [];
    currentId = null;
    idSeq = 0;
    seq = 0;
  }

  // There is always exactly one conversation to write into. Created lazily and
  // *not* persisted here, so a fresh load issues no storage write until a turn.
  const ensure = () => {
    if (!cur()) {
      idSeq += 1;
      const c = newConversation('chat-' + idSeq);
      seq += 1;
      c.seq = seq;
      chats.push(c);
      currentId = c.id;
    }
  };
  ensure();

  // A conversation's display title is the agent-generated one once it exists;
  // until then it falls back to the first user message (trimmed/clipped), and an
  // untouched conversation reads as "New chat".
  const titleOf = (c) => {
    if (c.title) {
      const t = c.title.trim().replace(/\s+/g, ' ');
      if (t) return t.length > 48 ? t.slice(0, 48) + '…' : t;
    }
    const first = c.entries.find((e) => e && e.k === 'you' && e.text);
    if (!first) return 'New chat';
    const t = first.text.trim().replace(/\s+/g, ' ');
    return t.length > 40 ? t.slice(0, 40) + '…' : t;
  };

  return {
    // ---- current-conversation reads/writes ----
    entries: () => cur().entries,
    record: (e) => { cur().entries.push(e); touch(); persist(); },
    clear: () => { cur().entries = []; persist(); },

    sessionId: () => cur().sessionId,
    setSession: (id) => {
      const c = cur();
      const next = id || null;
      if (next === c.sessionId) return; // no-op write — resume id unchanged
      c.sessionId = next;
      persist();
    },

    // The current conversation's display title, and whether it already carries
    // an agent-generated one (so the client knows when to ask for it).
    title: () => titleOf(cur()),
    hasTitle: () => !!(cur() && cur().title),
    // Store an agent-generated title on a specific conversation (by id, since
    // generation is async and the open chat may change before it returns).
    setTitle: (id, title) => {
      const c = chats.find((x) => x.id === id) || cur();
      if (!c) return;
      const t = String(title || '').trim();
      c.title = t || null;
      persist();
    },

    // ---- multiple conversations ----
    currentId: () => currentId,
    // History summaries, most-recently-active first.
    chats: () =>
      chats
        .slice()
        .sort((a, b) => b.seq - a.seq)
        .map((c) => ({ id: c.id, title: titleOf(c), active: c.id === currentId, empty: c.entries.length === 0 })),
    // Start (and switch to) a fresh chat. Reuses the current one when it is
    // already blank, so repeated taps never stack empty conversations.
    newChat: () => {
      const c = cur();
      if (c && c.entries.length === 0) {
        currentId = c.id;
        touch();
        persist();
        return c.id;
      }
      idSeq += 1;
      const n = newConversation('chat-' + idSeq);
      chats.push(n);
      currentId = n.id;
      touch();
      persist();
      return n.id;
    },
    selectChat: (id) => {
      if (!chats.some((c) => c.id === id)) return false;
      currentId = id;
      touch(); // re-open bumps recency so the history list reflects last use
      persist();
      return true;
    },
    deleteChat: (id) => {
      const i = chats.findIndex((c) => c.id === id);
      if (i === -1) return;
      chats.splice(i, 1);
      if (currentId === id) {
        const next = chats.slice().sort((a, b) => b.seq - a.seq)[0];
        currentId = next ? next.id : null;
        ensure(); // never leave the tab without a conversation to type into
      }
      persist();
    },

    // Sticky agent posture (Claude-Code-style). `mode()` reads it; `cycleMode()`
    // flips discuss⇄apply (Shift+Tab) and persists, returning the new mode.
    mode: () => mode,
    cycleMode: () => {
      mode = mode === APPLY ? DISCUSS : APPLY;
      persist();
      return mode;
    },

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
    // The mode for the next send. Sticky — no per-turn reset (the cycle owns it).
    takeMode: () => mode,
  };
};
