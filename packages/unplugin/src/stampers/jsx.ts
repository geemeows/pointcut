// JSX/TSX Source Stamp — the React (and any JSX) implementation of Stamper.
//
// Where the Vue stamper can lean on a string grammar (magic-string + regex over
// raw SFC text), JSX cannot: it is a real expression language interleaved with
// host markup, so a regex can't tell a host tag from a component call or know
// where a tag's attribute list ends. We therefore parse to a Babel AST, walk
// the JSXOpeningElements, and stamp `data-pointcut-loc="file:line:col"` from the
// node's ORIGINAL source loc — which is correct precisely because we run before
// the framework JSX transform (the owning unplugin's `enforce: 'pre'`).
//
// HOST-ONLY rule: we stamp lowercase intrinsic tags (<div>, <button>) only. An
// attribute on a Component (<MyButton/>, <Foo.Bar/>) is a *prop* that may never
// reach the DOM, so stamping it is both useless and potentially breaking. Clicks
// on a component's rendered output resolve to the nearest stamped host via the
// client's Locator — the same "usage site, not internals" stance as Vue.
import path from 'node:path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import * as t from '@babel/types';
import { LOC_ATTR, encodeLoc } from '@pointcut/core';
import type { Stamper } from '../index';

// @babel/traverse and /generator ship a CJS default that interop-wraps under
// ESM as `{ default: fn }`; unwrap so this works built (tsup→esm) and under tsx.
const traverse = (_traverse as unknown as { default?: typeof _traverse }).default ?? _traverse;
const generate = (_generate as unknown as { default?: typeof _generate }).default ?? _generate;

// The Source Stamp wire-format contract — attribute name + encoder — lives once
// in @pointcut/core (./loc.mjs). Re-export LOC_ATTR so test/consumer imports of
// it from this module keep working.
export { LOC_ATTR } from '@pointcut/core';

// A JSX tag is a host element iff its name is a plain lowercase identifier
// (`div`, `button`, `my-widget`). Uppercase (`Foo`) is a component reference and
// member/namespaced names (`Foo.Bar`, `svg:rect`) are never intrinsic hosts.
function isHostElement(name: t.JSXOpeningElement['name']): boolean {
  if (!t.isJSXIdentifier(name)) return false; // JSXMemberExpression / JSXNamespacedName
  const first = name.name.charCodeAt(0);
  return first >= 97 && first <= 122; // a–z
}

/** Build the JSX Stamper. `root` is the project root locs are made relative to. */
export function createJsxStamper(root: string = process.cwd()): Stamper {
  return {
    // App .jsx/.tsx source only (strip any query); never node_modules.
    test(id) {
      const file = id.split('?')[0] ?? id;
      return (
        (file.endsWith('.jsx') || file.endsWith('.tsx')) && !file.includes('node_modules')
      );
    },

    transform(code, id) {
      const file = id.split('?')[0] ?? id;
      const rel = path.relative(root, file);

      const ast = parse(code, {
        sourceType: 'module',
        // jsx for the markup; typescript so .tsx (and TS syntax in .jsx) parses.
        plugins: ['jsx', 'typescript'],
        errorRecovery: true,
      });

      let stamped = 0;
      traverse(ast, {
        JSXOpeningElement(p) {
          const node = p.node;
          if (!isHostElement(node.name)) return; // skip Component / member tags
          // Idempotency: never double-stamp (e.g. a second transform pass).
          const already = node.attributes.some(
            (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === LOC_ATTR,
          );
          if (already) return;
          // Babel loc is 1-based line, 0-based column; the Vue stamper emits a
          // 1-based column (col after the leading newline), so +1 to match.
          if (!node.loc) return;
          const line = node.loc.start.line;
          const col = node.loc.start.column + 1;
          const loc = encodeLoc({ file: rel, line, col });
          node.attributes.push(
            t.jsxAttribute(t.jsxIdentifier(LOC_ATTR), t.stringLiteral(loc)),
          );
          stamped++;
        },
      });

      if (!stamped) return null; // nothing stamped — leave the module untouched

      const out = generate(
        ast,
        { sourceMaps: true, sourceFileName: id, retainLines: true },
        code,
      );
      return { code: out.code, map: out.map };
    },
  };
}
