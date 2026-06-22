/* eslint-disable */
// Run: node --import tsx --test src/models/format.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { relTime, KBD, cleanTitle } from './format.mjs';

const NOW = 1_000_000_000_000;
const ago = (ms) => NOW - ms;

describe('relTime', () => {
  test('empty for a falsy timestamp (legacy record)', () => {
    assert.equal(relTime(0, NOW), '');
    assert.equal(relTime(undefined, NOW), '');
  });
  test('"just now" under 45s', () => {
    assert.equal(relTime(ago(10_000), NOW), 'just now');
    assert.equal(relTime(ago(44_000), NOW), 'just now');
  });
  test('minutes', () => {
    assert.equal(relTime(ago(5 * 60_000), NOW), '5m ago');
  });
  test('hours', () => {
    assert.equal(relTime(ago(3 * 3_600_000), NOW), '3h ago');
    assert.equal(relTime(ago(21 * 3_600_000), NOW), '21h ago');
  });
  test('days', () => {
    assert.equal(relTime(ago(2 * 86_400_000), NOW), '2d ago');
  });
  test('weeks', () => {
    assert.equal(relTime(ago(21 * 86_400_000), NOW), '3w ago');
  });
});

describe('KBD', () => {
  test('Option symbol on Mac', () => {
    assert.equal(KBD('C', true), '⌥C');
  });
  test('Alt+ elsewhere', () => {
    assert.equal(KBD('C', false), 'Alt+C');
  });
});

describe('cleanTitle', () => {
  test('first line only', () => {
    assert.equal(cleanTitle('Fix the header\nand more'), 'Fix the header');
  });
  test('strips wrapping quotes/backticks/asterisks and trailing punctuation', () => {
    assert.equal(cleanTitle('"**Refactor the navbar.**"'), 'Refactor the navbar');
    assert.equal(cleanTitle('`hello`'), 'hello');
  });
  test('collapses internal whitespace', () => {
    assert.equal(cleanTitle('a    b   c'), 'a b c');
  });
  test('ellipsises past 48 chars', () => {
    const long = 'x'.repeat(60);
    const out = cleanTitle(long);
    assert.equal(out.length, 49); // 48 + ellipsis
    assert.ok(out.endsWith('…'));
  });
  test('empty / nullish in → empty out', () => {
    assert.equal(cleanTitle(null), '');
    assert.equal(cleanTitle(''), '');
    assert.equal(cleanTitle('   '), '');
  });
});
