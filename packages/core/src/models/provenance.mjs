/* eslint-disable */
// Pointcut — style provenance walker (ADR 0001).
//
// The Source Stamp (data-pointcut-loc) points at the template tag, not where the
// style is actually declared, so patching there is often wrong (D7). This walks
// the live CSSOM to find the rule that *wins* for a given (element, property) and
// labels where it comes from. The one design-system-agnostic signal for "is this
// library-owned?" is the winning rule's stylesheet `href`: if it resolves under
// `node_modules` (or another declared dependency origin), the style is vendor-
// owned and must become a prop/variant change at the *usage site*, never a
// node_modules edit (D8) — so it's flagged, not pointed at a source line.
// Component identity comes from the Source Stamp path (via the locator), not from
// a tag/component-name registry. `win`/`doc` are injected for unit testing
// against fixture stylesheets. The result is a compact object meant to ride along
// in an intent payload (0003 owns that schema; this just feeds it).
//
// `vendorOrigins` is optional refinement (ADR 0001): extra path fragments that
// also count as dependency origins (e.g. a CDN base, a pnpm `.pnpm` store, a
// vendored `/lib/` dir). `node_modules` is always treated as vendor-owned with
// zero config; hints only widen the net, never gate the base behaviour.
export const createProvenance = ({ doc, vendorOrigins = [] } = {}) => {
  // Approximate CSS specificity from a selector's text. Exact cascade resolution
  // would need the full matching machinery; for picking among rules that already
  // match one element, an id/class/type tally plus document order is enough.
  const specificity = (sel) => {
    const ids = (sel.match(/#[\w-]+/g) || []).length;
    const classes = (sel.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) || []).length;
    const types = (
      sel.replace(/[#.\[:][^\s>+~,]*/g, ' ').match(/[a-z][\w-]*/gi) || []
    ).length;
    return ids * 1e6 + classes * 1e3 + types;
  };

  // Vue's <style scoped> rewrites selectors with a [data-v-xxxxxxxx] attribute.
  const isScopedSelector = (sel) => /\[data-v-[0-9a-f]+\]/i.test(sel);

  // A stylesheet is vendor-owned when its href resolves under node_modules or
  // any extra declared dependency origin. This is the agnostic ownership test —
  // it knows nothing about which design system shipped the rule, only that the
  // rule lives in a dependency the project should not edit in place.
  const isVendorSheet = (href) => {
    if (!href) return false;
    if (/(^|\/)node_modules\//i.test(href)) return true;
    return vendorOrigins.some((frag) => frag && href.includes(frag));
  };

  // Walk every rule of every sheet, keep those that match the element AND
  // declare `prop`, then return the cascade winner (specificity, then order).
  const winningRule = (el, prop) => {
    let winner = null;
    let order = 0;
    const sheets = doc.styleSheets || [];
    for (const sheet of sheets) {
      let rules;
      try {
        // Cross-origin sheets without CORS throw on cssRules access; skip them
        // rather than letting one unreachable sheet abort the whole walk.
        rules = sheet.cssRules || [];
      } catch {
        continue;
      }
      for (const rule of rules) {
        order += 1;
        if (rule.selectorText == null || !rule.style) continue;
        const value = rule.style.getPropertyValue(prop);
        if (!value) continue;
        if (!el.matches(rule.selectorText)) continue;
        const score = specificity(rule.selectorText);
        if (
          !winner ||
          score > winner.score ||
          (score === winner.score && order > winner.order)
        ) {
          winner = {
            selector: rule.selectorText,
            value: value.trim(),
            href: sheet.href || null,
            score,
            order,
          };
        }
      }
    }
    return winner;
  };

  // Resolve where the given property on the given element is defined.
  const inspect = (el, prop) => {
    const classList = Array.from(el.classList || []);
    const base = { selector: null, classList, value: null };

    // Inline style beats any stylesheet rule.
    const inlineValue =
      el.style && el.style.getPropertyValue
        ? el.style.getPropertyValue(prop).trim()
        : '';
    if (inlineValue) {
      return { ...base, value: inlineValue, sourceKind: 'inline' };
    }

    const win_ = winningRule(el, prop);
    const selector = win_ ? win_.selector : null;
    const value = win_ ? win_.value : null;
    const href = win_ ? win_.href : null;

    // Vendor-owned: the winning rule's stylesheet resolves under a dependency
    // origin. Guidance points at the usage site, never the dependency source.
    if (win_ && isVendorSheet(href)) {
      return {
        ...base,
        selector,
        value,
        href,
        sourceKind: 'vendor',
        guidance:
          'prefer prop/variant change at usage site; do not edit node_modules',
      };
    }

    if (win_ && isScopedSelector(win_.selector)) {
      return { ...base, selector, value, href, sourceKind: 'scoped' };
    }

    return { ...base, selector, value, href, sourceKind: 'shared' };
  };

  return { inspect };
};
