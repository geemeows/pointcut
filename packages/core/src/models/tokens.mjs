/* eslint-disable */
// Design Toolbar — NDS-2026 token ingestion (see ../design-toolbar-plugin.js).
//
// NDS tokens are emitted as CSS custom properties on :root, so the live token
// set is readable at runtime with no build step or static export (D4, ADR 0002).
// Visual controls preview against these real tokens and capture intent that
// names one. Values are resolved live on every call, so dark-mode variants
// (same var names, re-resolved) come back correct. `win`/`doc` are injected so
// the enumerator can be unit-tested against a fake computed-style declaration.
export const createTokens = ({ doc, win, remBase = 16 }) => {
  const root = doc.documentElement;

  // A CSSStyleDeclaration is array-like: indices 0..length-1 are property names,
  // and custom properties enumerate alongside the rest. We bucket by prefix.
  const collect = () => {
    const decl = win.getComputedStyle(root);
    const out = {
      spacing: [],
      fontSize: [],
      fontWeight: [],
      fontLineHeight: [],
      semanticColor: [],
      primitiveColor: [],
    };
    for (let i = 0; i < decl.length; i++) {
      const name = decl[i];
      if (typeof name !== 'string' || name.slice(0, 2) !== '--') continue;
      const value = decl.getPropertyValue(name).trim();
      const entry = { name, value };
      if (name.startsWith('--spacing-')) out.spacing.push(entry);
      else if (name.startsWith('--font-size-')) out.fontSize.push(entry);
      else if (name.startsWith('--font-weight-')) out.fontWeight.push(entry);
      else if (name.startsWith('--font-line-height-')) out.fontLineHeight.push(entry);
      else if (
        name.startsWith('--surface-') ||
        name.startsWith('--text-') ||
        name.startsWith('--border-') ||
        name.startsWith('--icon-')
      )
        out.semanticColor.push(entry);
      else if (name.startsWith('--color-')) out.primitiveColor.push(entry);
    }
    return out;
  };

  // Token dimensions are authored in px or rem; reduce to px for comparison.
  const toPx = (value) => {
    const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(String(value).trim());
    if (!m) return NaN;
    const n = parseFloat(m[1]);
    return m[2] === 'rem' || m[2] === 'em' ? n * remBase : n;
  };

  // Nearest token to `px` by absolute px distance. offScale flags that no token
  // matched exactly (the picked value is the closest legal landing spot).
  const snap = (list, px) => {
    if (!Number.isFinite(px)) return null;
    let best = null;
    let bestDiff = Infinity;
    for (const t of list) {
      const tpx = toPx(t.value);
      if (!Number.isFinite(tpx)) continue;
      const diff = Math.abs(tpx - px);
      if (diff < bestDiff) {
        best = t;
        bestDiff = diff;
      }
    }
    if (!best) return null;
    return { name: best.name, value: best.value, offScale: bestDiff !== 0 };
  };

  // The spacing tokens as an ordered, px-tagged scale (ascending, exact-px
  // duplicates collapsed). A stepper walks this to move between adjacent tokens
  // (0004); snap() finds the nearest, this gives the neighbours.
  const scaleOf = (list) => {
    const seen = new Set();
    const scale = [];
    list.forEach((t) => {
      const px = toPx(t.value);
      if (!Number.isFinite(px) || seen.has(px)) return;
      seen.add(px);
      scale.push({ name: t.name, value: t.value, px });
    });
    return scale.sort((a, b) => a.px - b.px);
  };

  return {
    enumerate: collect,
    snapSpacing: (px) => snap(collect().spacing, px),
    snapFontSize: (px) => snap(collect().fontSize, px),
    // Typography snappers/scales (0006). Weights and line-heights are unitless
    // (e.g. '700', '1.5'); toPx() leaves a bare number unchanged, so the same
    // snap/scaleOf machinery walks them as a numeric scale just like font-size.
    snapFontWeight: (n) => snap(collect().fontWeight, n),
    snapFontLineHeight: (n) => snap(collect().fontLineHeight, n),
    spacingScale: () => scaleOf(collect().spacing),
    fontSizeScale: () => scaleOf(collect().fontSize),
    fontWeightScale: () => scaleOf(collect().fontWeight),
    fontLineHeightScale: () => scaleOf(collect().fontLineHeight),
    // The L1 primitive ramp (--color-*) the color control offers as swatches
    // (0005). Designers pick a primitive here; the captured intent names the
    // element's *semantic* role (read via provenance), not this raw value.
    colorRamp: () => collect().primitiveColor,
  };
};
