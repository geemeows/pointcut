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

test('fresh chat: empty transcript, no session, mode defaults to discuss', () => {
  const chat = createChat({ storage: fakeStorage(), storageKey: KEY });
  assert.deepEqual(chat.entries(), []);
  assert.equal(chat.sessionId(), null);
  assert.equal(chat.mode(), 'discuss');
  assert.equal(chat.takeMode(), 'discuss');
});

test('cycleMode flips discuss⇄apply and stays sticky across sends', () => {
  const chat = createChat({ storage: fakeStorage(), storageKey: KEY });
  assert.equal(chat.cycleMode(), 'apply'); // discuss → apply
  assert.equal(chat.mode(), 'apply');
  assert.equal(chat.takeMode(), 'apply'); // does NOT reset after a send
  assert.equal(chat.takeMode(), 'apply'); // still apply on the next turn
  assert.equal(chat.cycleMode(), 'discuss'); // apply → discuss
  assert.equal(chat.takeMode(), 'discuss');
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

test('mode is sticky — persisted across a reload', () => {
  const storage = fakeStorage();
  createChat({ storage, storageKey: KEY }).cycleMode(); // discuss → apply
  assert.equal(createChat({ storage, storageKey: KEY }).mode(), 'apply');
});

test('corrupt storage falls back to safe defaults', () => {
  const chat = createChat({ storage: fakeStorage({ [KEY]: '{not json' }), storageKey: KEY });
  assert.deepEqual(chat.entries(), []);
  assert.equal(chat.sessionId(), null);
});

// ---- Multiple conversations — new chat / switch / delete -------------------

test('fresh chat exposes a single active conversation', () => {
  const chat = createChat({ storage: fakeStorage(), storageKey: KEY });
  const list = chat.chats();
  assert.equal(list.length, 1);
  assert.equal(list[0].active, true);
  assert.equal(list[0].title, 'New chat');
  assert.equal(chat.currentId(), list[0].id);
});

test('newChat starts a separate transcript + session, leaving the old intact', () => {
  const chat = createChat({ storage: fakeStorage(), storageKey: KEY });
  chat.record({ k: 'you', text: 'first thread' });
  chat.setSession('sess-a');
  const first = chat.currentId();

  const second = chat.newChat();
  assert.notEqual(second, first);
  assert.deepEqual(chat.entries(), []); // fresh chat is empty
  assert.equal(chat.sessionId(), null); // and has its own (no) session

  chat.selectChat(first);
  assert.deepEqual(chat.entries(), [{ k: 'you', text: 'first thread' }]);
  assert.equal(chat.sessionId(), 'sess-a');
});

test('newChat reuses the current conversation when it is already blank', () => {
  const chat = createChat({ storage: fakeStorage(), storageKey: KEY });
  const id = chat.currentId();
  assert.equal(chat.newChat(), id); // no stacking of empty chats
  assert.equal(chat.chats().length, 1);
});

test('chats() lists most-recently-active first', () => {
  const chat = createChat({ storage: fakeStorage(), storageKey: KEY });
  chat.record({ k: 'you', text: 'one' });
  const a = chat.currentId();
  const b = chat.newChat();
  chat.record({ k: 'you', text: 'two' });
  assert.deepEqual(chat.chats().map((c) => c.id), [b, a]); // b most recent
  chat.selectChat(a); // re-opening bumps recency
  assert.deepEqual(chat.chats().map((c) => c.id), [a, b]);
});

test('conversations persist and restore across a reload', () => {
  const storage = fakeStorage();
  const chat = createChat({ storage, storageKey: KEY });
  chat.record({ k: 'you', text: 'alpha' });
  const a = chat.currentId();
  chat.newChat();
  chat.record({ k: 'you', text: 'beta' });
  const b = chat.currentId();

  const reloaded = createChat({ storage, storageKey: KEY });
  assert.equal(reloaded.currentId(), b); // open chat restored
  assert.deepEqual(reloaded.chats().map((c) => c.id).sort(), [a, b].sort());
  reloaded.selectChat(a);
  assert.deepEqual(reloaded.entries(), [{ k: 'you', text: 'alpha' }]);
});

test('deleteChat removes a conversation and falls back to the most recent', () => {
  const chat = createChat({ storage: fakeStorage(), storageKey: KEY });
  chat.record({ k: 'you', text: 'keep' });
  const a = chat.currentId();
  const b = chat.newChat();
  chat.record({ k: 'you', text: 'drop' });
  chat.deleteChat(b); // delete the open one
  assert.equal(chat.currentId(), a);
  assert.deepEqual(chat.chats().map((c) => c.id), [a]);
});

test('deleting the last conversation leaves a fresh empty one', () => {
  const chat = createChat({ storage: fakeStorage(), storageKey: KEY });
  chat.record({ k: 'you', text: 'only' });
  chat.deleteChat(chat.currentId());
  assert.equal(chat.chats().length, 1);
  assert.deepEqual(chat.entries(), []);
});

test('legacy single-chat storage (v1) migrates into one conversation', () => {
  const storage = fakeStorage({
    [KEY]: JSON.stringify({ sessionId: 'old-sess', entries: [{ k: 'you', text: 'legacy' }] }),
  });
  const chat = createChat({ storage, storageKey: KEY });
  assert.equal(chat.chats().length, 1);
  assert.equal(chat.sessionId(), 'old-sess');
  assert.deepEqual(chat.entries(), [{ k: 'you', text: 'legacy' }]);
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
