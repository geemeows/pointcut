/* eslint-disable */
// Run: node --test packages/core/src/bridge/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeShots, cleanupShots } from './shared.mjs';

const PNG = 'data:image/png;base64,' + Buffer.from('fake-png').toString('base64');

test('writeShots decodes PNG data-URLs into temp files, skipping non-PNG', async () => {
  const written = [];
  const result = await writeShots([PNG, 'not-a-data-url', PNG], {
    dir: '/tmp/fake',
    writeFile: async (file, buf) => {
      written.push([file, buf.toString()]);
    },
  });
  assert.deepEqual(result.shots, [
    { n: 1, file: '/tmp/fake/shot-1.png' },
    { n: 3, file: '/tmp/fake/shot-3.png' }, // index 2 (the non-data-url) skipped
  ]);
  assert.deepEqual(result.files, ['/tmp/fake/shot-1.png', '/tmp/fake/shot-3.png']);
  assert.deepEqual(written.map((w) => w[1]), ['fake-png', 'fake-png']);
});

test('writeShots tolerates a missing/empty images list', async () => {
  const result = await writeShots(undefined, { dir: '/tmp/fake', writeFile: async () => {} });
  assert.deepEqual(result.shots, []);
  assert.deepEqual(result.files, []);
});

test('cleanupShots removes every temp file and the dir, and never throws', async () => {
  const removed = [];
  await cleanupShots(
    { dir: '/tmp/fake', files: ['/tmp/fake/shot-1.png', '/tmp/fake/shot-3.png'] },
    {
      rm: async (p) => {
        if (p === '/tmp/fake/shot-1.png') throw new Error('boom'); // best-effort: swallowed
        removed.push(p);
      },
    },
  );
  // The first file threw (swallowed); the second file + the dir were removed.
  assert.deepEqual(removed, ['/tmp/fake/shot-3.png', '/tmp/fake']);
});
