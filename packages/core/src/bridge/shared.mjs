// @pointcut/core — shared Bridge helpers.
//
// Small bundler-free utilities the Bridge endpoints lean on: a PATH probe for
// agent-probe (is this Driver's CLI installed?) and a JSON request-body reader
// for agent-run. Kept separate from the endpoints so each is unit-testable in
// isolation.
import { spawn } from 'node:child_process';

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
