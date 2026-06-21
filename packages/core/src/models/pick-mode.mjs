/* eslint-disable */
// Pick mode + marquee — pure state machine, lifted from the client (issue #1).
//
// In pick mode a press-drag-release either HOVERS a single element (a plain
// click, no drag) or MARQUEES a region (the pointer travels past a threshold).
// The DECISIONS — when a press becomes a drag, the marquee's geometry, whether
// a release produced a region, and suppressing the synthetic click that follows
// a drag — are pure point math with no DOM.
//
// The client owns everything DOM: it reads `composedPath()`/`isOwn`, closes the
// popover/note, paints the outline + marquee elements, adds window scroll to map
// viewport→document, and calls openNote / attachChatChip / stampedAncestor. It
// translates real pointer events into the event objects below, applies the
// returned `state`, and acts on the returned `effect`.
//
//   state  = { dragStart: {x,y}|null, dragging: bool, justDragged: bool }
//   event  = { type, ... }  (see reducePickMode)
//   result = { state, effect }
//     effect.kind:
//       'none'    — nothing for the client to do beyond applying state
//       'hover'   — not dragging; client should outline the element under the pointer
//       'marquee' — dragging; effect.rect is the live viewport rect to paint
//       'region'  — drag released in comment mode; effect.rect is the final
//                   viewport rect (client adds scroll + opens a region note)
//       'click'   — a real (non-drag) click landed; client resolves + picks the el
//       'suppress'— the click that immediately follows a drag; client swallows it

export const initialPickState = () => ({ dragStart: null, dragging: false, justDragged: false });

// Axis-aligned rect spanning two points (viewport coords in, viewport rect out).
export const marqueeRect = (a, b) => ({
  left: Math.min(a.x, b.x),
  top: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

const result = (state, effect) => ({ state, effect: effect || { kind: 'none' } });

export const reducePickMode = (state, event) => {
  switch (event.type) {
    // Press: arm a potential drag from this point. The client has already done
    // its click-away (popover/note) bookkeeping and own-node guard; it passes
    // `picking` + `onOwn` so the model stays the single source of the gesture.
    case 'down': {
      if (!event.picking || event.onOwn) return result(state);
      return result({ ...state, dragStart: { x: event.x, y: event.y }, dragging: false });
    }

    // Move: once the pointer travels past `threshold` from the press, the gesture
    // becomes a marquee. While dragging, emit the live rect to paint; otherwise
    // the client should outline the element under the pointer ('hover').
    case 'move': {
      if (!event.picking) return result(state);
      let next = state;
      if (state.dragStart) {
        const cur = { x: event.x, y: event.y };
        let dragging = state.dragging;
        if (!dragging && Math.hypot(cur.x - state.dragStart.x, cur.y - state.dragStart.y) > event.threshold) {
          dragging = true;
        }
        if (dragging) {
          next = { ...state, dragging: true };
          return result(next, { kind: 'marquee', rect: marqueeRect(state.dragStart, cur) });
        }
        next = { ...state, dragging };
      }
      return result(next, { kind: 'hover' });
    }

    // Release: a drag produces a region (in comment mode only); the synthetic
    // click that follows is flagged for suppression via `justDragged`.
    case 'up': {
      if (!event.picking || !state.dragStart) return result(state);
      let effect = { kind: 'none' };
      let justDragged = state.justDragged;
      if (state.dragging) {
        justDragged = true;
        if (event.pickMode === 'comment') {
          effect = { kind: 'region', rect: marqueeRect(state.dragStart, { x: event.x, y: event.y }) };
        }
      }
      return result({ ...state, dragStart: null, dragging: false, justDragged }, effect);
    }

    // Click: swallow the click that fires right after a drag; otherwise it's a
    // real element pick.
    case 'click': {
      if (!event.picking) return result(state);
      if (state.justDragged) {
        return result({ ...state, justDragged: false }, { kind: 'suppress' });
      }
      return result(state, { kind: 'click' });
    }

    default:
      return result(state);
  }
};
