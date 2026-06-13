/* eslint-disable */
// Pointcut — token introspection by resolved value type (ADR 0001).
//
// Any design system emits its tokens as CSS custom properties on :root, so the
// live token set is readable at runtime with no build step, static export, or
// per-design-system config. Pointcut classifies each `--*` property by what its
// value *resolves to* — color / length / unitless number — NOT by a name prefix
// it was handed (D1). Snapping a picked value needs only its value type: colors
// snap against the color pool, lengths against the length pool, numbers against
// the number pool. Values are resolved live on every call, so dark-mode variants
// (same var names, re-resolved) come back correct. `win`/`doc` are injected so
// the enumerator can be unit-tested against a fake computed-style declaration.
//
// Optional `prefixHints` are *refinement only* (ADR 0001): they sub-group a value
// type for nicer palettes/labels (e.g. semantic vs. primitive colors, or spacing
// vs. font-size lengths). Zero-config works without them — every prop still lands
// in its value-type pool and snaps correctly. Hints never gate classification.
export const createTokens = ({ doc, win, remBase = 16, prefixHints = {} } = {}) => {
  const root = doc.documentElement;

  // ---- Value-type classification (the only design-system-agnostic signal) ----

  // A resolved value is a color if it parses as a hex/rgb/hsl/named color form.
  // We stay conservative: recognise the shapes a computed :root var resolves to.
  const isColor = (v) => {
    const s = String(v).trim().toLowerCase();
    if (!s) return false;
    if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return true;
    if (/^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/.test(s)) return true;
    if (s === 'transparent' || s === 'currentcolor') return true;
    return false;
  };

  // A length resolves to a number with a CSS length unit (or a bare 0). Computed
  // :root vars are typically already px, but authored rem/em are honoured too.
  const LENGTH_RE = /^(-?[\d.]+)(px|rem|em)$/;
  const isLength = (v) => {
    const s = String(v).trim();
    return LENGTH_RE.test(s) || s === '0';
  };

  // A unitless number (font-weight 700, line-height 1.5, opacity 0.5, z-index).
  const isNumber = (v) => /^-?[\d.]+$/.test(String(v).trim());

  // Classify one resolved value into a pool key, or null if it's not a token we
  // can snap against (urls, gradients, font stacks, calc(), etc.).
  const classify = (v) => {
    if (isColor(v)) return 'color';
    if (isLength(v)) return 'length';
    if (isNumber(v)) return 'number';
    return null;
  };

  // ---- Optional refinement: prefix-hint sub-grouping (never gates anything) ----

  // prefixHints maps a sub-group label to one or more `--prefix` strings, e.g.
  // { spacing: ['--spacing-', '--space-'], semanticColor: ['--surface-','--text-'] }.
  // matchHint returns the first sub-group whose prefix the name starts with.
  const matchHint = (name) => {
    for (const group of Object.keys(prefixHints)) {
      const prefixes = prefixHints[group];
      const list = Array.isArray(prefixes) ? prefixes : [prefixes];
      if (list.some((p) => name.startsWith(p))) return group;
    }
    return null;
  };

  // A CSSStyleDeclaration is array-like: indices 0..length-1 are property names,
  // and custom properties enumerate alongside the rest. We bucket every `--*`
  // prop by its resolved value type, and tag each with its optional hint group.
  const collect = () => {
    const decl = win.getComputedStyle(root);
    const pools = { color: [], length: [], number: [] };
    for (let i = 0; i < decl.length; i++) {
      const name = decl[i];
      if (typeof name !== 'string' || name.slice(0, 2) !== '--') continue;
      const value = decl.getPropertyValue(name).trim();
      const type = classify(value);
      if (!type) continue;
      pools[type].push({ name, value, type, group: matchHint(name) });
    }
    return pools;
  };

  // Entries of a pool, optionally narrowed to a hint sub-group when one is asked
  // for AND any entry carries it — otherwise the whole value-type pool is used
  // (zero-config: no hints means snap against every token of that type).
  const poolFor = (type, group) => {
    const all = collect()[type] || [];
    if (!group) return all;
    const narrowed = all.filter((e) => e.group === group);
    return narrowed.length ? narrowed : all;
  };

  // Token dimensions are authored in px or rem; reduce to px for comparison.
  const toPx = (value) => {
    const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(String(value).trim());
    if (!m) return NaN;
    const n = parseFloat(m[1]);
    return m[2] === 'rem' || m[2] === 'em' ? n * remBase : n;
  };

  // Nearest token to `n` by absolute distance. offScale flags that no token
  // matched exactly (the picked value is the closest legal landing spot).
  const snap = (list, n) => {
    if (!Number.isFinite(n)) return null;
    let best = null;
    let bestDiff = Infinity;
    for (const t of list) {
      const tn = toPx(t.value);
      if (!Number.isFinite(tn)) continue;
      const diff = Math.abs(tn - n);
      if (diff < bestDiff) {
        best = t;
        bestDiff = diff;
      }
    }
    if (!best) return null;
    return { name: best.name, value: best.value, offScale: bestDiff !== 0 };
  };

  // A pool as an ordered, numeric-tagged scale (ascending, exact duplicates
  // collapsed). A stepper walks this to move between adjacent tokens (0004);
  // snap() finds the nearest, this gives the neighbours.
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

  // Length tokens split by hint into spacing vs. font-size where hints exist
  // (ADR 0001: categories sharing a value type can only be separated by the
  // optional refinement layer). With no hints, both fall back to all lengths —
  // snapping still works; only the palette grouping is coarser.
  return {
    // Raw value-type pools (zero-config view onto the project's own tokens).
    enumerate: collect,
    pool: poolFor,

    // Lengths. With a `spacing`/`fontSize` hint these narrow; without, they
    // snap against every length token on :root.
    snapSpacing: (px) => snap(poolFor('length', 'spacing'), px),
    snapFontSize: (px) => snap(poolFor('length', 'fontSize'), px),
    spacingScale: () => scaleOf(poolFor('length', 'spacing')),
    fontSizeScale: () => scaleOf(poolFor('length', 'fontSize')),

    // Unitless numbers. Weights and line-heights are both numbers; hints
    // (`fontWeight`/`fontLineHeight`) refine which sub-group is offered. toPx()
    // leaves a bare number unchanged, so the same machinery walks them.
    snapFontWeight: (n) => snap(poolFor('number', 'fontWeight'), n),
    snapFontLineHeight: (n) => snap(poolFor('number', 'fontLineHeight'), n),
    fontWeightScale: () => scaleOf(poolFor('number', 'fontWeight')),
    fontLineHeightScale: () => scaleOf(poolFor('number', 'fontLineHeight')),

    // The color ramp the color control offers as swatches (0005). Every
    // color-typed token is a candidate; a `primitiveColor` hint narrows to the
    // raw ramp where the project distinguishes one. Zero-config: all colors.
    // Pared to {name, value} so the color model's swatch contract is stable.
    colorRamp: () =>
      poolFor('color', 'primitiveColor').map((e) => ({ name: e.name, value: e.value })),
  };
};
