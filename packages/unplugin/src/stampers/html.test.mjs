// Run: node --import tsx --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHtmlStamper, LOC_ATTR } from './html.ts';

const ROOT = '/project';
const stamp = (code, file = '/project/public/index.html') =>
  createHtmlStamper(ROOT).transform(code, file);

test('test() owns app .html files, not node_modules or other extensions', () => {
  const s = createHtmlStamper(ROOT);
  assert.equal(s.test('/project/public/index.html'), true);
  assert.equal(s.test('/project/public/index.html?raw'), true);
  assert.equal(s.test('/project/node_modules/lib/x.html'), false);
  assert.equal(s.test('/project/src/main.js'), false);
});

test('stamps an opening tag with the correct file:line:col', () => {
  const code = '<body>\n  <button>Go</button>\n</body>\n';
  const out = stamp(code);
  // The <button> sits on line 2, col 3 (1-based col after the leading newline).
  assert.match(out.code, new RegExp(`<button ${LOC_ATTR}="public/index\\.html:2:3">`));
});

test('stamps every rendered opening tag and leaves closing tags alone', () => {
  const code = '<body>\n  <div><span>x</span></div>\n</body>\n';
  const out = stamp(code);
  const opens = out.code.match(new RegExp(LOC_ATTR, 'g')) || [];
  assert.equal(opens.length, 3); // <body>, <div>, <span> — not the closing tags
});

test('preserves existing attributes', () => {
  const code = '<body>\n  <a href="/x" class="c">y</a>\n</body>\n';
  const out = stamp(code);
  assert.match(out.code, new RegExp(`<a href="/x" class="c" ${LOC_ATTR}="[^"]+">`));
});

test('stamps self-closing tags before the slash', () => {
  const code = '<body>\n  <img src="a.png"/>\n</body>\n';
  const out = stamp(code);
  assert.match(out.code, new RegExp(`<img src="a\\.png" ${LOC_ATTR}="[^"]+"/>`));
});

test('skips document scaffolding and non-rendered tags', () => {
  const code =
    '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>T</title>\n    <link rel="icon" href="f.ico" />\n    <script src="/m.js"></script>\n    <style>.a{}</style>\n  </head>\n  <body>\n    <p>hi</p>\n  </body>\n</html>\n';
  const out = stamp(code);
  // Only <body> and <p> are DOM-output element tags worth a stamp.
  const opens = out.code.match(new RegExp(LOC_ATTR, 'g')) || [];
  assert.equal(opens.length, 2);
  for (const skipped of ['html', 'head', 'meta', 'title', 'link', 'script', 'style']) {
    assert.doesNotMatch(out.code, new RegExp(`<${skipped}[^>]*${LOC_ATTR}`));
  }
});

test('leaves script/style contents untouched', () => {
  const code = '<body>\n  <script>const a = "<div>";</script>\n  <p>x</p>\n</body>\n';
  const out = stamp(code);
  // The string literal inside <script> must survive verbatim.
  assert.match(out.code, /const a = "<div>";/);
});

test('is idempotent — a second pass changes nothing', () => {
  const code = '<body>\n  <div><span>x</span></div>\n</body>\n';
  const once = stamp(code).code;
  const twice = stamp(once);
  assert.equal(twice, null, 'already-stamped tags are skipped, so nothing to stamp');
});

test('returns null when there are no stampable tags', () => {
  assert.equal(stamp('<!doctype html>\n<html><head><title>t</title></head></html>\n'), null);
});

test('emits a source map with mappings and the original source', () => {
  const code = '<body>\n  <button>Go</button>\n</body>\n';
  const out = stamp(code);
  assert.ok(out.map, 'a map is returned');
  assert.ok(out.map.mappings && out.map.mappings.length > 0, 'map has mappings');
  assert.equal(out.map.version, 3);
  assert.deepEqual(out.map.sourcesContent, [code]);
});
