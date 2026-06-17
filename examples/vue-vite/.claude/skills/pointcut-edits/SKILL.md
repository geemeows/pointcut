---
name: pointcut-edits
description: >-
  Conventions for applying a Pointcut design-edit handoff in THIS Vue + Vite
  example. Use whenever a prompt describes a visual/style/copy change to a DOM
  element (button, card, heading, list, etc.) and references a
  data-pointcut-loc / file:line:col target, or asks to restyle/recolor/resize/
  reword something on the page. Demonstrates that a project-level skill is picked
  up by the agent Pointcut spawns at this project's root.
---

# Applying Pointcut edits — Vue + Vite example

A Pointcut handoff resolves into the SFC **`src/App.vue`** — both the markup and
the styles live in that one file.

## Where things live
- Markup is in the `<template>` block (`<main>`, `<h1>`, `<button>`, `<li>`, …).
- Styles are in the SFC `<style>` block at the bottom of the file.
- Design tokens are CSS custom properties on `:root` in that `<style>` block:
  `--brand-ink`, `--brand-accent`, `--brand-wash` (colors), `--space-*`
  (lengths), `--type-*` (lengths), `--weight-bold`, `--leading-base` (numbers).

## How to apply a change
- **Restyle an element** → edit its rule in the `<style>` block. **Reuse the
  existing tokens** (`var(--brand-accent)`, `var(--space-cozy)`, …) instead of
  hardcoding raw values — that's what keeps this example design-system-agnostic.
- **Markup / structural tweaks** → edit the `<template>`.
- **Copy changes** → edit the text in the template; preserve inline `<strong>`
  and interpolation (`{{ … }}`).

## Don'ts
- The `.kit-button` is **vendor-styled** from the node_modules UI kit — treat it
  as read-only; don't try to restyle it locally unless explicitly asked.
- Don't invent new `--*` token names; snap to the existing scale by value type.
- Don't touch `data-pointcut-loc` attributes (injected by the Source Stamp).
- Keep edits scoped to the element the handoff points at.
