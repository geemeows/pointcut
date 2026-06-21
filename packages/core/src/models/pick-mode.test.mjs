/* eslint-disable */
// Run: node --import tsx --test src/models/pick-mode.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { initialPickState, marqueeRect, reducePickMode } from './pick-mode.mjs';

const T = 6; // matches the client's DRAG_THRESHOLD

describe('marqueeRect', () => {
  test('spans two points regardless of order', () => {
    assert.deepEqual(marqueeRect({ x: 10, y: 20 }, { x: 30, y: 5 }), {
      left: 10, top: 5, width: 20, height: 15,
    });
  });
});

describe('reducePickMode — down', () => {
  test('arms a drag start when picking and not on own UI', () => {
    const { state } = reducePickMode(initialPickState(), { type: 'down', x: 5, y: 7, picking: true, onOwn: false });
    assert.deepEqual(state.dragStart, { x: 5, y: 7 });
    assert.equal(state.dragging, false);
  });

  test('ignored when not picking', () => {
    const s0 = initialPickState();
    const { state } = reducePickMode(s0, { type: 'down', x: 5, y: 7, picking: false, onOwn: false });
    assert.equal(state.dragStart, null);
  });

  test('ignored when the press lands on own UI', () => {
    const { state } = reducePickMode(initialPickState(), { type: 'down', x: 5, y: 7, picking: true, onOwn: true });
    assert.equal(state.dragStart, null);
  });
});

describe('reducePickMode — move', () => {
  test('with no drag start, requests a hover outline', () => {
    const { state, effect } = reducePickMode(initialPickState(), { type: 'move', x: 50, y: 50, picking: true, threshold: T });
    assert.equal(effect.kind, 'hover');
    assert.equal(state.dragging, false);
  });

  test('small movement below threshold stays a hover (not yet a drag)', () => {
    let s = reducePickMode(initialPickState(), { type: 'down', x: 0, y: 0, picking: true, onOwn: false }).state;
    const { state, effect } = reducePickMode(s, { type: 'move', x: 3, y: 3, picking: true, threshold: T });
    assert.equal(state.dragging, false);
    assert.equal(effect.kind, 'hover');
  });

  test('movement past threshold flips to dragging and emits the live marquee rect', () => {
    let s = reducePickMode(initialPickState(), { type: 'down', x: 0, y: 0, picking: true, onOwn: false }).state;
    const { state, effect } = reducePickMode(s, { type: 'move', x: 10, y: 0, picking: true, threshold: T });
    assert.equal(state.dragging, true);
    assert.equal(effect.kind, 'marquee');
    assert.deepEqual(effect.rect, { left: 0, top: 0, width: 10, height: 0 });
  });

  test('once dragging, subsequent moves keep emitting the rect', () => {
    let s = reducePickMode(initialPickState(), { type: 'down', x: 0, y: 0, picking: true, onOwn: false }).state;
    s = reducePickMode(s, { type: 'move', x: 10, y: 0, picking: true, threshold: T }).state;
    const { effect } = reducePickMode(s, { type: 'move', x: 20, y: 30, picking: true, threshold: T });
    assert.equal(effect.kind, 'marquee');
    assert.deepEqual(effect.rect, { left: 0, top: 0, width: 20, height: 30 });
  });

  test('ignored when not picking', () => {
    const s0 = initialPickState();
    const { state, effect } = reducePickMode(s0, { type: 'move', x: 1, y: 1, picking: false, threshold: T });
    assert.equal(effect.kind, 'none');
    assert.equal(state, s0);
  });
});

describe('reducePickMode — up', () => {
  test('a drag release in comment mode yields a region rect and flags justDragged', () => {
    let s = reducePickMode(initialPickState(), { type: 'down', x: 0, y: 0, picking: true, onOwn: false }).state;
    s = reducePickMode(s, { type: 'move', x: 40, y: 20, picking: true, threshold: T }).state;
    const { state, effect } = reducePickMode(s, { type: 'up', x: 40, y: 20, picking: true, pickMode: 'comment' });
    assert.equal(effect.kind, 'region');
    assert.deepEqual(effect.rect, { left: 0, top: 0, width: 40, height: 20 });
    assert.equal(state.justDragged, true);
    assert.equal(state.dragStart, null);
    assert.equal(state.dragging, false);
  });

  test('a drag release in chat mode flags justDragged but yields NO region', () => {
    let s = reducePickMode(initialPickState(), { type: 'down', x: 0, y: 0, picking: true, onOwn: false }).state;
    s = reducePickMode(s, { type: 'move', x: 40, y: 20, picking: true, threshold: T }).state;
    const { state, effect } = reducePickMode(s, { type: 'up', x: 40, y: 20, picking: true, pickMode: 'chat' });
    assert.equal(effect.kind, 'none');
    assert.equal(state.justDragged, true);
  });

  test('a release without a drag (just a press) resets and does not flag justDragged', () => {
    let s = reducePickMode(initialPickState(), { type: 'down', x: 0, y: 0, picking: true, onOwn: false }).state;
    const { state, effect } = reducePickMode(s, { type: 'up', x: 1, y: 1, picking: true, pickMode: 'comment' });
    assert.equal(effect.kind, 'none');
    assert.equal(state.justDragged, false);
    assert.equal(state.dragStart, null);
  });

  test('ignored with no active press', () => {
    const s0 = initialPickState();
    const { state } = reducePickMode(s0, { type: 'up', x: 1, y: 1, picking: true, pickMode: 'comment' });
    assert.equal(state, s0);
  });
});

describe('reducePickMode — click', () => {
  test('a click right after a drag is suppressed and clears the flag', () => {
    const s = { dragStart: null, dragging: false, justDragged: true };
    const { state, effect } = reducePickMode(s, { type: 'click', picking: true });
    assert.equal(effect.kind, 'suppress');
    assert.equal(state.justDragged, false);
  });

  test('a normal click resolves to a pick', () => {
    const { effect } = reducePickMode(initialPickState(), { type: 'click', picking: true });
    assert.equal(effect.kind, 'click');
  });

  test('ignored when not picking', () => {
    const { effect } = reducePickMode(initialPickState(), { type: 'click', picking: false });
    assert.equal(effect.kind, 'none');
  });
});

describe('reducePickMode — full gestures', () => {
  test('press → click (no movement) is a pick', () => {
    let s = reducePickMode(initialPickState(), { type: 'down', x: 5, y: 5, picking: true, onOwn: false }).state;
    s = reducePickMode(s, { type: 'up', x: 5, y: 5, picking: true, pickMode: 'comment' }).state;
    const { effect } = reducePickMode(s, { type: 'click', picking: true });
    assert.equal(effect.kind, 'click');
  });

  test('press → drag → release → click is a region then a swallowed click', () => {
    let s = reducePickMode(initialPickState(), { type: 'down', x: 0, y: 0, picking: true, onOwn: false }).state;
    s = reducePickMode(s, { type: 'move', x: 30, y: 30, picking: true, threshold: T }).state;
    const up = reducePickMode(s, { type: 'up', x: 30, y: 30, picking: true, pickMode: 'comment' });
    assert.equal(up.effect.kind, 'region');
    const click = reducePickMode(up.state, { type: 'click', picking: true });
    assert.equal(click.effect.kind, 'suppress');
    // the NEXT click is a real pick again
    const click2 = reducePickMode(click.state, { type: 'click', picking: true });
    assert.equal(click2.effect.kind, 'click');
  });
});
