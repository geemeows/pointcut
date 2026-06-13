<template>
  <main class="page">
    <h1 class="title">Pointcut tracer bullet</h1>
    <p class="lede">
      Click <strong>pick</strong> (bottom-right), then click any element below.
      Your editor opens at that element's exact spot in this file.
    </p>

    <section class="card">
      <h2>A card</h2>
      <button class="cta">Primary action</button>
      <button class="cta ghost">Secondary</button>
      <!-- Styled ONLY by the node_modules UI kit (.kit-button) — provenance
           should flag this as vendor-owned, with no NDS/Spark assumptions. -->
      <button class="kit-button">Vendor-styled button</button>
    </section>

    <ul class="list">
      <li v-for="item in items" :key="item">{{ item }}</li>
    </ul>

    <!-- Live proof that Tokens + Provenance are design-system-agnostic (#6).
         These run the REAL @pointcut/core models against this page. -->
    <section class="introspect">
      <h2>Introspection (issue #6)</h2>

      <h3>Tokens — classified by resolved value type, snapped to this project's own non-NDS tokens</h3>
      <table>
        <thead>
          <tr><th>Try value</th><th>Kind</th><th>Snaps to</th><th>off-scale?</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in snapRows" :key="r.label">
            <td>{{ r.input }}</td>
            <td>{{ r.kind }}</td>
            <td><code>{{ r.token }}</code> = {{ r.value }}</td>
            <td>{{ r.offScale }}</td>
          </tr>
        </tbody>
      </table>
      <p class="note">
        Color ramp introspected from <code>:root</code> (no name prefix needed):
        <span v-for="s in ramp" :key="s.name" class="swatch" :style="{ background: s.value }" :title="`${s.name} = ${s.value}`"></span>
      </p>

      <h3>Provenance — vendor-owned detected by stylesheet origin, not by name</h3>
      <table>
        <thead>
          <tr><th>Element</th><th>Property</th><th>sourceKind</th><th>winning selector</th><th>href</th></tr>
        </thead>
        <tbody>
          <tr v-for="p in provRows" :key="p.label">
            <td>{{ p.label }}</td>
            <td>{{ p.prop }}</td>
            <td :class="{ vendor: p.sourceKind === 'vendor' }">{{ p.sourceKind }}</td>
            <td><code>{{ p.selector }}</code></td>
            <td class="href">{{ p.href || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p class="note">
        The vendor row should read <strong>vendor</strong> with an href under
        <code>node_modules</code>. That is the only signal used — the class name
        (<code>.kit-button</code>) is deliberately non-namespaced.
      </p>
    </section>
  </main>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { createTokens, createProvenance } from '@pointcut/core/models';

const items = ref(['one', 'two', 'three']);

const snapRows = ref([]);
const ramp = ref([]);
const provRows = ref([]);

onMounted(() => {
  // ZERO-CONFIG tokens: no prefix hints. The project uses a --brand-* namespace
  // that Pointcut has never heard of; classification is purely by value type.
  const tokens = createTokens({ doc: document, win: window });
  ramp.value = tokens.colorRamp();

  snapRows.value = [
    { input: '22px', kind: 'length → spacing', ...flat(tokens.snapSpacing(22)) },
    { input: '15.5px', kind: 'length → font-size', ...flat(tokens.snapFontSize(15.5)) },
    { input: '600', kind: 'number → weight', ...flat(tokens.snapFontWeight(600)) },
    { input: '1.45', kind: 'number → line-height', ...flat(tokens.snapFontLineHeight(1.45)) },
  ];

  const prov = createProvenance({ doc: document });
  const sample = [
    { label: '.cta (app)', sel: '.cta', prop: 'padding' },
    { label: '.card (app)', sel: '.card', prop: 'border-radius' },
    { label: '.kit-button (vendor)', sel: '.kit-button', prop: 'background-color' },
  ];
  provRows.value = sample.map(({ label, sel, prop }) => {
    const el = document.querySelector(sel);
    const r = el ? prov.inspect(el, prop) : {};
    return { label, prop, sourceKind: r.sourceKind, selector: r.selector, href: r.href };
  });
});

function flat(snap) {
  return snap
    ? { token: snap.name, value: snap.value, offScale: String(snap.offScale) }
    : { token: '—', value: '', offScale: '—' };
}
</script>

<style>
/* Non-NDS, arbitrary token namespace declared on :root. Pointcut introspects
   these by VALUE TYPE — it has no knowledge of the `--brand-*` naming. */
:root {
  --brand-ink: #1f2a44;        /* color */
  --brand-accent: #3b5bdb;     /* color */
  --brand-wash: rgb(245, 247, 250); /* color */
  --space-snug: 8px;           /* length */
  --space-cozy: 16px;          /* length */
  --space-roomy: 24px;         /* length */
  --type-body: 1rem;           /* length (16px) */
  --type-lead: 20px;           /* length */
  --weight-bold: 700;          /* number */
  --leading-base: 1.5;         /* number */
}

.page { font-family: system-ui, sans-serif; max-width: 720px; margin: 48px auto; padding: 0 16px; color: var(--brand-ink); }
.title { font-size: var(--type-lead); }
.card { border: 1px solid #ddd; border-radius: 12px; padding: var(--space-cozy); margin: var(--space-roomy) 0; }
.cta { padding: 8px 14px; border-radius: 8px; border: none; background: var(--brand-ink); color: #fff; cursor: pointer; }
.cta.ghost { background: transparent; color: var(--brand-ink); border: 1px solid var(--brand-ink); }
.list { line-height: var(--leading-base); }

.introspect { margin-top: 40px; border-top: 1px dashed #ccc; padding-top: 16px; }
.introspect table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 8px 0; }
.introspect th, .introspect td { border: 1px solid #e3e3e3; padding: 4px 8px; text-align: left; }
.introspect .vendor { color: #c92a2a; font-weight: 700; }
.introspect .href { font-family: ui-monospace, monospace; font-size: 11px; word-break: break-all; }
.note { font-size: 12px; color: #555; }
.swatch { display: inline-block; width: 16px; height: 16px; border-radius: 3px; border: 1px solid #0002; margin-left: 4px; vertical-align: middle; }
</style>
