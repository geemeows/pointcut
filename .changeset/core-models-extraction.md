---
"@pointcut/core": minor
---

Deepen the toolbar client into tested models. The 4.3k-line `mount()`
closure is now a thin DOM-glue layer; its geometry/placement math,
display formatters, the four inspector controls, the agent/model picker,
the agent Run lifecycle, and the CHANGE EDITOR state machine are extracted
into pure `models/*.mjs` modules (each with co-located tests) and exported
from `@pointcut/core/models`: `geometry`, `format`, `control`, `picker`,
`run`, plus `reduceEditor`/`designValuePool` on `changes` and `srcLabel`
on `loc`. Token-keyed Introspection that had leaked into the client
(`readType`, `SPACING_SIDE`) moves back behind the typography/spacing
models (ADR-0001). No client behaviour change.
