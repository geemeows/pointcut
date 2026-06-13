/* eslint-disable */
// Run: node --test vite/design-toolbar/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from './queue.mjs';

const fakeStorage = (seed) => {
  const map = new Map(seed ? [['k', JSON.stringify(seed)]] : []);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    _raw: () => map.get('k'),
    _sel: () => map.get('sel'),
  };
};

const opts = (storage) => ({ storage, storageKey: 'k', selectionKey: 'sel', defaultType: 'layout' });

test('loads existing items from storage', () => {
  const Q = createQueue(opts(fakeStorage([{ id: 'a1', type: 'color', comment: 'x' }])));
  assert.equal(Q.count(), 1);
  assert.equal(Q.get('a1').comment, 'x');
});

test('corrupt storage falls back to empty', () => {
  const s = fakeStorage();
  s.setItem('k', '{not json');
  const Q = createQueue(opts(s));
  assert.equal(Q.count(), 0);
});

test('backfills missing id and type, then persists once', () => {
  const s = fakeStorage([{ comment: 'legacy' }]);
  const Q = createQueue(opts(s));
  const item = Q.all()[0];
  assert.ok(item.id, 'id backfilled');
  assert.equal(item.type, 'layout', 'type backfilled to default');
  assert.match(s._raw(), /"type":"layout"/, 'backfill was persisted');
});

test('add appends and persists', () => {
  const s = fakeStorage();
  const Q = createQueue(opts(s));
  Q.add({ id: 'a1', type: 'color', comment: 'hi' });
  assert.equal(Q.count(), 1);
  assert.match(s._raw(), /"a1"/);
});

test('remove drops by id and persists', () => {
  const s = fakeStorage([{ id: 'a1' }, { id: 'a2' }]);
  const Q = createQueue(opts(s));
  Q.remove('a1');
  assert.deepEqual(Q.all().map((a) => a.id), ['a2']);
  assert.ok(!s._raw().includes('a1'));
});

test('removeMany accepts a Set or array', () => {
  const Q = createQueue(opts(fakeStorage([{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }])));
  Q.removeMany(new Set(['a1', 'a3']));
  assert.deepEqual(Q.all().map((a) => a.id), ['a2']);
});

test('clear empties and persists', () => {
  const s = fakeStorage([{ id: 'a1' }]);
  const Q = createQueue(opts(s));
  Q.clear();
  assert.equal(Q.count(), 0);
  assert.equal(s._raw(), '[]');
});

test('newId is unique within a session', () => {
  const Q = createQueue(opts(fakeStorage()));
  assert.notEqual(Q.newId(), Q.newId());
});

// ---- Selection (0008) ------------------------------------------------------

test('selection defaults to all items when never persisted', () => {
  const Q = createQueue(opts(fakeStorage([{ id: 'a1' }, { id: 'a2' }])));
  assert.ok(Q.isSelected('a1'));
  assert.ok(Q.isSelected('a2'));
  assert.deepEqual(Q.selectedItems().map((a) => a.id), ['a1', 'a2']);
});

test('persisted selection is authoritative (even when empty)', () => {
  const s = fakeStorage([{ id: 'a1' }, { id: 'a2' }]);
  s.setItem('sel', '[]');
  const Q = createQueue(opts(s));
  assert.ok(!Q.isSelected('a1'));
  assert.equal(Q.selectedItems().length, 0);
});

test('setSelected toggles membership and persists', () => {
  const s = fakeStorage([{ id: 'a1' }, { id: 'a2' }]);
  const Q = createQueue(opts(s));
  Q.setSelected('a1', false);
  assert.ok(!Q.isSelected('a1'));
  assert.deepEqual(Q.selectedItems().map((a) => a.id), ['a2']);
  assert.ok(!s._sel().includes('a1'));
  Q.setSelected('a1', true);
  assert.ok(Q.isSelected('a1'));
});

test('selectedItems preserves queue order', () => {
  const Q = createQueue(opts(fakeStorage([{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }])));
  Q.setSelected('a2', false);
  assert.deepEqual(Q.selectedItems().map((a) => a.id), ['a1', 'a3']);
});

test('added items are selected by default', () => {
  const s = fakeStorage([{ id: 'a1' }]);
  s.setItem('sel', '["a1"]');
  const Q = createQueue(opts(s));
  Q.add({ id: 'a2', type: 'color' });
  assert.ok(Q.isSelected('a2'));
});

test('removed items drop from selection', () => {
  const Q = createQueue(opts(fakeStorage([{ id: 'a1' }, { id: 'a2' }])));
  Q.remove('a1');
  assert.ok(!Q.isSelected('a1'));
  assert.deepEqual(Q.selectedItems().map((a) => a.id), ['a2']);
  Q.removeMany(['a2']);
  assert.equal(Q.selectedItems().length, 0);
});

test('selectAll and selectNone flip the whole queue', () => {
  const Q = createQueue(opts(fakeStorage([{ id: 'a1' }, { id: 'a2' }])));
  Q.selectNone();
  assert.equal(Q.selectedItems().length, 0);
  Q.selectAll();
  assert.deepEqual(Q.selectedItems().map((a) => a.id), ['a1', 'a2']);
});

test('clear empties the selection too', () => {
  const Q = createQueue(opts(fakeStorage([{ id: 'a1' }])));
  Q.clear();
  assert.equal(Q.selectedItems().length, 0);
});
