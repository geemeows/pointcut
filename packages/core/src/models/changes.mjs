/* eslint-disable */
// Pointcut — saved-comment CHANGES summary.
//
// Derives the human-facing CHANGES lines for a saved-comment card from an
// Annotation's structured edits[] (0003). Pure: no DOM, no deps. The card shows
// at most one design change (intent · property · value) plus a copy change
// (old → new), so this collapses the edits[] captured by the inspector controls
// (spacing/color/type chips + the copy field) into that two-line shape.
//
// Status vocabulary mirrors the UI spec: 'detected' (a change was captured),
// 'no-change' (none for this lane), 'not-detected' (extraction pending/failed —
// not produced here since changes come from explicit controls, but the renderer
// supports it).

const INTENT_LABELS = { spacing: 'Spacing', color: 'Color', type: 'Type' };

// Live CSS property (as stored on an edit) → the card's intent/property ids and
// the property's display label.
const PROPERTY_MAP = {
  padding: { intent: 'spacing', id: 'padding', label: 'Padding' },
  margin: { intent: 'spacing', id: 'margin', label: 'Margin' },
  gap: { intent: 'spacing', id: 'gap', label: 'Gap' },
  'background-color': { intent: 'color', id: 'fill', label: 'Fill' },
  color: { intent: 'color', id: 'textColor', label: 'Text' },
  'border-color': { intent: 'color', id: 'borderColor', label: 'Border' },
  'font-size': { intent: 'type', id: 'fontSize', label: 'Size' },
  'font-weight': { intent: 'type', id: 'fontWeight', label: 'Weight' },
  'line-height': { intent: 'type', id: 'lineHeight', label: 'Line height' },
};

const isCopy = (e) => !!e && e.type === 'copy';
const designMeta = (e) => (e && !isCopy(e) ? PROPERTY_MAP[e.property] || null : null);

// A design edit's display value: token/style edits carry an `after` object whose
// token name reads best (e.g. "8px", "700", a primitive name); copy/plain edits
// fall back to the raw value.
const valueOf = (e) => {
  const after = e && e.after;
  if (after && typeof after === 'object') return after.token || after.value || null;
  return after != null ? String(after) : null;
};

// Collapse an Annotation's edits[] into the card's two-lane summary.
export const describeChanges = (annotation) => {
  const edits = (annotation && annotation.edits) || [];

  let designChange = { intent: null, property: null, value: null, status: 'no-change' };
  for (const e of edits) {
    const meta = designMeta(e);
    if (meta) {
      designChange = { intent: meta.intent, property: meta.id, value: valueOf(e), status: 'detected' };
      break;
    }
  }

  let copyChange = { oldText: null, newText: null, status: 'no-change' };
  for (const e of edits) {
    if (isCopy(e)) {
      // A manual copy add carries no known original wording — keep it null so the
      // row renders the "Current text" placeholder rather than empty quotes.
      copyChange = { oldText: e.before ? e.before : null, newText: e.after || '', status: 'detected' };
      break;
    }
  }

  return { designChange, copyChange };
};

// ---- Live intent parsing (edit-mode preview) -----------------------------
// The card's CHANGES PREVIEW infers intent from the note's free text as the
// user types — there's no async extractor, so this is a small, deterministic
// clean-room parser (no design-system or framework knowledge). It recognises
// obvious colour and copy requests; anything design-shaped it can't map stays
// 'not-detected' rather than falsely claiming 'no-change'.

const COLORS = [
  'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'black', 'white',
  'gray', 'grey', 'cyan', 'magenta', 'teal', 'violet', 'indigo', 'brown', 'navy',
  'gold', 'silver', 'maroon', 'beige', 'lime', 'crimson', 'turquoise',
];
const COLOR_RE = new RegExp(`\\b(${COLORS.join('|')})\\b`, 'i');
// Design adjectives that must never be mistaken for new copy text.
const DESIGNY_RE = /\b(bold(?:er)?|thinner|lighter|bigger|larger|smaller|tighter|looser|rounded|round)\b/i;

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

// Copy-request patterns, most-specific first. Each captures the new wording to
// end-of-string; the verb's index marks where the copy clause begins so colour
// detection runs only on the text *before* it.
const COPY_PATTERNS = [
  /\brename\b[\s\S]*?\bto\s+(.+)$/i,
  /\b(?:change|set|update)\s+(?:the\s+)?(?:text|label|copy|title|wording|caption|button(?:\s+text)?)\s+to\s+(.+)$/i,
  /\bmake\s+(?:the\s+|it\s+|this\s+)?(?:label|text|button|title|copy)\s+(?:say\s+|read\s+)?(.+)$/i,
  /\bmake\s+(?:it|this)\s+say\s+(.+)$/i,
  /\b(?:call|label|name)\s+(?:it|this)\s+(.+)$/i,
  /\b(?:change|set|make)\s+(?:this|it)\s+to\s+(.+)$/i,
];

// Tidy a captured new-text: strip wrapping quotes, a trailing design clause
// ("… and make it red"), and trailing punctuation. Returns '' when nothing
// usable survives.
const cleanCopy = (raw) => {
  let s = (raw || '').trim();
  s = s.replace(/\s+and\s+(?:make|turn|change|set|color|colour)\b[\s\S]*$/i, '').trim();
  s = s.replace(/^["'`]+|["'`]+$/g, '').trim();
  s = s.replace(/[.!]+$/, '').trim();
  return s;
};

const extractCopy = (text) => {
  for (const re of COPY_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const next = cleanCopy(m[1]);
    if (!next) continue;
    // A bare colour ("change this to green") or a design adjective ("make it
    // bigger") is not a copy change — let design detection own it.
    if (COLOR_RE.test(next) && next.split(/\s+/).length === 1) continue;
    if (DESIGNY_RE.test(next) && next.split(/\s+/).length <= 2) continue;
    return { newText: next, index: m.index };
  }
  return null;
};

const detectDesign = (residual) => {
  const color = COLOR_RE.exec(residual);
  if (color) return { intent: 'color', property: 'fill', value: cap(color[1]), status: 'detected' };
  if (/\bbold(?:er)?\b/i.test(residual)) return { intent: 'type', property: 'fontWeight', value: 'Bold', status: 'detected' };
  if (/\b(?:thinner|lighter)\b/i.test(residual)) return { intent: 'type', property: 'fontWeight', value: 'Light', status: 'detected' };
  if (/\b(?:bigger|larger)\b/i.test(residual)) return { intent: 'type', property: 'fontSize', value: 'Larger', status: 'detected' };
  if (/\bsmaller\b/i.test(residual)) return { intent: 'type', property: 'fontSize', value: 'Smaller', status: 'detected' };
  if (/\bmargin\b/i.test(residual)) return { intent: 'spacing', property: 'margin', value: null, status: 'detected' };
  if (/\bpadding\b/i.test(residual)) return { intent: 'spacing', property: 'padding', value: null, status: 'detected' };
  if (/\bgap\b/i.test(residual)) return { intent: 'spacing', property: 'gap', value: null, status: 'detected' };
  if (/\b(?:tighter|less\s+space)\b/i.test(residual)) return { intent: 'spacing', property: null, value: 'Reduced', status: 'detected' };
  if (/\b(?:looser|more\s+space)\b/i.test(residual)) return { intent: 'spacing', property: null, value: 'Increased', status: 'detected' };
  if (/\bspacing\b/i.test(residual)) return { intent: 'spacing', property: null, value: null, status: 'detected' };
  return null;
};

// Infer a {designChange, copyChange} preview from a note's free text.
export const parseIntent = (text) => {
  const trimmed = (text == null ? '' : String(text)).trim();
  if (!trimmed) {
    return {
      designChange: { intent: null, property: null, value: null, status: 'no-change' },
      copyChange: { oldText: null, newText: null, status: 'no-change' },
    };
  }

  const copy = extractCopy(trimmed);
  const copyChange = copy
    ? { oldText: null, newText: copy.newText, status: 'detected' }
    : { oldText: null, newText: null, status: 'no-change' };

  // Colour/design detection ignores the copy clause so "rename it to Red" can't
  // masquerade as a fill change.
  const residual = copy ? trimmed.slice(0, copy.index) : trimmed;
  let designChange = detectDesign(residual);
  if (!designChange) {
    // No design keyword: confident "no-change" only when a copy change was the
    // whole instruction; otherwise the intent is unclear → "not-detected".
    designChange = copy
      ? { intent: null, property: null, value: null, status: 'no-change' }
      : { intent: null, property: null, value: null, status: 'not-detected' };
  }

  return { designChange, copyChange };
};

export const intentLabel = (id) => INTENT_LABELS[id] || '';

// Property display label from the card's property id (reverse of PROPERTY_MAP).
export const propertyLabel = (id) => {
  for (const k in PROPERTY_MAP) if (PROPERTY_MAP[k].id === id) return PROPERTY_MAP[k].label;
  return '';
};

// One-line design summary text for the change row.
export const designText = (d) => {
  if (d && d.status === 'detecting') return 'Detecting…';
  if (!d || d.status === 'not-detected') return 'Not detected yet';
  if (d.status !== 'detected') return 'No design change';
  return [intentLabel(d.intent), propertyLabel(d.property), d.value].filter(Boolean).join(' · ');
};

// One-line copy summary text for the change row. A parsed preview carries no
// original wording, so a null oldText renders the "Current text" placeholder;
// a stored copy edit supplies the real before-text.
export const copyText = (c) => {
  if (c && c.status === 'detecting') return 'Detecting…';
  if (!c || c.status === 'not-detected') return 'Not detected yet';
  if (c.status !== 'detected') return 'No copy change';
  const old = c.oldText == null ? 'Current text' : c.oldText;
  return `"${old}" → "${c.newText}"`;
};

// ---- Editable changes (edit-mode CHANGE EDITOR) --------------------------
// Edit mode lets the user correct the interpreted design + copy change, not just
// the note. These helpers back that editor: the intent/property vocabulary (kept
// in lock-step with PROPERTY_MAP so view and edit can never disagree), the value
// guard that makes an out-of-lane token unsavable, and the conversions to/from
// the annotation's persisted edits[].

// Intent dropdown options (Copy is its own row, never an intent here).
export const INTENT_OPTIONS = [
  { id: 'spacing', label: 'Spacing' },
  { id: 'color', label: 'Color' },
  { id: 'type', label: 'Type' },
];

// Property dropdown options for an intent, derived from PROPERTY_MAP so the set
// and ordering follow the single source of truth (e.g. spacing → Padding/Margin/
// Gap, color → Fill/Text/Border, type → Size/Weight/Line height).
export const propertiesForIntent = (intent) =>
  Object.values(PROPERTY_MAP)
    .filter((m) => m.intent === intent)
    .map((m) => ({ id: m.id, label: m.label }));

// First (default) property id for an intent — used when the intent changes and
// the property must reset to a valid default for that intent.
export const defaultPropertyForIntent = (intent) => {
  const props = propertiesForIntent(intent);
  return props.length ? props[0].id : null;
};

// CSS property name for a card property id (reverse of PROPERTY_MAP), used when
// persisting a manual edit back into the annotation's edits[].
export const cssPropertyForId = (id) => {
  for (const k in PROPERTY_MAP) if (PROPERTY_MAP[k].id === id) return k;
  return null;
};

// The value "kind" each property expects. This is what keeps a typography token
// out of a spacing slot and vice-versa:
//   length → px/rem length or a length-typed token   (spacing, font-size)
//   color  → hex / named color / color-typed token
//   weight → unitless 100–900
//   number → unitless number or length               (line-height)
const VALUE_KIND = {
  padding: 'length', margin: 'length', gap: 'length',
  fill: 'color', textColor: 'color', borderColor: 'color',
  fontSize: 'length', fontWeight: 'weight', lineHeight: 'number',
};
export const valueKind = (property) => VALUE_KIND[property] || null;

const NAMED_COLOR_SET = new Set(COLORS);

// The leading CSS-variable name in a value string (handles a "--tok · 24px"
// display form), or null when the value isn't a token.
const leadingToken = (raw) => {
  const s = String(raw).trim();
  if (s.slice(0, 2) !== '--') return null;
  return s.split(/[\s·]/)[0];
};

// Is `value` legal for the selected property? A token value must belong to that
// property's introspected pool (names passed in by the caller, since pools are
// read live off :root); any literal/descriptor is accepted (the agent resolves
// fuzzy words like "Larger"). This single guard makes an out-of-lane token such
// as "Spacing · Padding · --type-body" impossible to save.
export const isValidDesignValue = (property, value, tokenNames = []) => {
  if (!valueKind(property)) return false;
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return false;
  const tok = leadingToken(raw);
  if (tok) return tokenNames.includes(tok);
  return true;
};

// Whether a manual/edited design change is in a savable state. A no-change or
// not-detected lane is fine (nothing to persist); a detected lane must carry a
// valid intent/property/value triple.
export const isDesignChangeValid = (design, tokenNames = []) => {
  if (!design || design.status !== 'detected') return true;
  if (!design.intent || !design.property) return false;
  return isValidDesignValue(design.property, design.value, tokenNames);
};

// Convert a describeChanges/parseIntent designChange into the editor's draft
// shape, tagging the source (auto-detected unless the user has edited it).
export const toEditableDesign = (designChange, source = 'auto-detected') => ({
  source,
  intent: designChange ? designChange.intent : null,
  property: designChange ? designChange.property : null,
  value: designChange ? designChange.value : null,
  status: (designChange && designChange.status) || 'no-change',
});

export const toEditableCopy = (copyChange, source = 'auto-detected') => ({
  source,
  oldText: copyChange ? copyChange.oldText : null,
  newText: copyChange ? copyChange.newText : null,
  status: (copyChange && copyChange.status) || 'no-change',
});

// Build the annotation edits[] from the editor's design + copy drafts. A design
// value is stored on `after.value` (so describeChanges round-trips the exact
// display string) with the bare token name kept aside for the agent. Only
// detected lanes are persisted.
// ---- Value vocabulary dispatch (CHANGE EDITOR value control) -------------
// The value control's options come from the project's own tokens (ADR 0001 —
// introspected live, never hard-coded names) plus universal literal presets so
// there's always a sensible choice even when a project ships no tokens. The
// token names also gate validation (isValidDesignValue), so a token is only
// offered for the lane whose pool it lives in and an out-of-lane token can
// neither be selected nor saved.
//
// This single dispatch replaces the two duplicated 5-way property→scale
// switches that lived in the client (designPoolNames + designValueOptions). It
// reads each `tokens.*` scale ONCE and returns BOTH:
//   names   — the introspected token names (for validation; empty when none)
//   options — the select option objects ({value,label}); project tokens first
//             (as "--name · value"), then literal presets, then a Custom… escape
//             hatch. (designValueOptions appended __custom__; this keeps that.)

const LENGTH_PRESETS = ['4px', '8px', '12px', '16px', '24px'];
const FONTSIZE_PRESETS = ['14px', '16px', '20px'];
const WEIGHT_PRESETS = ['400', '500', '600', '700'];
const LINEHEIGHT_PRESETS = ['1', '1.25', '1.5', '1.75'];
const COLOR_PRESETS = ['#EF4444', '#3B82F6', '#22C55E', '#111827', '#FFFFFF'];

// Which token scale + literal presets back each property's value control. The
// scale getter is invoked once per call; an absent `tokens` (or missing getter)
// yields no token names/options — only the literal presets remain.
const VALUE_POOL = {
  padding: { scale: 'spacingScale', presets: LENGTH_PRESETS },
  margin: { scale: 'spacingScale', presets: LENGTH_PRESETS },
  gap: { scale: 'spacingScale', presets: LENGTH_PRESETS },
  fill: { scale: 'colorRamp', presets: COLOR_PRESETS },
  textColor: { scale: 'colorRamp', presets: COLOR_PRESETS },
  borderColor: { scale: 'colorRamp', presets: COLOR_PRESETS },
  fontSize: { scale: 'fontSizeScale', presets: FONTSIZE_PRESETS },
  fontWeight: { scale: 'fontWeightScale', presets: WEIGHT_PRESETS },
  lineHeight: { scale: 'fontLineHeightScale', presets: LINEHEIGHT_PRESETS },
};

// Resolve a property's value vocabulary against the live token scales. Returns
// { names, options }. `tokens` is the introspection facade (tokens.spacingScale()
// etc.); each scale entry is { name, value, ... }.
export const designValuePool = (property, tokens) => {
  const cfg = VALUE_POOL[property];
  if (!cfg) return { names: [], options: [{ value: '__custom__', label: 'Custom…' }] };

  const getter = tokens && tokens[cfg.scale];
  const scale = typeof getter === 'function' ? getter.call(tokens) || [] : [];
  const names = scale.map((t) => t.name);

  const options = [];
  const seen = new Set();
  const push = (value, label) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    options.push({ value, label: label || value });
  };
  scale.forEach((t) => push(`${t.name} · ${t.value}`));
  cfg.presets.forEach((v) => push(v));
  options.push({ value: '__custom__', label: 'Custom…' });
  return { names, options };
};

// First non-custom option value for a property — the valid default used when a
// lane is added or its intent/property changes. (Was the client's
// defaultDesignValue.)
const firstValue = (property, tokens) => {
  const o = designValuePool(property, tokens).options.find((x) => x.value !== '__custom__');
  return o ? o.value : '';
};

// ---- popDraft state machine (CHANGE EDITOR reducer) ----------------------
// Pure reducer mirroring reducePickMode: it owns EVERY popDraft transition for
// the edit-mode CHANGE EDITOR. The client holds popDraft, translates DOM events
// into the events below, replaces popDraft with the returned draft, then
// repaints — UNLESS the result asks it not to (the caret-preserving field-input
// case). The `source='manual'` invariant — a hand-edited lane flips its source
// so re-detection can't clobber it — lives ONLY here.
//
//   draft  = { note, design:{source,intent,property,value,status},
//              copy:{source,oldText,newText,status},
//              designOpen, copyOpen, designCustom, detecting }
//   event  = { type, ... }  (see below)
//   result = { draft, repaint }   repaint:false ⇒ client updates warn+Save only
//
// Events (one per client interaction):
//   toggle-design / toggle-copy      — expand/collapse a lane (seeds a default
//                                       lane on first "+ Add")
//   clear-design / clear-copy        — wipe a lane to no-change, collapse it
//   detect-design / detect-copy      — re-run note detection; carries
//                                       { parsed } (the parseIntent result of the
//                                       current note text); adopts it, source
//                                       back to auto-detected
//   field-change { field, value, tokens }
//                                    — a <select> change (intent/property/value);
//                                       flips source→manual; repaints
//   field-input  { field, value }    — free-text input (custom value / new copy);
//                                       flips source→manual; repaint:false so the
//                                       client preserves focus/caret
//
// `tokens` is threaded into the transitions that need a fresh default value
// (toggle-design, field-change intent/property) so the model never reaches into
// the client. detect-* take the already-parsed result so the model stays pure
// (parseIntent itself is pure but the note text lives on the DOM input).

const editResult = (draft, repaint = true) => ({ draft, repaint });

export const reduceEditor = (draft, event) => {
  if (!draft) return editResult(draft);
  switch (event.type) {
    case 'toggle-design': {
      if (draft.designOpen) return editResult({ ...draft, designOpen: false });
      // "+ Add" (nothing set yet) seeds a valid default; the pencil just expands.
      if (draft.design.status !== 'detected') {
        return editResult({
          ...draft,
          design: {
            source: 'manual', intent: 'spacing', property: 'padding',
            value: firstValue('padding', event.tokens), status: 'detected',
          },
          designCustom: false,
          designOpen: true,
        });
      }
      return editResult({ ...draft, designOpen: true });
    }

    case 'toggle-copy': {
      if (draft.copyOpen) return editResult({ ...draft, copyOpen: false });
      if (draft.copy.status !== 'detected') {
        return editResult({
          ...draft,
          copy: { source: 'manual', oldText: draft.copy.oldText, newText: '', status: 'detected' },
          copyOpen: true,
        });
      }
      return editResult({ ...draft, copyOpen: true });
    }

    case 'clear-design':
      return editResult({
        ...draft,
        design: { source: 'manual', intent: null, property: null, value: null, status: 'no-change' },
        designCustom: false,
        designOpen: false,
      });

    case 'clear-copy':
      return editResult({
        ...draft,
        copy: { source: 'manual', oldText: draft.copy.oldText, newText: null, status: 'no-change' },
        copyOpen: false,
      });

    // Re-run detection from the note (event.parsed = parseIntent(noteText)) and
    // adopt the result (source back to auto-detected). Stays expanded only when
    // something was detected.
    case 'detect-design': {
      const design = toEditableDesign(event.parsed.designChange, 'auto-detected');
      return editResult({
        ...draft,
        design,
        designCustom: false,
        designOpen: design.status === 'detected',
      });
    }

    case 'detect-copy': {
      const copy = toEditableCopy(event.parsed.copyChange, 'auto-detected');
      return editResult({ ...draft, copy, copyOpen: copy.status === 'detected' });
    }

    // A select/intent/property/value change. Manual edits flip the lane's source
    // so note-text detection no longer overwrites it.
    case 'field-change': {
      const d = { ...draft.design };
      if (event.field === 'ed-intent') {
        d.intent = event.value;
        d.property = defaultPropertyForIntent(event.value);
        d.value = firstValue(d.property, event.tokens);
        d.source = 'manual';
        d.status = 'detected';
        return editResult({ ...draft, design: d, designCustom: false });
      }
      if (event.field === 'ed-property') {
        d.property = event.value;
        d.value = firstValue(event.value, event.tokens);
        d.source = 'manual';
        d.status = 'detected';
        return editResult({ ...draft, design: d, designCustom: false });
      }
      if (event.field === 'ed-value') {
        d.source = 'manual';
        d.status = 'detected';
        if (event.value === '__custom__') {
          d.value = '';
          return editResult({ ...draft, design: d, designCustom: true });
        }
        d.value = event.value;
        return editResult({ ...draft, design: d, designCustom: false });
      }
      return editResult(draft);
    }

    // Text input (custom value / new copy). Update the draft but DON'T repaint —
    // the client refreshes only the warning + Save state so focus/caret survive.
    case 'field-input': {
      if (event.field === 'ed-value-custom') {
        const d = { ...draft.design, source: 'manual', status: 'detected', value: event.value };
        return editResult({ ...draft, design: d }, false);
      }
      if (event.field === 'ed-copy-new') {
        const c = { ...draft.copy, source: 'manual', status: 'detected', newText: event.value };
        return editResult({ ...draft, copy: c }, false);
      }
      return editResult(draft, false);
    }

    default:
      return editResult(draft);
  }
};

export const editsFromEditable = (design, copy) => {
  const edits = [];
  if (design && design.status === 'detected' && design.intent && design.property) {
    const prop = cssPropertyForId(design.property);
    if (prop) {
      const raw = design.value == null ? '' : String(design.value);
      edits.push({
        property: prop,
        before: '',
        after: { value: raw, token: null, tokenName: leadingToken(raw) },
        provenance: null,
        role: null,
        source: design.source || 'manual',
      });
    }
  }
  if (copy && copy.status === 'detected' && copy.newText) {
    edits.push({
      type: 'copy',
      before: copy.oldText == null ? '' : copy.oldText,
      after: copy.newText,
      source: copy.source || 'manual',
    });
  }
  return edits;
};
