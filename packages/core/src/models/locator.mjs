/* eslint-disable */
// Design Toolbar — Locator (see ../design-toolbar-plugin.js).
//
// Re-finds the live DOM element for an Annotation, surviving reloads. The
// Source Stamp (data-luciq-loc) alone isn't unique — a v-for or a re-used
// component shares one loc — so the primary key is a structural child-index
// path replayed from <body> down; the loc is only a fallback. Resolved elements
// are cached (the cache is dropped on reload). This is the most bug-prone piece
// of the toolbar, so it lives behind a small interface with `doc`/`win`
// injected — feed it a fake document/window to unit-test the resolution rules.
export const createLocator = ({ doc, win, locAttr }) => {
  const refs = new Map(); // annotation id -> live element

  // child indices from <body> down to the element.
  const indexPath = (el) => {
    const path = [];
    let n = el;
    while (n && n.parentElement && n !== doc.body) {
      path.unshift(Array.prototype.indexOf.call(n.parentElement.children, n));
      n = n.parentElement;
    }
    return path;
  };

  const elFromPath = (path) => {
    let n = doc.body;
    for (let i = 0; i < path.length; i++) {
      n = n && n.children[path[i]];
      if (!n) return null;
    }
    return n || null;
  };

  // Nearest ancestor (or self) carrying a Source Stamp — the spot to edit.
  const stampedAncestor = (el) => {
    let n = el;
    while (n && n.nodeType === 1) {
      if (n.getAttribute && n.getAttribute(locAttr)) return n;
      n = n.parentElement;
    }
    return el;
  };

  // Resolve an Annotation to its live element: cache → structural path → loc.
  const resolve = (a) => {
    const ref = refs.get(a.id);
    if (ref && ref.isConnected) return ref;
    let found = a.path ? elFromPath(a.path) : null;
    if ((!found || !found.isConnected) && a.loc) {
      found = doc.querySelector(`[${locAttr}="${win.CSS.escape(a.loc)}"]`);
    }
    if (found) {
      refs.set(a.id, found);
      return found;
    }
    return null;
  };

  // Current viewport rect: regions use page coords; elements use the live rect.
  const rectFor = (a) => {
    if (a.region) {
      return {
        left: a.region.x - win.scrollX,
        top: a.region.y - win.scrollY,
        right: a.region.x - win.scrollX + a.region.w,
        bottom: a.region.y - win.scrollY + a.region.h,
      };
    }
    const el = resolve(a);
    return el ? el.getBoundingClientRect() : null;
  };

  return {
    remember: (id, el) => refs.set(id, el),
    forget: (id) => refs.delete(id),
    clear: () => refs.clear(),
    indexPath,
    stampedAncestor,
    resolve,
    rectFor,
  };
};
