/* eslint-disable */
// geometry — pure placement + drag math lifted from the client closure.
//
// Everything here is numbers/plain-objects in, numbers/plain-objects out. There
// is NO window, NO document, NO getBoundingClientRect inside this module: the
// client measures the DOM (rects, offsets, viewport size, computed styles) and
// hands the resolved values in, then writes the returned numbers back onto
// `.style`. This is the compute-then-apply split the spec mandates for
// `placeBeside` — and it applies to the bar drag/FLIP math too.
//
// What stays in the client: reading getBoundingClientRect / offset* / innerWidth
// / innerHeight / getComputedStyle, and assigning `.style.left` etc. What lives
// here: the floating-card side decision + clamp (placeBeside), own-node
// containment (isOwn), the element label (labelFor), the curated computed-style
// pluck (keyStylesOf), and the draggable-bar geometry (clampBarPos, flipDeltas,
// rightAnchorPos, cpanelPos).

// ---- Floating placement ----------------------------------------------------
// Defaults preserved exactly from the client.
export const GAP = 8;
export const BOTTOM_RESERVE = 72; // main toolbar (bottom:20px) + breathing room

// Compute where to put a floating card beside an anchor rect, WITHOUT touching
// the DOM. The client measures the panel (`size = {w, h}`), the anchor rect
// `r = {top, bottom, left, right}` and the viewport `{w, h}`, then writes the
// returned `top`/`left` onto `.style`. `align: 'right'` extends the card
// leftward from the anchor; otherwise rightward. `lockSide`
// ('below'|'above'|'pinned') skips the vertical-side decision and reuses a side
// chosen earlier. Returns `{ side, top, left }` — `side` is the side actually
// used so the caller can latch it. (Mirror of the original placeBeside, minus
// the panel.offsetWidth||296 fallback, which the caller now supplies.)
export const placeBeside = (size, r, viewport, align, lockSide) => {
  const w = size.w;
  const h = size.h;

  const belowTop = r.bottom + GAP;
  const aboveTop = r.top - h - GAP;
  let side = lockSide;
  if (!side) {
    if (belowTop + h <= viewport.h - BOTTOM_RESERVE) side = 'below';
    else if (aboveTop >= GAP) side = 'above';
    else side = 'pinned';
  }
  const top =
    side === 'below' ? belowTop : side === 'above' ? aboveTop : viewport.h - h - BOTTOM_RESERVE;

  // Preferred horizontal side; flip if it overflows the opposite edge.
  let left = align === 'right' ? r.right - w : r.left;
  if (align === 'right') {
    if (left < GAP) left = r.left; // too tight on the left → extend rightward
  } else if (left + w > viewport.w - GAP) {
    left = r.right - w; // too tight on the right → extend leftward
  }
  // Final clamp so the card never spills past either viewport edge.
  if (left + w > viewport.w - GAP) left = viewport.w - w - GAP;
  if (left < GAP) left = GAP;

  return { side, top: Math.max(top, GAP), left };
};

// ---- Own-node containment --------------------------------------------------
// True when `node` is `host` or lies inside it, walking parentNode and crossing
// shadow boundaries via `.host`. Pure tree-walk: the caller passes the two nodes
// (no global lookup). Kept here so the gesture layer can ask "is this our UI?".
export const isOwn = (node, host) => {
  let n = node;
  while (n) {
    if (n === host) return true;
    n = n.parentNode || (n.host || null);
  }
  return false;
};

// ---- Element label ---------------------------------------------------------
// Compact `tag#id.class.class` label for an element. Reads only tagName/id/
// className off the passed element — no DOM globals.
export const labelFor = (el) => {
  let s = el.tagName.toLowerCase();
  if (el.id) s += '#' + el.id;
  if (typeof el.className === 'string' && el.className.trim()) {
    s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
  }
  return s;
};

// ---- Curated computed-style pluck ------------------------------------------
// Pull the curated subset of properties out of an ALREADY-RESOLVED computed
// style object (the client calls getComputedStyle and passes the result in).
// `cs` must expose `getPropertyValue(name)`. Trims values, drops empties.
export const keyStylesOf = (cs, keyStyles) => {
  const out = {};
  keyStyles.forEach((p) => {
    const v = cs.getPropertyValue(p);
    if (v) out[p] = v.trim();
  });
  return out;
};

// ---- Draggable bar geometry ------------------------------------------------
// Clamp a desired left/top so the bar stays 8px inside the viewport. The client
// measures the bar rect `{width, height}` and viewport `{w, h}`; this returns
// the clamped `{ left, top }` to write. (setBarPos's pure core.)
export const clampBarPos = (left, top, barSize, viewport) => ({
  left: Math.max(8, Math.min(left, viewport.w - barSize.width - 8)),
  top: Math.max(8, Math.min(top, viewport.h - barSize.height - 8)),
});

// FLIP deltas between two measured footprints (the "first" and "last" rects).
// Returns the translate/scale to start from so the swap tweens smoothly. Pure
// arithmetic on two rects: the client measures both and writes the transform.
export const flipDeltas = (first, last) => ({
  dx: first.left - last.left,
  dy: first.top - last.top,
  sx: first.width / last.width,
  sy: first.height / last.height,
});

// Center a new footprint (width w, height h) on the OLD one's right edge — the
// left/top the bar should be pinned to so the collapse/expand shrinks toward the
// click. The caller still clamps the result via clampBarPos.
export const rightAnchorPos = (first, w, h) => ({
  left: first.right - w,
  top: first.top + (first.height - h) / 2,
});

// Anchor the floating agent feed (cpanel) just above the bar's resting box,
// centred on the bar but clamped to the viewport. The client reads the bar's
// settled layout box (offsetLeft/offsetTop/offsetWidth) and the cpanel width,
// then writes the returned left/bottom (transform:none, right:auto). Returns
// `{ left, bottom }`.
export const cpanelPos = (bar, cpanelWidth, viewport) => {
  let left = bar.offsetLeft + bar.offsetWidth / 2 - cpanelWidth / 2;
  left = Math.max(8, Math.min(left, viewport.w - cpanelWidth - 8));
  return { left, bottom: Math.max(8, viewport.h - bar.offsetTop + 12) };
};
