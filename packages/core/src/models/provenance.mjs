/* eslint-disable */
// Design Toolbar — style provenance walker (see ../design-toolbar-plugin.js).
//
// The stamped data-luciq-loc points at the template tag, not where the style is
// actually declared, so patching there is often wrong (D7). This walks the live
// CSSOM to find the rule that *wins* for a given (element, property) and labels
// where it comes from. Spark-owned styles must become prop/variant changes at
// the usage site, never node_modules edits (D8) — so they're flagged, not
// pointed at a source line. `win`/`doc` are injected for unit testing against
// fixture stylesheets. The result is a compact object meant to ride along in an
// intent payload (0003 owns that schema; this just feeds it).
export const createProvenance = ({ doc }) => {
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

  // A stylesheet whose href lives under a spark/ path is Spark-owned.
  const isSparkSheet = (href) => !!href && /(^|\/)spark\//i.test(href);

  // Spark usage sites surface as custom-element tags (Ibg* / spark-*).
  const isSparkTag = (tagName) => /^(ibg|spark)[-]/i.test(tagName || '');

  // Walk every rule of every sheet, keep those that match the element AND
  // declare `prop`, then return the cascade winner (specificity, then order).
  const winningRule = (el, prop) => {
    let winner = null;
    let order = 0;
    const sheets = doc.styleSheets || [];
    for (const sheet of sheets) {
      const rules = sheet.cssRules || [];
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
    const tagName = (el.tagName || '').toLowerCase();
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

    // Spark: the winning rule is Spark-owned, or the element is a Spark tag.
    if ((win_ && isSparkSheet(win_.href)) || isSparkTag(tagName)) {
      return {
        ...base,
        selector,
        value,
        sourceKind: 'spark',
        guidance:
          'prefer prop/variant change at usage site; do not edit node_modules',
      };
    }

    if (win_ && isScopedSelector(win_.selector)) {
      return { ...base, selector, value, sourceKind: 'scoped' };
    }

    return { ...base, selector, value, sourceKind: 'shared' };
  };

  return { inspect };
};
