/* eslint-disable */
// Design Toolbar — Annotation Queue / Session (see ../design-toolbar-plugin.js).
//
// Owns the list of Annotations and everything about how it survives a reload:
// localStorage serialization, id minting, and legacy-record backfill. Mutations
// that change the set (add / remove / clear) persist as one step, so callers
// stop repeating the "mutate then persist" ritual. In-place edits to a record's
// fields (comment, screenshot…) are still done on the live object the caller
// holds, then committed with persist(). `storage` is injected for testability.
//
// all() returns the live array; remove/clear replace it, so read it fresh each
// time rather than caching the reference.
//
// A record may additionally carry an `edits[]` array of structured visual-tweak
// intents (D3, ADR 0002), each rendered into the handoff alongside the prose:
//   {
//     property,                          // CSS property, e.g. 'padding'
//     before,                            // current declared value, e.g. '20px'
//     after: { token, value, offScale }, // snapped NDS token (from 0001)
//     provenance,                        // where the style is defined (from 0002):
//                                        //   { selector, sourceKind, classList, guidance? }
//     role,                              // inferred semantic color role (0005); null otherwise
//   }
// A copy / text edit (0007) is a different shape, discriminated by `type`:
//   { type: 'copy', before, after }      // wording change; agent applies at source
// The queue does not validate either shape — it stores records as-is; handoff.mjs
// owns the rendering contract.
//
// Per-item send selection (0008) is persisted separately under `selectionKey`:
// a JSON array of selected ids. When that key was never written the default is
// "everything selected"; once written it is authoritative (even when empty, so
// an explicit deselect-all survives a reload). New items are selected by
// default; removed/cleared items drop out.
export const createQueue = ({ storage, storageKey, selectionKey, defaultType }) => {
  let items = [];
  try {
    const raw = storage.getItem(storageKey);
    if (raw) items = JSON.parse(raw);
  } catch (_) {
    items = [];
  }

  let seq = 0;
  const newId = () => `a${Date.now().toString(36)}${seq++}`;
  const persist = () => {
    try {
      storage.setItem(storageKey, JSON.stringify(items));
    } catch (_) {}
  };

  // Backfill records from older sessions that predate ids / type tags.
  let changed = false;
  items.forEach((a) => {
    if (!a.id) {
      a.id = newId();
      changed = true;
    }
    if (!a.type) {
      a.type = defaultType;
      changed = true;
    }
  });
  if (changed) persist();

  // Send selection — a Set of ids. Absent storage → default all selected.
  let selected;
  let selectionTouched = false;
  try {
    const raw = selectionKey != null ? storage.getItem(selectionKey) : null;
    if (raw != null) {
      selected = new Set(JSON.parse(raw));
      selectionTouched = true;
    }
  } catch (_) {}
  if (!selected) selected = new Set(items.map((a) => a.id));
  // Prune ids that no longer exist (items removed in a prior session).
  if (selectionTouched) {
    const live = new Set(items.map((a) => a.id));
    selected.forEach((id) => { if (!live.has(id)) selected.delete(id); });
  }
  const persistSelection = () => {
    if (selectionKey == null) return;
    try {
      storage.setItem(selectionKey, JSON.stringify([...selected]));
    } catch (_) {}
  };

  return {
    all: () => items,
    count: () => items.length,
    get: (id) => items.find((a) => a.id === id) || null,
    indexOf: (a) => items.indexOf(a),
    newId,
    persist, // commit in-place edits to a record the caller already mutated
    add: (a) => {
      items.push(a);
      selected.add(a.id); // new items are selected by default
      persist();
      persistSelection();
      return a;
    },
    remove: (id) => {
      items = items.filter((a) => a.id !== id);
      selected.delete(id);
      persist();
      persistSelection();
    },
    removeMany: (ids) => {
      const set = ids instanceof Set ? ids : new Set(ids);
      items = items.filter((a) => !set.has(a.id));
      set.forEach((id) => selected.delete(id));
      persist();
      persistSelection();
    },
    clear: () => {
      items = [];
      selected.clear();
      persist();
      persistSelection();
    },

    // ---- Send selection (0008) --------------------------------------------
    isSelected: (id) => selected.has(id),
    selectedItems: () => items.filter((a) => selected.has(a.id)),
    setSelected: (id, on) => {
      if (on) selected.add(id);
      else selected.delete(id);
      persistSelection();
    },
    selectAll: () => {
      items.forEach((a) => selected.add(a.id));
      persistSelection();
    },
    selectNone: () => {
      selected.clear();
      persistSelection();
    },
  };
};
