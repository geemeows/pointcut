---
name: pointcut-edits
description: >-
  Conventions for applying a Pointcut design-edit handoff in THIS React + Vite
  example. Use whenever a prompt describes a visual/style/copy change to a DOM
  element (button, card, heading, list, etc.) and references a
  data-pointcut-loc / file:line:col target, or asks to restyle/recolor/resize/
  reword something on the page. Demonstrates that a project-level skill is picked
  up by the agent Pointcut spawns at this project's root.
---

# Applying Pointcut edits — React + Vite example

This is a single-file demo app. A Pointcut handoff hands you a `file:line:col`
that resolves into **`src/App.jsx`** — make the edit there.

## Where things live
- All markup is in `src/App.jsx` as JSX host elements (`<main>`, `<h1>`,
  `<button>`, `<li>`, …). These are the only Source-Stamped nodes.
- `<Card>` is a component, not a host element — a click on its output resolves
  to the nearest stamped host *inside* it (e.g. the `<button class="cta">`).
- There is **no stylesheet** in this example; class names like `page`, `card`,
  `cta`, `ghost` are present but unstyled by design (tracer bullet).

## How to apply a change
- **Class / structural tweaks** → edit the JSX in `src/App.jsx` directly.
- **New visual styling** → prefer an inline `style={{ … }}` prop on the target
  element, so the change is self-contained and visible without introducing a
  build step. Do not add a global CSS import unless the handoff explicitly asks
  for a shared stylesheet.
- **Copy changes** → edit the text node in place; keep surrounding `<strong>` /
  inline markup intact.

## Don'ts
- Don't rename or remove `className` values other code may rely on.
- Don't touch `data-pointcut-loc` attributes — they're injected by the
  Source Stamp transform at build time, never authored by hand.
- Keep edits minimal and scoped to the element the handoff points at.
