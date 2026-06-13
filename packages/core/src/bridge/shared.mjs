// @pointcut/core — shared Bridge helpers.
//
// Small bundler-free utilities the Bridge endpoints lean on: a PATH probe for
// agent-probe (is this Driver's CLI installed?), a JSON request-body reader for
// agent-run, and a screenshot data-URL → temp PNG decoder. Kept separate from
// the endpoints so each is unit-testable in isolation.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

// Is a command resolvable on PATH? We shell out to the platform's locator
// (`which` on POSIX, `where` on Windows) rather than re-implementing PATHEXT
// resolution. Resolves true/false, never rejects — a missing locator or a spawn
// error just means "not found" so a probe failure never crashes the Bridge.
export const commandOnPath = (command) =>
  new Promise((resolve) => {
    const locator = process.platform === 'win32' ? 'where' : 'which';
    let done = false;
    const finish = (ok) => {
      if (!done) {
        done = true;
        resolve(ok);
      }
    };
    try {
      const child = spawn(locator, [command], { stdio: 'ignore' });
      child.on('error', () => finish(false));
      child.on('close', (code) => finish(code === 0));
    } catch (_) {
      finish(false);
    }
  });

// Read a request's JSON body. Resolves the parsed object, or rejects on invalid
// JSON. Tolerates an empty body by resolving to {}.
export const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('error', reject);
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
  });

// Decode the toolbar's screenshot data-URLs into temp PNG files the agent CLI
// can read. Each image is `data:image/png;base64,<…>`; non-PNG / malformed
// entries are skipped. Returns the written files as { n, file } (1-based item
// index) plus the flat list of paths for cleanup. `writeFile`/`tmpdir` are
// injectable so tests assert the cleanup contract without touching disk.
export async function writeShots(images, { writeFile = fs.writeFile, dir } = {}) {
  const base = dir || (await fs.mkdtemp(path.join(os.tmpdir(), 'pointcut-')));
  const shots = [];
  const files = [];
  const list = Array.isArray(images) ? images : [];
  for (let i = 0; i < list.length; i++) {
    const url = list[i];
    if (typeof url !== 'string') continue;
    const m = url.match(/^data:image\/png;base64,(.+)$/);
    if (!m) continue;
    const file = path.join(base, `shot-${i + 1}.png`);
    await writeFile(file, Buffer.from(m[1], 'base64'));
    shots.push({ n: i + 1, file });
    files.push(file);
  }
  return { dir: base, shots, files };
}

// Remove temp PNGs (and the temp dir, if we own it). Never rejects — cleanup on
// a disconnect path must not throw. `rm`/`rmdir` injectable for tests.
export async function cleanupShots({ dir, files }, { rm = fs.rm } = {}) {
  for (const file of files || []) {
    try {
      await rm(file, { force: true });
    } catch (_) {
      /* best-effort */
    }
  }
  if (dir) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (_) {
      /* best-effort */
    }
  }
}
