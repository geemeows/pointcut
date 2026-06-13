// @pointcut/core/client — the in-page toolbar (browser ESM).
//
// Injected in design mode only. Renders into a Shadow DOM (vanilla, no
// framework). Reaches the Bridge via a base URL stamped at build time:
// empty for same-origin auto-attach, http://localhost:<port> for the sidecar.
//
// This is the #4 tracer-bullet slice of the source toolbar's client.js,
// name-neutralized (`data-luciq-loc` → `data-pointcut-loc`, `/__luciq_open` →
// `/__pointcut/open`): just the hover/lock Pick path and jump-to-source. The
// drawer, chat, agent-run, and introspection panels arrive in later slices.
import { createLocator } from '../models/locator.mjs';

/** Replaced at build time by the unplugin `define`; '' means same-origin. */
declare const __POINTCUT_BRIDGE__: string | undefined;

export const bridgeBase: string = typeof __POINTCUT_BRIDGE__ === 'string' ? __POINTCUT_BRIDGE__ : '';

/** The Source Stamp attribute, mirrored from the Vue Stamper. */
const LOC_ATTR = 'data-pointcut-loc';
/** Host element id — also the HMR / double-inject guard. */
const HOST_ID = 'pointcut-host';

/** Mount the toolbar into the page. Idempotent — a second call is a no-op. */
export function mount(): void {
  if (typeof document === 'undefined') return; // SSR / non-browser
  if (document.getElementById(HOST_ID)) return; // HMR / double-inject guard

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        /* Pointcut identity — chartreuse-on-charcoal, scoped to the Shadow DOM.
           Chartreuse ramp (lemon → deep), anchored at chartreuse-500. */
        --pc-chartreuse-50:  #F8FFE6;
        --pc-chartreuse-200: #E2FD9B;
        --pc-chartreuse-400: #C5FB37;
        --pc-chartreuse-500: #B6FA05;
        --pc-chartreuse-700: #83C700;
        --pc-chartreuse-900: #1D6100;
        /* Charcoal neutral — the toolbar surface. */
        --pc-charcoal:    #1a1c1f;
        --pc-charcoal-ink: #0e0f11;
        --pc-on-charcoal: #e7e9ee;
      }
      .outline {
        position: fixed; z-index: 2147483646; pointer-events: none; display: none;
        border: 1px solid var(--pc-chartreuse-500);
        background: rgba(182,250,5,.10);
        border-radius: 2px;
      }
      .tag {
        position: fixed; z-index: 2147483647; pointer-events: none; display: none;
        font: 11px/1.4 ui-monospace, monospace;
        color: var(--pc-on-charcoal); background: var(--pc-charcoal-ink);
        border: 1px solid var(--pc-chartreuse-500);
        padding: 1px 6px; border-radius: 4px; transform: translateY(-100%);
        white-space: nowrap;
      }
      .puck {
        position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
        width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer;
        background: var(--pc-charcoal); color: var(--pc-on-charcoal);
        font: 600 11px/1 ui-sans-serif, system-ui;
        box-shadow: 0 6px 20px rgba(0,0,0,.4);
      }
      .puck.on {
        background: var(--pc-chartreuse-500); color: var(--pc-charcoal-ink);
      }
    </style>
    <div class="outline"></div>
    <div class="tag"></div>
    <button class="puck" title="Pick an element (Esc to exit)">pick</button>
  `;
  (document.body || document.documentElement).appendChild(host);

  const $ = <T extends Element>(sel: string) => shadow.querySelector(sel) as T;
  const outline = $<HTMLElement>('.outline');
  const tagLabel = $<HTMLElement>('.tag');
  const puck = $<HTMLButtonElement>('.puck');

  const locator = createLocator({ doc: document, win: window, locAttr: LOC_ATTR });

  let picking = false;

  // Is `node` part of our own Shadow DOM? Walk up parents AND shadow hosts.
  const isOwn = (node: Node | null): boolean => {
    let n: any = node;
    while (n) {
      if (n === host) return true;
      n = n.parentNode || n.host || null;
    }
    return false;
  };

  // A short, readable tag for the hovered element (tag#id.class.class).
  const labelFor = (el: Element): string => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (typeof el.className === 'string' && el.className.trim()) {
      s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    return s;
  };

  const hideOutline = () => {
    outline.style.display = 'none';
    tagLabel.style.display = 'none';
  };

  const positionOutline = (el: Element) => {
    const r = el.getBoundingClientRect();
    outline.style.display = 'block';
    outline.style.left = r.left + 'px';
    outline.style.top = r.top + 'px';
    outline.style.width = r.width + 'px';
    outline.style.height = r.height + 'px';
    tagLabel.style.display = 'block';
    tagLabel.style.left = r.left + 'px';
    tagLabel.style.top = Math.max(r.top, 14) + 'px';
    tagLabel.textContent = labelFor(el);
  };

  // ---- Jump-to-source ------------------------------------------------------
  // Parse a Source Stamp loc and hit the Bridge's editor-launch endpoint.
  const openInEditor = (loc: string | null) => {
    if (!loc || !loc.includes(':')) return;
    const [file = '', line, col] = loc.split(':');
    fetch(
      `${bridgeBase}/__pointcut/open?file=${encodeURIComponent(file)}&line=${line || 1}&col=${col || 1}`,
    ).catch(() => {});
  };

  const setPicking = (on: boolean) => {
    picking = on;
    puck.classList.toggle('on', on);
    if (!on) hideOutline();
  };

  // Hover highlights the element under the cursor (skipping our own UI).
  const onMove = (e: MouseEvent) => {
    if (!picking) return;
    const el = e.composedPath()[0] as Element | undefined;
    if (!el || !(el as any).nodeType || isOwn(el)) {
      hideOutline();
      return;
    }
    positionOutline(el);
  };

  // Click locks the pick: resolve to the nearest stamped ancestor and jump.
  const onClick = (e: MouseEvent) => {
    if (!picking) return;
    const target = e.composedPath()[0] as Element;
    if (isOwn(target)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = locator.stampedAncestor(target);
    openInEditor(el.getAttribute ? el.getAttribute(LOC_ATTR) : null);
    setPicking(false);
  };

  puck.addEventListener('click', (e) => {
    e.stopPropagation();
    setPicking(!picking);
  });
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && picking) setPicking(false);
  });
  window.addEventListener('scroll', hideOutline, true);
}

// Auto-mount on import: the client is injected as a bare `import` with no call
// site, so mounting is a module side-effect (guarded for SSR / double-inject).
mount();
