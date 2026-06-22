/* eslint-disable */
// format — pure display formatters lifted from the client closure.
//
// Numbers/strings in, strings out. The two impure inputs the originals reached
// for globals for — the current time (Date.now) and the platform (navigator) —
// are passed in as `now` and `isMac` so the module stays pure and testable. The
// client supplies them at the call site.

// Coarse relative timestamp for a comment ("just now", "21h ago"). `ts` is the
// comment's createdAt (ms epoch); `now` is the reference time (the client passes
// Date.now()). Comments predating createdAt (legacy records, ts falsy) show no
// time.
export const relTime = (ts, now) => {
  if (!ts) return '';
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  return `${w}w ago`;
};

// Keyboard-shortcut label: the Alt key is Option (⌥) on Mac. `isMac` is the
// platform flag the client computes once from navigator.
export const KBD = (k, isMac) => (isMac ? '⌥' : 'Alt+') + k;

// Normalise a model-suggested thread title: first line only, strip wrapping
// quotes/backticks/asterisks/whitespace, drop trailing punctuation, collapse
// runs of whitespace, and ellipsise past 48 chars.
export const cleanTitle = (s) => {
  let t = String(s || '').trim().split('\n')[0].trim();
  t = t.replace(/^["'`*\s]+|["'`*\s]+$/g, '').replace(/[.,;:!?]+$/, '').replace(/\s+/g, ' ').trim();
  return t.length > 48 ? t.slice(0, 48) + '…' : t;
};
