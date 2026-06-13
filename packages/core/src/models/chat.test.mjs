/* eslint-disable */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChat } from './chat.mjs';

// A minimal localStorage stand-in (the model only needs get/set).
const fakeStorage = (seed) => {
  const map = new Map(Object.entries(seed || {}));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
};

const KEY = 'luciq-design-chat';

test('fresh chat: empty transcript, no session, apply OFF → discuss', () => {
  const chat = createChat({ storage: fakeStorage(), storageKey: KEY });
  assert.deepEqual(chat.entries(), []);
  assert.equal(chat.sessionId(), null);
  assert.equal(chat.applyOn(), false);
  assert.equal(chat.takeMode(), 'discuss');
});

test('Apply ON makes one turn apply-once, then resets to OFF (D16)', () => {
  const chat = createChat({ storage: fakeStorage(), storageKey: KEY });
  chat.setApply(true);
  assert.equal(chat.applyOn(), true);
  assert.equal(chat.takeMode(), 'apply-once'); // consumes the toggle
  assert.equal(chat.applyOn(), false); // returns to OFF after the turn
  assert.equal(chat.takeMode(), 'discuss'); // next turn is back to discuss
});

test('record + setSession persist and restore across a reload', () => {
  const storage = fakeStorage();
  const chat = createChat({ storage, storageKey: KEY });
  chat.record({ k: 'you', text: 'why is this red?' });
  chat.record({ k: 'text', text: 'it uses the danger token' });
  chat.setSession('sess-123');

  const reloaded = createChat({ storage, storageKey: KEY });
  assert.equal(reloaded.sessionId(), 'sess-123');
  assert.deepEqual(reloaded.entries(), [
    { k: 'you', text: 'why is this red?' },
    { k: 'text', text: 'it uses the danger token' },
  ]);
});

test('setSession is idempotent — same id does not rewrite storage', () => {
  let writes = 0;
  const base = fakeStorage();
  const storage = { ...base, setItem: (k, v) => { writes++; base.setItem(k, v); } };
  const chat = createChat({ storage, storageKey: KEY });
  chat.setSession('a');
  const after = writes;
  chat.setSession('a'); // unchanged
  assert.equal(writes, after);
});

test('setSession(null) clears the resume id', () => {
  const storage = fakeStorage();
  const chat = createChat({ storage, storageKey: KEY });
  chat.setSession('a');
  chat.setSession(null);
  assert.equal(chat.sessionId(), null);
  assert.equal(createChat({ storage, storageKey: KEY }).sessionId(), null);
});

test('clear() empties the transcript and persists', () => {
  const storage = fakeStorage();
  const chat = createChat({ storage, storageKey: KEY });
  chat.record({ k: 'you', text: 'hi' });
  chat.clear();
  assert.deepEqual(chat.entries(), []);
  assert.deepEqual(createChat({ storage, storageKey: KEY }).entries(), []);
});

test('apply toggle is ephemeral — never persisted across reload', () => {
  const storage = fakeStorage();
  createChat({ storage, storageKey: KEY }).setApply(true);
  assert.equal(createChat({ storage, storageKey: KEY }).applyOn(), false);
});

test('corrupt storage falls back to safe defaults', () => {
  const chat = createChat({ storage: fakeStorage({ [KEY]: '{not json' }), storageKey: KEY });
  assert.deepEqual(chat.entries(), []);
  assert.equal(chat.sessionId(), null);
});

// ---- Context chips (0011) — per-turn element attachments -------------------

test('fresh chat has no context chips', () => {
  const chat = createChat({ storage: fakeStorage(), storageKey: KEY });
  assert.deepEqual(chat.chips(), []);
});

test('addChip stores the chip, stamps a unique id, and returns it', () => {
  const chat = createChat({ storage: fakeStorage(), storageKey: KEY });
  const a = chat.addChip({ label: 'button.primary', loc: 'App.vue:3:1' });
  const b = chat.addChip({ label: 'div.card', loc: 'App.vue:9:1' });
  assert.ok(a.id && b.id && a.id !== b.id); // unique ids
  assert.equal(a.label, 'button.primary');
  assert.deepEqual(chat.chips().map((c) => c.label), ['button.primary', 'div.card']);
});

test('removeChip drops one chip by id, leaving the rest', () => {
  const chat = createChat({ storage: fakeStorage(), storageKey: KEY });
  const a = chat.addChip({ label: 'a' });
  const b = chat.addChip({ label: 'b' });
  chat.removeChip(a.id);
  assert.deepEqual(chat.chips().map((c) => c.id), [b.id]);
});

test('clearChips empties the per-turn attachments', () => {
  const chat = createChat({ storage: fakeStorage(), storageKey: KEY });
  chat.addChip({ label: 'a' });
  chat.addChip({ label: 'b' });
  chat.clearChips();
  assert.deepEqual(chat.chips(), []);
});

test('chips() returns a copy — mutating it does not affect the model', () => {
  const chat = createChat({ storage: fakeStorage(), storageKey: KEY });
  chat.addChip({ label: 'a' });
  chat.chips().push({ label: 'sneaky' });
  assert.equal(chat.chips().length, 1);
});

test('chips are ephemeral — never persisted across a reload', () => {
  const storage = fakeStorage();
  createChat({ storage, storageKey: KEY }).addChip({ label: 'a' });
  assert.deepEqual(createChat({ storage, storageKey: KEY }).chips(), []);
});
