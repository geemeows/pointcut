# Design-system agnosticism by runtime introspection, not configuration or adapters

Pointcut must work against any project's design system, but we deliberately reject
per-design-system **configuration** or **adapter packages** as the mechanism. Instead, the
token, provenance, and component-identity models **introspect the installing project from
the live browser at runtime**, because the browser already holds everything we need.

## Considered Options

- **Required config / adapter packages** (`@pointcut/adapter-*`, declared token ramps,
  `detectComponent` hooks). Precise, but every project pays a setup cost before the toolbar
  is useful, and we'd maintain an adapter per ecosystem. Rejected.
- **Runtime introspection (chosen).** Derive everything from universal browser signals.

## Decision

Three signals, all present without any project input:

1. **CSS value type** — enumerate all `:root` custom properties via `getComputedStyle` and
   classify by what each value *resolves to* (color / length / unitless number), not by a
   project-specific name prefix. Snapping a property's value to the nearest token needs no
   design-system knowledge.
2. **Stylesheet `href` origin** — the CSSOM cascade walk already finds the winning rule for
   `(element, property)`; if its stylesheet resolves under `node_modules` / a dependency
   origin, the style is library-owned → guidance becomes "change at the usage site, don't
   edit the dependency."
3. **Source Stamp file path** — component identity (and "is this a vendored dependency")
   comes from `data-pointcut-loc`, not from a hardcoded component/tag registry.

Configuration exists only as **optional refinement** (e.g. prefix hints for nicer palette
grouping/labels). It is never a prerequisite — Pointcut works zero-config on any project.

## Consequences

- The `tokens` and `provenance` models keep their public surface stable across design
  systems; the luciq-specific coupling they were extracted with (NDS prefixes, Spark/`ibg-`
  detection) collapses to value-typing + href-origin + the stamp.
- Categories that share a value type (spacing vs. font-size are both lengths) cannot be
  separated by introspection alone; this only affects palette *grouping*, not snapping, and
  is the job of the optional refinement layer.
- Provenance accuracy depends on stylesheets being reachable in the CSSOM (cross-origin
  sheets without CORS expose no `cssRules`) — acceptable for local dev, the only context
  Pointcut runs in.
