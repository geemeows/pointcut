/* eslint-disable */
// @ts-nocheck
// @pointcut/core/client — the in-page design toolbar (browser ESM).
//
// Vanilla JS rendered into a shadow root, NOT a framework component: the shadow
// boundary encapsulates styles both ways and the host is trivially excluded
// from Pick mode. Injected in design mode only (never ships).
//
// Flow: Pick mode highlights elements on hover and locks one on click — or drag
// a marquee to annotate a whole area. Each saved Annotation has a type tag and
// (for elements) a screenshot, and accumulates in a Session/Queue persisted to
// localStorage. Numbered bubbles pin to annotated spots. A tabbed drawer holds
// Comments (the Queue) and Chat (a continuous discuss session). "Export"
// downloads a paste-and-go markdown Handoff with screenshots embedded; "Send to
// agent" streams the chosen agent's Actions back through the Bridge. The source
// loc is clickable to open the file in your editor.
//
// Pure-logic lives in the sibling models (../models/*.mjs) so this file is only
// glue + DOM. The whole thing is wrapped in mount() (idempotent, SSR-safe) and
// auto-mounts on import — the unplugin injects a bare `import '@pointcut/core/client'`.
import { toPng } from 'html-to-image';
import { createQueue } from '../models/queue.mjs';
import { createLocator } from '../models/locator.mjs';
// @ts-ignore — .mjs siblings, typed structurally by the builders' contract.
import { buildHandoff, contextChipsBlock } from '../models/handoff.mjs';
import { streamAgentRun } from '../models/agent-run.mjs';
import { createTokens } from '../models/tokens.mjs';
import { createProvenance } from '../models/provenance.mjs';
import { createSpacingModel } from '../models/spacing.mjs';
import { createColorModel } from '../models/color.mjs';
import { createTypographyModel } from '../models/typography.mjs';
import { createCopyModel } from '../models/copy.mjs';
import { createChat } from '../models/chat.mjs';

/** Replaced at build time by the unplugin `define`; '' means same-origin. */
declare const __POINTCUT_BRIDGE__: string | undefined;

/** Bridge origin: '' for same-origin auto-attach, http://localhost:<port> for the sidecar. */
export const bridgeBase: string = typeof __POINTCUT_BRIDGE__ === 'string' ? __POINTCUT_BRIDGE__ : '';

/** Every Bridge call routes through here so the sidecar's cross-origin base is honoured. */
const bridgeFetch = (url, init) => fetch(bridgeBase + url, init);

/** Mount the toolbar into the page. Idempotent — a second call is a no-op. */
export function mount() {
  if (typeof document === 'undefined') return; // SSR / non-browser

  const HOST_ID = 'pointcut-host';
  const STORAGE_KEY = 'pointcut:queue';
  const SELECTION_KEY = 'pointcut:queue:selected';
  const TAB_KEY = 'pointcut:tab';
  const CHAT_KEY = 'pointcut:chat';
  const POS_KEY = 'pointcut:bar-pos';
  const LOC_ATTR = 'data-pointcut-loc';
  const DRAG_THRESHOLD = 6; // px before a press becomes a region drag

  if (document.getElementById(HOST_ID)) return; // HMR / double-inject guard

  // Curated subset of computed styles (CONTEXT.md "Key styles") — not the full dump.
  const KEY_STYLES = [
    'color', 'background-color', 'font-family', 'font-size', 'font-weight',
    'line-height', 'padding', 'margin', 'border', 'width', 'height', 'display',
    'position', 'flex-direction', 'justify-content', 'align-items', 'gap',
  ];

  // Annotation type tags — drive the bubble colour and group the payload.
  const TYPES = [
    { id: 'layout', label: 'Layout', color: '#2f6bff' },
    { id: 'spacing', label: 'Spacing', color: '#16a394' },
    { id: 'color', label: 'Color', color: '#b25fe6' },
    { id: 'copy', label: 'Copy', color: '#e08a1e' },
    { id: 'a11y', label: 'A11y', color: '#d14b4b' },
    { id: 'other', label: 'Other', color: '#6b7280' },
  ];

  // ---- Session / Queue + element Locator -----------------------------------
  // The Queue owns the annotation list, its localStorage persistence, id
  // minting and legacy backfill; the Locator re-finds each annotation's live
  // element across reloads. Both live in sibling modules (queue.mjs /
  // locator.mjs) so their logic is unit-testable without a browser.
  const Q = createQueue({ storage: localStorage, storageKey: STORAGE_KEY, selectionKey: SELECTION_KEY, defaultType: TYPES[0].id });
  const locator = createLocator({ doc: document, win: window, locAttr: LOC_ATTR });
  // Chat tab (issue 0010): its own continuous discuss session + transcript,
  // persisted independently of the Comments-tab runs (separate session id).
  const chat = createChat({ storage: localStorage, storageKey: CHAT_KEY });

  // Visual-authoring helpers (Track A): read the live NDS token scale, resolve
  // where a style is defined, and step spacing through that scale. Wired into
  // the note box below as the first end-to-end control (0004).
  const tokens = createTokens({ doc: document, win: window });
  const provenance = createProvenance({ doc: document });
  const spacingModel = createSpacingModel({ tokens });
  const colorModel = createColorModel({ tokens });
  const typographyModel = createTypographyModel({ tokens });
  const copyModel = createCopyModel();
  // Which computed side stands in for each shorthand when reading the current
  // value (the stepper is uniform, so one side is representative).
  const SPACING_SIDE = { padding: 'paddingTop', margin: 'marginTop', gap: 'rowGap' };
  // Read an element's current value for a typography facet as the number its
  // scale is keyed on (0006). Computed line-height resolves to px, so divide by
  // font-size to recover the unitless ratio the --font-line-height-* tokens use;
  // 'normal' (no numeric line-height) yields NaN → the model seeds at scale[0].
  const readType = (el, property) => {
    const cs = getComputedStyle(el);
    if (property === 'line-height') {
      const lh = parseFloat(cs.lineHeight);
      const fs = parseFloat(cs.fontSize);
      return Number.isFinite(lh) && fs ? lh / fs : NaN;
    }
    return parseFloat(cs[property === 'font-size' ? 'fontSize' : 'fontWeight']);
  };

  // Keyboard-shortcut labels: the Alt key is Option (⌥) on Mac. We match on
  // e.code (physical key) so Option+letter — which mutates e.key on Mac — still works.
  const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
  const KBD = (k) => (IS_MAC ? '⌥' : 'Alt+') + k;

  // Neutral agent mark (a four-point sparkle), filled with currentColor —
  // agent-agnostic, reused on the bar Send button and the drawer head.
  const AGENT_ICON =
    '<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 1.5l2.35 6.9 6.9 2.35-6.9 2.35L12 20l-2.35-6.9L2.75 10.75l6.9-2.35z"/></svg>';

  // Pointcut brand mark, shown as the brand and alone when the bar collapses to
  // a circle. Colors are driven by currentColor so it inherits --pc-accent (the
  // same chartreuse the source asset hardcodes as #B6FA05); the negative-space
  // cut is carved with a mask so it reads on any background.
  const SPARK_ICON =
    '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Pointcut"><defs><mask id="pc-gap-mask"><rect width="1024" height="1024" fill="white"/><path d="M512 448 L580 512 L512 576 L444 512 Z" fill="black"/></mask></defs><g mask="url(#pc-gap-mask)" fill="currentColor"><path d="M154 480 H386 L438 512 L386 544 H154 C136 544 122 530 122 512 C122 494 136 480 154 480 Z"/><path d="M638 480 H870 C888 480 902 494 902 512 C902 530 888 544 870 544 H638 C620 544 606 530 606 512 C606 494 620 480 638 480 Z"/><path d="M512 154 V386 L626 500" fill="none" stroke="currentColor" stroke-width="72" stroke-linecap="round" stroke-linejoin="bevel"/><path d="M512 870 V638 L626 524" fill="none" stroke="currentColor" stroke-width="72" stroke-linecap="round" stroke-linejoin="bevel"/><path d="M364 404 H424 L470 450 H410 Z"/><path d="M364 620 H424 L470 574 H410 Z"/></g></svg>';

  // ---- Brand wordmark font -------------------------------------------------
  // The "Pointcut" wordmark uses Anta (Google Fonts). Fonts load at the document
  // level — @font-face inside a shadow root is ignored — so we inject the
  // stylesheet into <head> once; the shadow DOM then picks it up by family name.
  if (!document.getElementById('pointcut-font-anta')) {
    const fontLink = document.createElement('link');
    fontLink.id = 'pointcut-font-anta';
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Anta&display=swap';
    document.head.appendChild(fontLink);
  }

  // ---- Shadow host ---------------------------------------------------------
  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        /* Pointcut accent — chartreuse, swapped in for the source toolbar's lemon. */
        --pc-accent: #B6FA05;
        --pc-accent-hover: #C5FB37;
        --pc-ink: #0e0f11;
      }
      .layer {
        position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .outline {
        position: fixed; display: none; pointer-events: none;
        outline: 2px solid #2f6bff; background: rgba(47,107,255,.08); box-sizing: border-box;
      }
      .tag {
        position: fixed; display: none; pointer-events: none;
        background: #2f6bff; color: #fff; font-size: 11px; line-height: 1;
        padding: 3px 6px; border-radius: 3px; white-space: nowrap; transform: translateY(-100%);
      }
      .marquee {
        position: fixed; display: none; pointer-events: none;
        border: 1.5px dashed #2f6bff; background: rgba(47,107,255,.10); box-sizing: border-box;
      }
      .bar {
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        width: max-content; /* size to content, not the space left of the left edge (else it wraps near the right edge) */
        pointer-events: auto; display: flex; align-items: center; gap: 4px;
        background: #161719; color: #fff; padding: 6px; border-radius: 16px;
        box-shadow: 0 10px 34px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.05);
        font-size: 14px; user-select: none;
      }
      /* Drag handle — grab to move the whole bar; switches it to free left/top. */
      .grip {
        display: inline-flex; align-items: center; justify-content: center; flex: none;
        align-self: stretch; padding: 0 2px; cursor: grab; color: rgba(255,255,255,.3);
        transition: color .12s;
      }
      .grip:hover { color: rgba(255,255,255,.6); }
      .grip.dragging { cursor: grabbing; color: rgba(255,255,255,.6); }
      .grip svg { width: 15px; height: 18px; display: block; }
      /* Collapsed state — the bar shrinks to the brand circle showing only the
         puck. Colors mirror the collapsed-button brand asset: a near-black fill,
         a faint cool-grey ring, and a soft drop shadow. */
      .bar.collapsed {
        padding: 0; gap: 0; border-radius: 50%;
        background: #101214;
        box-shadow: 0 0 0 1px #2A2F36, 0 12px 28px rgba(0,0,0,.5);
      }
      .bar.collapsed > :not(.puck) { display: none; }
      .puck { display: none; }
      .bar.collapsed .puck {
        display: inline-flex; align-items: center; justify-content: center;
        width: 48px; height: 48px; cursor: grab; color: var(--pc-accent);
        overflow: hidden; border-radius: 50%;
      }
      .bar.collapsed .puck.dragging { cursor: grabbing; }
      /* The mark's glyph fills ~76% of its viewBox, so a 48px box matches the
         48px circle with the glyph filling it the way the brand asset does. */
      .puck svg { width: 48px; height: 48px; display: block; }
      .brand { display: inline-flex; align-items: center; gap: 4px; padding: 0 8px 0 6px; flex: none; color: var(--pc-accent); }
      .brand-name {
        font-family: 'Anta', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 18px; font-weight: 400; letter-spacing: .01em; color: #fff; white-space: nowrap;
      }
      /* Negative margins keep the mark's transparent padding from inflating the pill's height. */
      .brand svg { height: 36px; width: auto; display: block; margin: -3px 0; }
      .tool {
        all: unset; box-sizing: border-box; cursor: pointer; position: relative; display: inline-flex;
        align-items: center; gap: 8px; padding: 8px 12px; border-radius: 11px;
        color: #fff; line-height: 1; transition: background .12s, color .12s;
      }
      .tool:hover { background: rgba(255,255,255,.07); }
      .tool svg { width: 19px; height: 19px; display: block; flex: none; }
      .tool .lbl { font-size: 14px; font-weight: 500; }
      .tool .kbd { font-size: 11px; font-weight: 500; opacity: .4; letter-spacing: .02em; }
      .tool.on { background: #2a2c2f; color: var(--pc-accent); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }
      .tool.on .kbd { opacity: .65; }
      .tool[disabled] { opacity: .35; cursor: not-allowed; }
      .divider { width: 1px; height: 22px; background: rgba(255,255,255,.14); margin: 0 4px; flex: none; }
      .icon-btn {
        all: unset; box-sizing: border-box; cursor: pointer; position: relative;
        display: inline-flex; align-items: center; justify-content: center;
        width: 38px; height: 38px; border-radius: 11px; color: #fff; transition: background .12s;
      }
      .icon-btn:hover, .icon-btn.on { background: rgba(255,255,255,.09); }
      .icon-btn svg { width: 20px; height: 20px; display: block; }
      .icon-btn[data-tip]::after {
        content: attr(data-tip); position: absolute; bottom: calc(100% + 8px); left: 50%;
        transform: translateX(-50%) translateY(2px);
        background: #0c0d0f; color: #fff; font-size: 11px; font-weight: 500; line-height: 1;
        padding: 5px 8px; border-radius: 6px; white-space: nowrap; opacity: 0; pointer-events: none;
        transition: opacity .12s, transform .12s; box-shadow: 0 4px 14px rgba(0,0,0,.45);
      }
      .icon-btn[data-tip]:hover::after { opacity: 1; transform: translateX(-50%) translateY(0); }
      .icon-btn.danger { color: #ff8d8d; }
      .icon-btn.danger:hover { background: rgba(255,90,90,.12); }
      .icon-btn[disabled] { color: rgba(255,255,255,.3); cursor: not-allowed; }
      .cbadge {
        position: absolute; top: 1px; right: 1px; min-width: 16px; height: 16px; padding: 0 4px;
        border-radius: 8px; background: var(--pc-accent); color: var(--pc-ink); font-size: 10px; font-weight: 700;
        display: none; align-items: center; justify-content: center; box-sizing: border-box;
      }
      .cbadge.show { display: flex; }
      .scrim {
        position: fixed; inset: 0; pointer-events: auto; background: rgba(0,0,0,.28); display: none;
      }
      .scrim.open { display: block; }
      .drawer {
        position: fixed; top: 0; right: 0; height: 100%; width: 384px; max-width: 92vw;
        pointer-events: auto; background: #161719; color: #fff; box-sizing: border-box;
        box-shadow: -12px 0 40px rgba(0,0,0,.45); transform: translateX(100%);
        transition: transform .22s cubic-bezier(.4,0,.2,1); display: flex; flex-direction: column;
      }
      .drawer.open { transform: translateX(0); }
      .drawer-head {
        display: flex; align-items: center; gap: 8px; padding: 16px 18px;
        border-bottom: 1px solid rgba(255,255,255,.08); flex: none;
      }
      .drawer-head .dtitle { font-size: 15px; font-weight: 600; }
      .drawer-head .dcount { font-size: 12px; opacity: .5; }
      .drawer-head .dclose {
        all: unset; cursor: pointer; margin-left: 8px; width: 30px; height: 30px; border-radius: 8px;
        display: inline-flex; align-items: center; justify-content: center; color: #cfd5df; flex: none;
      }
      .drawer-head .dclose:hover { background: rgba(255,255,255,.08); color: #fff; }
      .drawer-head .dclose svg { width: 17px; height: 17px; }
      .drawer-head .dmin {
        all: unset; cursor: pointer; margin-left: auto; width: 30px; height: 30px; border-radius: 8px;
        display: inline-flex; align-items: center; justify-content: center; color: #cfd5df; flex: none;
      }
      .drawer-head .dmin:hover { background: rgba(255,255,255,.08); color: #fff; }
      .drawer-head .dmin svg { width: 16px; height: 16px; transition: transform .15s; }
      .drawer-head.collapsed .dmin svg { transform: rotate(-90deg); }
      /* Tab strip — Comments | Chat. Chat is a stub this issue (0008). */
      .drawer-tabs { flex: none; display: flex; gap: 2px; padding: 0 12px; border-bottom: 1px solid rgba(255,255,255,.08); }
      .drawer-tabs.collapsed { display: none; }
      .dtab {
        appearance: none; background: none; border: none; cursor: pointer;
        padding: 10px 12px; font: inherit; font-size: 13px; font-weight: 600;
        color: rgba(231,233,238,.55); border-bottom: 2px solid transparent; margin-bottom: -1px;
      }
      .dtab:hover { color: #e7e9ee; }
      .dtab.active { color: #fff; border-bottom-color: var(--pc-accent); }
      /* Chat tab (0010) — a continuous discuss session: transcript + composer
         with an "Apply changes" toggle. Hidden until the Chat tab is active. */
      .chat-pane { display: none; flex: 1 1 0; min-height: 0; flex-direction: column; }
      .drawer.tab-chat .chat-pane { display: flex; }
      .drawer.tab-chat .drawer-list, .drawer.tab-chat .drawer-stream, .drawer.tab-chat .drawer-composer { display: none; }
      .chat-stream { flex: 1 1 0; min-height: 0; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
      .chat-empty { opacity: .5; text-align: center; padding: 48px 16px; font-size: 13px; line-height: 1.6; }
      .chat-composer { flex: none; position: relative; border-top: 1px solid rgba(255,255,255,.08); padding: 12px; }
      .chat-composer > .cstatus { padding: 0 2px 8px; }
      /* "Apply changes" toggle — OFF = discuss (propose only), ON = apply this one turn. */
      .apply-toggle {
        all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 7px;
        font-size: 12px; color: rgba(231,233,238,.7); user-select: none;
      }
      .apply-toggle:hover { color: #e7e9ee; }
      .apply-switch {
        flex: none; width: 30px; height: 17px; border-radius: 999px; background: rgba(255,255,255,.16);
        position: relative; transition: background .15s;
      }
      .apply-switch::after {
        content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%;
        background: #fff; transition: transform .15s;
      }
      .apply-toggle.on .apply-switch { background: var(--pc-accent); }
      .apply-toggle.on .apply-switch::after { transform: translateX(13px); }
      .apply-toggle.on { color: var(--pc-accent); }
      /* Per-item send checkbox on a comment card. */
      .crow-check {
        appearance: none; -webkit-appearance: none; flex: none; cursor: pointer;
        width: 16px; height: 16px; border-radius: 4px; border: 1.5px solid rgba(255,255,255,.28);
        background: transparent; position: relative; margin: 0;
      }
      .crow-check:hover { border-color: rgba(255,255,255,.5); }
      .crow-check:checked { background: var(--pc-accent); border-color: var(--pc-accent); }
      .crow-check:checked::after {
        content: ''; position: absolute; left: 4.5px; top: 1.5px; width: 4px; height: 8px;
        border: solid var(--pc-ink); border-width: 0 2px 2px 0; transform: rotate(45deg);
      }
      .drawer-list { flex: 1 1 0; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
      .drawer-list.collapsed { display: none; }
      .drawer-empty { opacity: .5; text-align: center; padding: 48px 16px; font-size: 13px; line-height: 1.6; }
      /* Claude transcript — shares the drawer with the comment list; hidden until used. */
      .drawer-stream {
        flex: 1 1 0; min-height: 0; overflow-y: auto; padding: 12px 14px;
        display: flex; flex-direction: column; gap: 8px; border-top: 1px solid rgba(255,255,255,.08);
      }
      .drawer-stream:empty { display: none; }
      /* Composer — chat-style input box at the drawer foot: selected comments
         render as chips, the textarea is borderless, the send button sits inside. */
      .drawer-composer { flex: none; position: relative; border-top: 1px solid rgba(255,255,255,.08); padding: 12px; }
      /* "@" comment picker — floats above the composer box. */
      .mention-pop {
        position: absolute; left: 12px; right: 12px; bottom: 100%; margin-bottom: 8px; display: none;
        flex-direction: column; gap: 2px; max-height: 240px; overflow-y: auto; z-index: 5;
        background: #1b1d21; border: 1px solid #2b313c; border-radius: 12px; padding: 6px;
        box-shadow: 0 12px 36px rgba(0,0,0,.5);
      }
      .mention-pop.open { display: flex; }
      .mitem {
        all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 9px;
        padding: 7px 9px; border-radius: 8px; color: #e7e9ee;
      }
      .mitem.active, .mitem:hover { background: #2a2c30; }
      .mitem-num {
        width: 18px; height: 18px; border-radius: 50% 50% 50% 2px; background: var(--pc-accent); color: var(--pc-ink);
        font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; flex: none;
      }
      .mitem-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
      .mitem-src {
        flex: none; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        font-family: ui-monospace, monospace; font-size: 10px; color: #8b93a1;
      }
      .mention-empty { padding: 9px; font-size: 12px; color: #8b93a1; }
      .composer-box {
        display: flex; flex-direction: column; gap: 8px; background: #11141a;
        border: 1px solid #2b313c; border-radius: 12px; padding: 9px 10px;
      }
      .composer-box:focus-within { border-color: var(--pc-accent); box-shadow: 0 0 0 3px rgba(182,250,5,.22); }
      .composer-chips, .chat-chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .composer-chips:empty, .chat-chips:empty { display: none; }
      .chip {
        display: inline-flex; align-items: center; gap: 6px; padding: 3px 5px 3px 4px;
        border-radius: 999px; background: #2a2c30; font-size: 11px; color: #e7e9ee; max-width: 100%;
      }
      .chip .chip-num {
        width: 15px; height: 15px; border-radius: 50%; background: var(--pc-accent); color: var(--pc-ink); font-size: 9px;
        font-weight: 700; display: inline-flex; align-items: center; justify-content: center; flex: none;
      }
      .chip .chip-lbl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
      .chip .chip-x { all: unset; cursor: pointer; opacity: .5; font-size: 14px; line-height: 1; padding: 0 1px; flex: none; }
      .chip .chip-x:hover { opacity: 1; color: #ff8d8d; }
      .composer-box textarea {
        width: 100%; box-sizing: border-box; min-height: 70px; max-height: 140px; resize: none;
        background: transparent; color: #fff; border: 0; padding: 2px; font: inherit; font-size: 13px;
      }
      .composer-box textarea:focus { outline: none; }
      .composer-bar { display: flex; align-items: center; gap: 10px; }
      .composer-bar .sel-info { font-size: 11px; opacity: .5; }
      .dsend {
        all: unset; box-sizing: border-box; cursor: pointer; margin-left: auto; flex: none;
        display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
        border-radius: 8px; background: var(--pc-accent); color: var(--pc-ink); transition: background .12s;
      }
      .dsend:hover { background: var(--pc-accent-hover); }
      .dsend[disabled] { background: rgba(182,250,5,.3); color: rgba(24,26,14,.5); cursor: not-allowed; }
      .dsend svg { width: 16px; height: 16px; display: block; }
      .crow {
        background: #1d1e21; border: 1px solid rgba(255,255,255,.06); border-radius: 14px;
        padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; cursor: pointer;
        transition: border-color .12s, background .12s, transform .12s;
      }
      .crow:hover { border-color: rgba(255,255,255,.16); background: #212327; }
      .crow.collapsed { gap: 0; }
      .crow.collapsed .crow-detail { display: none; }
      .crow-detail { display: flex; flex-direction: column; gap: 10px; padding-top: 4px; }
      .crow-caret { width: 14px; height: 14px; opacity: .4; flex: none; transition: transform .15s, opacity .12s; }
      .crow:hover .crow-caret { opacity: .7; }
      .crow.collapsed .crow-caret { transform: rotate(-90deg); }
      .crow-top { display: flex; align-items: center; gap: 10px; }
      .crow-num {
        width: 22px; height: 22px; border-radius: 50% 50% 50% 2px; background: var(--pc-accent); color: var(--pc-ink);
        font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex: none;
        border: 1.5px solid #fff;
      }
      .crow-top .src { margin-bottom: 0; min-width: 0; flex: 1; }
      /* Per-row edit/delete — quiet until the row is hovered, so collapsed rows scan clean. */
      .crow-tools { display: flex; gap: 2px; flex: none; opacity: 0; transition: opacity .12s; }
      .crow:hover .crow-tools, .crow:focus-within .crow-tools { opacity: 1; }
      .crow-act {
        all: unset; box-sizing: border-box; cursor: pointer; position: relative; flex: none;
        display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
        border-radius: 7px; color: #8b93a1; transition: background .12s, color .12s;
      }
      .crow-act svg { width: 15px; height: 15px; }
      .crow-act:hover { background: #2a2c30; color: #e7e9ee; }
      .crow-act.danger:hover { background: rgba(255,90,90,.12); color: #ff8d8d; }
      .crow-act[data-tip]::after {
        content: attr(data-tip); position: absolute; bottom: calc(100% + 6px); left: 50%;
        transform: translateX(-50%) translateY(2px);
        background: #0c0d0f; color: #fff; font-size: 11px; font-weight: 500; line-height: 1;
        padding: 5px 8px; border-radius: 6px; white-space: nowrap; opacity: 0; pointer-events: none;
        transition: opacity .12s, transform .12s; box-shadow: 0 4px 14px rgba(0,0,0,.45);
      }
      .crow-act:hover::after { opacity: 1; transform: translateX(-50%) translateY(0); }
      /* Collapsible screenshot disclosure (popover + drawer rows) */
      .shot-wrap { display: flex; flex-direction: column; }
      .popover .shot-wrap { margin-bottom: 12px; }
      .disclosure {
        all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
        align-self: flex-start; font-size: 11px; font-weight: 600; letter-spacing: .03em; text-transform: uppercase;
        color: #8b93a1; margin-bottom: 8px; transition: color .12s;
      }
      .disclosure:hover { color: #cfd5df; }
      .disclosure .chev { width: 13px; height: 13px; transition: transform .15s; }
      .shot, .crow-shot {
        width: 100%; border-radius: 10px; display: block; border: 1px solid rgba(255,255,255,.08);
      }
      .shot-wrap.collapsed .shot, .shot-wrap.collapsed .crow-shot { display: none; }
      .shot-wrap.collapsed .disclosure { margin-bottom: 0; }
      .shot-wrap.collapsed .disclosure .chev { transform: rotate(-90deg); }
      /* Titled blockquote comment (popover + drawer rows) */
      .comment-title {
        font-size: 11px; font-weight: 600; letter-spacing: .03em; text-transform: uppercase;
        color: #8b93a1; margin-bottom: 6px;
      }
      .body, .crow-body {
        margin: 0; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
        color: #e7e9ee; border-left: 3px solid rgba(255,255,255,.16); background: rgba(255,255,255,.035);
        border-radius: 0 7px 7px 0; padding: 8px 11px;
      }
      .panel {
        position: fixed; pointer-events: auto; display: none;
        background: #1b1d21; color: #fff; padding: 14px; border-radius: 14px;
        box-shadow: 0 12px 36px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.06);
        width: 320px; box-sizing: border-box; font-size: 13px;
      }
      .panel.note { width: 400px; }
      .src {
        display: inline-flex; align-items: center; gap: 6px; max-width: 100%; box-sizing: border-box;
        background: rgba(255,255,255,.05); border-radius: 7px; padding: 5px 8px; margin-bottom: 12px;
        font-family: ui-monospace, monospace; font-size: 11px; color: #aeb6c2;
      }
      .src svg { width: 13px; height: 13px; flex: none; opacity: .7; }
      .src .src-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .src.linkable { cursor: pointer; }
      .src.linkable:hover { color: #8fb4ff; background: rgba(143,180,255,.12); }
      .shot-toggle {
        display: inline-flex; align-items: center; gap: 7px; cursor: pointer; margin-right: auto;
        color: #cfd5df; font-size: 11px; user-select: none;
      }
      .shot-toggle input { width: 15px; height: 15px; margin: 0; border-radius: 4px; accent-color: var(--pc-accent); cursor: pointer; }
      .panel textarea {
        width: 100%; box-sizing: border-box; min-height: 76px; resize: none;
        background: #11141a; color: #fff; border: 1px solid #2b313c; border-radius: 12px;
        padding: 9px 10px; font: inherit; font-size: 13px;
      }
      .panel textarea:focus { outline: none; border-color: var(--pc-accent); box-shadow: 0 0 0 3px rgba(182,250,5,.22); }
      /* Spacing control (note box, element picks only) — 0004 */
      .spacing-ctl { display: none; align-items: center; gap: 8px; margin-top: 10px; }
      .spacing-ctl.show { display: flex; }
      .sp-props { display: inline-flex; gap: 4px; }
      .sp-prop {
        all: unset; box-sizing: border-box; cursor: pointer; padding: 5px 10px; border-radius: 8px;
        background: #11141a; border: 1px solid #2b313c; color: #cfd5df; font-size: 11px; font-weight: 500;
        transition: background .12s, border-color .12s, color .12s;
      }
      .sp-prop:hover { background: #1b1f27; }
      .sp-prop.active { background: rgba(22,163,148,.18); border-color: #16a394; color: #7ff0e0; }
      .sp-stepper { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }
      .sp-stepper[hidden] { display: none; }
      .sp-step {
        all: unset; box-sizing: border-box; cursor: pointer; width: 26px; height: 26px; border-radius: 8px;
        display: inline-flex; align-items: center; justify-content: center; font-size: 16px; line-height: 1;
        background: #2a2c30; color: #e7e9ee; transition: background .12s;
      }
      .sp-step:hover { background: #363940; }
      .sp-readout {
        min-width: 132px; text-align: center; font-size: 11px; color: #e7e9ee;
        font-variant-numeric: tabular-nums;
      }
      .sp-readout .sp-token { color: #7ff0e0; font-weight: 600; }
      .sp-readout .sp-off { color: #e0b34b; margin-left: 5px; }
      /* Color control (note box, element picks only) — 0005 */
      .color-ctl { display: none; flex-direction: column; gap: 8px; margin-top: 10px; }
      .color-ctl.show { display: flex; }
      .cl-props { display: inline-flex; gap: 4px; }
      .cl-prop {
        all: unset; box-sizing: border-box; cursor: pointer; padding: 5px 10px; border-radius: 8px;
        background: #11141a; border: 1px solid #2b313c; color: #cfd5df; font-size: 11px; font-weight: 500;
        transition: background .12s, border-color .12s, color .12s;
      }
      .cl-prop:hover { background: #1b1f27; }
      .cl-prop.active { background: rgba(22,163,148,.18); border-color: #16a394; color: #7ff0e0; }
      .cl-panel { display: flex; flex-direction: column; gap: 8px; }
      .cl-panel[hidden] { display: none; }
      .cl-role { font-size: 11px; color: #9aa3b2; }
      .cl-role .cl-rname { color: #7ff0e0; font-weight: 600; }
      .cl-role.none { color: #e0b34b; }
      .cl-ramp { display: flex; flex-wrap: wrap; gap: 6px; }
      .cl-swatch {
        all: unset; box-sizing: border-box; cursor: pointer; width: 22px; height: 22px; border-radius: 6px;
        border: 1px solid rgba(255,255,255,.18); transition: transform .1s, box-shadow .1s;
      }
      .cl-swatch:hover { transform: scale(1.12); }
      .cl-swatch.active { box-shadow: 0 0 0 2px #11141a, 0 0 0 4px #7ff0e0; }
      /* Typography control (note box, element picks only) — 0006 */
      .type-ctl { display: none; align-items: center; gap: 8px; margin-top: 10px; }
      .type-ctl.show { display: flex; }
      .ty-props { display: inline-flex; gap: 4px; }
      .ty-prop {
        all: unset; box-sizing: border-box; cursor: pointer; padding: 5px 10px; border-radius: 8px;
        background: #11141a; border: 1px solid #2b313c; color: #cfd5df; font-size: 11px; font-weight: 500;
        transition: background .12s, border-color .12s, color .12s;
      }
      .ty-prop:hover { background: #1b1f27; }
      .ty-prop.active { background: rgba(22,163,148,.18); border-color: #16a394; color: #7ff0e0; }
      .ty-stepper { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }
      .ty-stepper[hidden] { display: none; }
      .ty-step {
        all: unset; box-sizing: border-box; cursor: pointer; width: 26px; height: 26px; border-radius: 8px;
        display: inline-flex; align-items: center; justify-content: center; font-size: 16px; line-height: 1;
        background: #2a2c30; color: #e7e9ee; transition: background .12s;
      }
      .ty-step:hover { background: #363940; }
      .ty-readout {
        min-width: 148px; text-align: center; font-size: 11px; color: #e7e9ee;
        font-variant-numeric: tabular-nums;
      }
      .ty-readout .ty-token { color: #7ff0e0; font-weight: 600; }
      .ty-readout .ty-off { color: #e0b34b; margin-left: 5px; }
      /* Copy / text control (note box, text-leaf element picks only) — 0007 */
      .copy-ctl { display: none; flex-direction: column; gap: 6px; margin-top: 10px; }
      .copy-ctl.show { display: flex; }
      .copy-ctl .cp-label { font-size: 11px; font-weight: 500; color: #cfd5df; }
      .cp-text {
        all: unset; box-sizing: border-box; width: 100%; padding: 7px 9px; border-radius: 8px;
        background: #11141a; border: 1px solid #2b313c; color: #e7e9ee; font-size: 12px;
        line-height: 1.4; resize: vertical; min-height: 34px;
      }
      .cp-text:focus { border-color: #16a394; }
      .pop-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
      .pop-head .src { margin-bottom: 0; min-width: 0; flex: 1; }
      .popover .comment { margin-bottom: 14px; }
      .actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 12px; }
      .act-right { display: flex; align-items: center; gap: 8px; margin-left: auto; }
      /* Text buttons (note box: Add comment) */
      .note .actions button {
        all: unset; box-sizing: border-box; cursor: pointer; padding: 7px 14px; border-radius: 9px;
        background: #2a2c30; color: #e7e9ee; font-size: 12px; font-weight: 500; white-space: nowrap;
        transition: background .12s;
      }
      .note .actions button:hover { background: #363940; }
      .note .actions button.primary { background: var(--pc-accent); color: var(--pc-ink); }
      .note .actions button.primary:hover { background: var(--pc-accent-hover); }
      /* Icon buttons with hover tooltip (popover + drawer rows) */
      .act {
        all: unset; box-sizing: border-box; cursor: pointer; position: relative;
        display: inline-flex; align-items: center; justify-content: center;
        width: 34px; height: 34px; border-radius: 9px; background: #2a2c30; color: #e7e9ee;
        transition: background .12s, color .12s;
      }
      .act:hover { background: #363940; }
      .act svg { width: 16px; height: 16px; }
      .act.primary { background: var(--pc-accent); color: var(--pc-ink); }
      .act.primary:hover { background: var(--pc-accent-hover); }
      .act.danger { background: transparent; color: #ff8d8d; }
      .act.danger:hover { background: rgba(255,90,90,.12); }
      .act::after {
        content: attr(data-tip); position: absolute; bottom: calc(100% + 8px); left: 50%;
        transform: translateX(-50%) translateY(2px);
        background: #0c0d0f; color: #fff; font-size: 11px; font-weight: 500; line-height: 1;
        padding: 5px 8px; border-radius: 6px; white-space: nowrap; opacity: 0; pointer-events: none;
        transition: opacity .12s, transform .12s; box-shadow: 0 4px 14px rgba(0,0,0,.45);
      }
      .act:hover::after { opacity: 1; transform: translateX(-50%) translateY(0); }
      .bubble {
        position: fixed; pointer-events: auto; cursor: pointer;
        width: 22px; height: 22px; border-radius: 50% 50% 50% 2px;
        background: var(--pc-accent); color: var(--pc-ink); font-size: 12px; font-weight: 600;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 2px 8px rgba(0,0,0,.35); transform: translateY(-100%); border: 1.5px solid #fff;
      }
      /* Agent + model picker — a custom combobox grouped by agent (the menu opens
         above the bar). Shown only when there's a choice; the only place an agent
         name appears, so the rest of the UI stays agent-agnostic. */
      .agent-pick { position: relative; display: none; flex: none; }
      .agent-pick.show { display: inline-block; }
      .agent-trigger {
        all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;
        font: inherit; font-size: 13px; color: #e7e9ee; background: #1f2125;
        border: 1px solid #2f343c; border-radius: 11px; height: 38px; padding: 0 10px;
        min-width: 140px; max-width: 190px; transition: border-color .12s, background .12s;
      }
      .agent-trigger:hover { background: #26282d; }
      .agent-trigger.open { border-color: #4a515c; background: #26282d; }
      .agent-icon { width: 15px; height: 15px; flex: none; opacity: .7; }
      .agent-trigger-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .agent-chev { width: 15px; height: 15px; flex: none; opacity: .6; transition: transform .15s; }
      .agent-trigger.open .agent-chev { transform: rotate(180deg); }
      .agent-menu {
        position: absolute; left: 0; bottom: calc(100% + 8px); display: none; flex-direction: column; gap: 1px;
        min-width: 100%; width: max-content; max-width: 280px; max-height: 320px; overflow-y: auto; z-index: 6;
        background: #1b1d21; border: 1px solid #2b313c; border-radius: 12px; padding: 6px;
        box-shadow: 0 16px 44px rgba(0,0,0,.55);
      }
      .agent-menu.open { display: flex; }
      .agent-group { display: flex; flex-direction: column; }
      /* Group header: agent name (capitalized) flanked by inline divider lines. */
      .agent-group-label {
        display: flex; align-items: center; gap: 8px;
        font-size: 12px; color: #8b93a1; text-transform: capitalize; user-select: none;
        margin: 2px 0; padding: 6px 3px;
      }
      .agent-group-label::before { content: ''; flex: none; width: 14px; height: 1px; background: rgba(255,255,255,.08); }
      .agent-group-label::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,.08); }
      .agent-opt {
        all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 8px;
        padding: 8px 9px; border-radius: 8px; color: #e7e9ee; font-size: 13px; white-space: nowrap;
      }
      .agent-opt:hover { background: #2a2c30; }
      .agent-opt-check { width: 14px; height: 14px; flex: none; opacity: 0; }
      .agent-opt.sel { color: var(--pc-accent); }
      .agent-opt.sel .agent-opt-check { opacity: 1; }
      /* Drawer-composer instance: shorter (matches the 32px send button), menu
         right-aligned to the trigger, and pushed beside the send button. */
      .composer-bar .agent-pick { margin-left: auto; }
      .composer-bar .dsend { margin-left: 0; } /* picker's auto already right-aligns the group */
      .agent-pick.sm .agent-trigger {
        height: 32px; border-radius: 9px; padding: 0 8px; gap: 6px; font-size: 12px;
        min-width: 0; max-width: 150px;
      }
      .agent-pick.sm .agent-icon, .agent-pick.sm .agent-chev { width: 14px; height: 14px; }
      .agent-pick.right .agent-menu { left: auto; right: 0; }
      /* Send: the primary "Go" — lemon active accent, set apart from neutral tools. */
      .icon-btn.send { background: var(--pc-accent); color: var(--pc-ink); }
      .icon-btn.send:hover { background: var(--pc-accent-hover); }
      .icon-btn.send[disabled] { background: rgba(255,255,255,.06); color: rgba(231,233,238,.45); opacity: 1; cursor: not-allowed; }
      /* Claude thinking indicator (drawer head) + streamed transcript. */
      .clogo { display: inline-flex; flex: none; color: var(--pc-accent); }
      .clogo svg { width: 17px; height: 17px; display: block; }
      @keyframes cpulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
      /* Progress line at the foot (CLI-style): animated logo + word while working,
         "Brewed for …" when done. Hidden until the first run. */
      .cstatus { display: none; align-items: center; gap: 7px; font-size: 12px; opacity: .65; }
      .cstatus.show { display: flex; }
      .cstat-logo { display: inline-flex; flex: none; color: var(--pc-accent); }
      .cstat-logo svg { width: 14px; height: 14px; display: block; }
      .cstatus:not(.running) .cstat-logo { display: none; }
      .cstatus.running .cstat-logo { animation: cpulse 1.1s ease-in-out infinite; }
      .cstatus.err .cstat-text { color: #ff8d8d; opacity: 1; }
      .cpanel > .cstatus { padding: 8px 14px; border-top: 1px solid rgba(255,255,255,.08); }
      .drawer-composer > .cstatus { padding: 0 2px 8px; }
      .evt { display: flex; gap: 8px; line-height: 1.5; word-break: break-word; font-size: 13px; }
      .evt .ic { flex: none; opacity: .55; font-family: ui-monospace, monospace; }
      .evt.tool .ic { color: var(--pc-accent); opacity: 1; }
      .evt.text { color: #cfd5df; white-space: pre-wrap; }
      .evt.you { color: #fff; }
      .evt.you .ic { color: var(--pc-accent); opacity: 1; }
      .evt.tool code { font-family: ui-monospace, monospace; color: #aeb6c2; }
      .evt.done { color: #8de6c7; font-weight: 500; }
      .evt.err { color: #ff8d8d; }
      .evt.ctx { color: #8a93a3; font-size: 11px; }
      /* Floating Claude feed — pops above the bar, mirrors the drawer transcript. */
      .cpanel {
        position: fixed; bottom: 74px; left: 50%; transform: translateX(-50%);
        pointer-events: auto; display: none; flex-direction: column; width: 440px; max-width: 92vw;
        background: #161719; color: #fff; border-radius: 14px; box-sizing: border-box;
        box-shadow: 0 16px 44px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.06); font-size: 13px;
      }
      .cpanel.open { display: flex; }
      .cpanel-head {
        display: flex; align-items: center; gap: 9px; padding: 13px 14px;
        border-bottom: 1px solid rgba(255,255,255,.08); flex: none;
      }
      .cpanel-head .ctitle { font-size: 14px; font-weight: 600; }
      .cpanel-head .cclose {
        all: unset; cursor: pointer; margin-left: auto; width: 28px; height: 28px; border-radius: 8px;
        display: inline-flex; align-items: center; justify-content: center; color: #cfd5df; flex: none;
      }
      .cpanel-head .cclose:hover { background: rgba(255,255,255,.08); color: #fff; }
      .cpanel-head .cclose svg { width: 16px; height: 16px; }
      .clog { height: 340px; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    </style>
    <div class="layer">
      <div class="outline"></div>
      <div class="tag"></div>
      <div class="marquee"></div>
      <div class="bubbles"></div>

      <div class="panel note">
        <div class="src">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          <span class="src-name"></span>
        </div>
        <textarea placeholder="Describe the change…  (⌘/Ctrl+Enter to save)"></textarea>
        <div class="spacing-ctl">
          <div class="sp-props">
            <button class="sp-prop" data-prop="padding">Padding</button>
            <button class="sp-prop" data-prop="margin">Margin</button>
            <button class="sp-prop" data-prop="gap">Gap</button>
          </div>
          <div class="sp-stepper">
            <button class="sp-step" data-act="sp-dec" title="Smaller">−</button>
            <span class="sp-readout"></span>
            <button class="sp-step" data-act="sp-inc" title="Larger">+</button>
          </div>
        </div>
        <div class="color-ctl">
          <div class="cl-props">
            <button class="cl-prop" data-cprop="background-color">Fill</button>
            <button class="cl-prop" data-cprop="color">Text</button>
            <button class="cl-prop" data-cprop="border-color">Border</button>
          </div>
          <div class="cl-panel" hidden>
            <span class="cl-role"></span>
            <div class="cl-ramp"></div>
          </div>
        </div>
        <div class="type-ctl">
          <div class="ty-props">
            <button class="ty-prop" data-tprop="font-size">Size</button>
            <button class="ty-prop" data-tprop="font-weight">Weight</button>
            <button class="ty-prop" data-tprop="line-height">Line height</button>
          </div>
          <div class="ty-stepper">
            <button class="ty-step" data-act="ty-dec" title="Smaller">−</button>
            <span class="ty-readout"></span>
            <button class="ty-step" data-act="ty-inc" title="Larger">+</button>
          </div>
        </div>
        <div class="copy-ctl">
          <div class="cp-label">Text</div>
          <textarea class="cp-text" rows="2" placeholder="Edit the copy…"></textarea>
        </div>
        <div class="actions">
          <label class="shot-toggle">
            <input type="checkbox" class="shot-check" checked />
            <span>Include screenshot?</span>
          </label>
          <button data-act="send-agent">Send to agent</button>
          <button data-act="save" class="primary">Add comment</button>
        </div>
      </div>

      <div class="panel popover">
        <div class="pop-head">
          <div class="src">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
            <span class="src-name"></span>
          </div>
        </div>
        <div class="comment">
          <div class="comment-title">Comment</div>
          <blockquote class="body"></blockquote>
        </div>
        <div class="shot-wrap collapsed">
          <button class="disclosure" data-act="toggle-shot">
            <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            <span>Screenshot</span>
          </button>
          <img class="shot" alt="" />
        </div>
        <div class="actions">
          <button class="act danger" data-act="delete" data-tip="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
          <div class="act-right">
            <button class="act" data-act="copy-img" data-tip="Copy image">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="m21 15-4.5-4.5L7 20"/></svg>
            </button>
            <button class="act" data-act="edit" data-tip="Edit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button class="act primary" data-act="send-agent" data-tip="Send to agent">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div class="scrim"></div>
      <aside class="drawer">
        <div class="drawer-head">
          <span class="clogo" title="Agent">${AGENT_ICON}</span>
          <span class="dtitle">Comments</span>
          <span class="dcount"></span>
          <button class="dmin" data-act="toggle-list" title="Minimize comments">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <button class="dclose" data-act="drawer-close" title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="drawer-tabs">
          <button class="dtab active" data-act="tab" data-tab="comments">Comments</button>
          <button class="dtab" data-act="tab" data-tab="chat">Chat</button>
        </div>
        <div class="drawer-list"></div>
        <div class="drawer-stream"></div>
        <div class="chat-pane">
          <div class="chat-stream"></div>
          <div class="chat-composer">
            <span class="cstatus"><span class="cstat-logo">${AGENT_ICON}</span><span class="cstat-text"></span></span>
            <div class="composer-box">
              <div class="chat-chips"></div>
              <textarea placeholder="Ask about this page…  (⌘/Ctrl+Enter to send · Pick to attach an element)"></textarea>
              <div class="composer-bar">
                <button class="apply-toggle" data-act="chat-apply" title="Apply changes this turn (otherwise propose only)" aria-pressed="false">
                  <span class="apply-switch"></span><span>Apply changes</span>
                </button>
                <div class="agent-pick sm right">
                  <button class="agent-trigger" data-act="agent-toggle" title="Coding agent" aria-label="Coding agent">
                    <svg class="agent-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>
                    <span class="agent-trigger-label"></span>
                    <svg class="agent-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </button>
                  <div class="agent-menu"></div>
                </div>
                <button class="dsend" data-act="chat-send" title="Send to agent">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="drawer-composer">
          <div class="mention-pop"></div>
          <span class="cstatus"><span class="cstat-logo">${AGENT_ICON}</span><span class="cstat-text"></span></span>
          <div class="composer-box">
            <div class="composer-chips"></div>
            <textarea placeholder="Message agent…  (@ to reference a comment · ⌘/Ctrl+Enter to send)"></textarea>
            <div class="composer-bar">
              <span class="sel-info"></span>
              <div class="agent-pick sm right">
                <button class="agent-trigger" data-act="agent-toggle" title="Coding agent" aria-label="Coding agent">
                  <svg class="agent-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>
                  <span class="agent-trigger-label"></span>
                  <svg class="agent-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </button>
                <div class="agent-menu"></div>
              </div>
              <button class="dsend" data-act="composer-send" title="Send to agent">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div class="cpanel">
        <div class="cpanel-head">
          <span class="clogo" title="Agent">${AGENT_ICON}</span>
          <span class="ctitle">Agent</span>
          <button class="cclose" data-act="agent-close" title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="clog"></div>
        <span class="cstatus"><span class="cstat-logo">${AGENT_ICON}</span><span class="cstat-text"></span></span>
      </div>

      <div class="bar">
        <span class="grip" title="Drag to move">
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="9" cy="19" r="1.6"/><circle cx="15" cy="5" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="15" cy="19" r="1.6"/></svg>
        </span>
        <span class="brand" title="Pointcut">${SPARK_ICON}<span class="brand-name">Pointcut</span></span>
        <span class="divider"></span>
        <button class="tool" data-act="pick" title="Pick element / region">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><circle cx="12" cy="12" r="2.5"/></svg>
          <span class="lbl">Pick</span><span class="kbd">${KBD('S')}</span>
        </button>
        <button class="icon-btn" data-act="comments" data-tip="Show comments  ${KBD('C')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg>
          <span class="cbadge">0</span>
        </button>
        <button class="icon-btn danger" data-act="clear" data-tip="Delete all comments">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>
        <div class="agent-pick">
          <button class="agent-trigger" data-act="agent-toggle" title="Coding agent" aria-label="Coding agent">
            <svg class="agent-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>
            <span class="agent-trigger-label"></span>
            <svg class="agent-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <div class="agent-menu"></div>
        </div>
        <button class="icon-btn send" data-act="send" data-tip="Send to agent  ${KBD('G')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>
        </button>
        <span class="divider"></span>
        <button class="icon-btn" data-act="collapse" data-tip="Collapse">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6m0 0v6m0-6-7 7"/><path d="M20 10h-6m0 0V4m0 6 7-7"/></svg>
        </button>
        <span class="puck" title="Expand toolbar">${SPARK_ICON}</span>
      </div>
    </div>
  `;

  const $ = (sel) => shadow.querySelector(sel);
  const outline = $('.outline');
  const tagLabel = $('.tag');
  const marquee = $('.marquee');
  const bubblesWrap = $('.bubbles');
  const bar = $('.bar');
  const grip = $('.bar .grip');
  const puck = $('.bar .puck');
  const pickBtn = $('.bar [data-act="pick"]');
  const sendBtn = $('.bar [data-act="send"]');
  const countBadge = $('.cbadge');
  const clearBtn = $('.bar [data-act="clear"]');
  const scrim = $('.scrim');
  const drawer = $('.drawer');
  const drawerList = $('.drawer-list');
  const drawerCount = $('.drawer-head .dcount');
  const stream = $('.drawer-stream');
  const drawerHead = $('.drawer-head');
  const drawerTabs = $('.drawer-tabs');
  const cpanel = $('.cpanel');
  const cpanelLog = $('.cpanel .clog');
  // Each surface is independent: a run streams into the drawer OR the floating
  // panel, never both. `surface` ({ log, status }) is set per run to the chosen
  // one, so cLog/setStatus write only there.
  const drawerStatus = $('.drawer-composer .cstatus');
  const panelStatus = $('.cpanel .cstatus');
  // Chat tab (0010): its own transcript surface + composer.
  const chatStream = $('.chat-stream');
  const chatText = $('.chat-composer textarea');
  const chatSend = $('.chat-composer [data-act="chat-send"]');
  const chatStatus = $('.chat-composer .cstatus');
  const chatApplyBtn = $('.chat-composer [data-act="chat-apply"]');
  const chatChips = $('.chat-composer .chat-chips');
  let surface = null;
  // The selected coding Agent + model (picker value) and the list the bridge says
  // are installed (each { name, models:[{label,value}] }). selectedAgent gates
  // Send; the picker is the only place an agent name shows.
  let selectedAgent = null;
  let selectedModel = '';
  let availableAgents = [];
  const composerText = $('.drawer-composer textarea');
  const composerSend = $('.drawer-composer [data-act="composer-send"]');
  const composerChips = $('.composer-chips');
  const mentionPop = $('.mention-pop');
  const selInfo = $('.drawer-composer .sel-info');

  const note = $('.note');
  const noteSrc = note.querySelector('.src');
  const shotField = note.querySelector('.shot-toggle');
  const shotCheck = note.querySelector('.shot-check');
  const noteText = note.querySelector('textarea');
  const spacingCtl = note.querySelector('.spacing-ctl');
  const spacingStepper = note.querySelector('.sp-stepper');
  const spacingReadout = note.querySelector('.sp-readout');
  const colorCtl = note.querySelector('.color-ctl');
  const colorPanel = note.querySelector('.cl-panel');
  const colorRole = note.querySelector('.cl-role');
  const colorRampEl = note.querySelector('.cl-ramp');
  const typeCtl = note.querySelector('.type-ctl');
  const typeStepper = note.querySelector('.ty-stepper');
  const typeReadout = note.querySelector('.ty-readout');
  const copyCtl = note.querySelector('.copy-ctl');
  const copyText = note.querySelector('.cp-text');

  const popover = $('.popover');
  const popSrc = popover.querySelector('.src');
  const popShotWrap = popover.querySelector('.shot-wrap');
  const popShot = popover.querySelector('.shot');
  const popBody = popover.querySelector('.body');
  const popCopyImg = popover.querySelector('[data-act="copy-img"]');

  let picking = false;
  let agentRunning = false;
  let agentErrored = false;
  let listCollapsed = false; // drawer "minimize" — hides the comment cards
  // Active drawer tab ('comments' | 'chat'); Chat is a stub this issue (0008).
  let activeTab = 'comments';
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (t === 'comments' || t === 'chat') activeTab = t;
  } catch (_) {}
  let agentSessionId = null; // captured from stream-json init; enables conversation resume
  let agentStartAt = 0; // run start timestamp, for the "Brewed for …" elapsed time
  let openTextMsg = null; // the .msg node currently accumulating streamed prose deltas
  let openTextBuf = ''; // its accumulated text so far
  let selectedIds = []; // comments @-referenced in the composer, in insertion order (default = none)
  const expandedIds = new Set(); // comment cards expanded in the drawer (default = collapsed)
  let sentIds = []; // ids dispatched in the current run — removed on success
  let pending = null; // what we're about to annotate: {el} | {region} | {editId}
  // Active spacing-control session for the open note: the model session, the
  // property, and the element's original inline value so a cancel restores it.
  // null when no property is selected (no spacing edit will be attached).
  let spacing = null;
  // Active color-control session for the open note: model session, the CSS
  // facet, the element, its original inline value (so cancel restores it), and
  // the clean pre-preview provenance (so the role/source isn't read off our own
  // inline preview). null when no facet is selected. (0005)
  let color = null;
  // Active typography-control session for the open note: the model session, the
  // CSS facet, the element, and its original inline value so a cancel restores
  // it. null when no facet is selected (no typography edit will be attached). (0006)
  let type = null;
  // Active copy / text-edit session for the open note: the model session, the
  // element, and its original text so a cancel restores it. null when the pick
  // isn't a text leaf, or after a reset. (0007)
  let copy = null;
  let selectedType = TYPES[0].id;
  let openPopId = null;
  let popSide = null; // latched vertical side of the open popover (see placeBeside)
  let drawerOpen = false;

  // Compact source label: filename:line:col, with the full path on hover. The
  // raw stamp (long relative path) wrapped over several lines — this keeps it
  // to one readable line and stays clickable for jump-to-source.
  const fillSrc = (srcEl, loc) => {
    const nameEl = srcEl.querySelector('.src-name');
    const linkable = !!loc && loc.includes(':');
    if (loc) {
      const [file, ...lc] = loc.split(':');
      const name = file.split('/').pop();
      nameEl.textContent = lc.length ? `${name}:${lc.join(':')}` : name;
    } else {
      nameEl.textContent = '(source unknown)';
    }
    srcEl.title = loc || 'source unknown';
    srcEl.classList.toggle('linkable', linkable);
    srcEl.dataset.loc = loc || '';
  };

  const refreshCount = () => {
    const n = Q.count();
    countBadge.textContent = String(n);
    countBadge.classList.toggle('show', n > 0);
    clearBtn.disabled = n === 0;
    sendBtn.disabled = n === 0 || agentRunning || !selectedAgent;
    if (drawerOpen) renderDrawer();
  };

  // ---- Geometry helpers ----------------------------------------------------
  const isOwn = (node) => {
    let n = node;
    while (n) {
      if (n === host) return true;
      n = n.parentNode || (n.host || null);
    }
    return false;
  };

  const labelFor = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (typeof el.className === 'string' && el.className.trim()) {
      s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    }
    return s;
  };

  const keyStylesOf = (el) => {
    const cs = getComputedStyle(el);
    const out = {};
    KEY_STYLES.forEach((p) => {
      const v = cs.getPropertyValue(p);
      if (v) out[p] = v.trim();
    });
    return out;
  };

  // ---- Comment bubbles -----------------------------------------------------
  let rafId = null;
  const positionBubbles = () => {
    bubblesWrap.querySelectorAll('.bubble').forEach((b) => {
      const a = Q.get(b.dataset.id);
      const r = a && locator.rectFor(a);
      if (!r) {
        b.style.display = 'none';
        return;
      }
      b.style.display = 'flex';
      b.style.left = Math.min(r.right, window.innerWidth - 24) + 'px';
      b.style.top = Math.max(r.top, 24) + 'px';
    });
    if (openPopId != null) positionPopover();
    rafId = Q.count() ? requestAnimationFrame(positionBubbles) : null;
  };

  const renderBubbles = () => {
    bubblesWrap.innerHTML = '';
    Q.all().forEach((a, i) => {
      const b = document.createElement('div');
      b.className = 'bubble';
      b.dataset.id = a.id;
      b.textContent = String(i + 1);
      b.title = a.comment;
      bubblesWrap.appendChild(b);
    });
    if (Q.count() && rafId == null) rafId = requestAnimationFrame(positionBubbles);
    else if (!Q.count() && rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  // ---- Floating placement --------------------------------------------------
  // Place a floating card next to an anchor rect without covering it: prefer
  // below the anchor, fall back above, and if neither side fits pin to a stable
  // viewport edge. Horizontally it picks the preferred side and flips when that
  // side is too tight, then clamps. `align: 'right'` extends the card leftward
  // from the anchor (right edge at the anchor) — the default for the popover,
  // whose bubble anchor sits at the element's top-right. Otherwise it extends
  // rightward from the anchor's left. Measures the card's real size, so callers
  // must make it visible first.
  const GAP = 8;
  const BOTTOM_RESERVE = 72; // main toolbar (bottom:20px) + breathing room
  // `lockSide` ('below'|'above'|'pinned') skips the vertical-side decision and
  // reuses a side chosen earlier. Callers that reposition every frame (the
  // popover, whose content animates open) latch the side once so a changing
  // height extends in one direction instead of re-flipping and jumping. Returns
  // the side actually used so the caller can latch it.
  const placeBeside = (panel, r, align, lockSide) => {
    const w = panel.offsetWidth || 296;
    const h = panel.offsetHeight || 160;

    const belowTop = r.bottom + GAP;
    const aboveTop = r.top - h - GAP;
    let side = lockSide;
    if (!side) {
      if (belowTop + h <= window.innerHeight - BOTTOM_RESERVE) side = 'below';
      else if (aboveTop >= GAP) side = 'above';
      else side = 'pinned';
    }
    const top =
      side === 'below' ? belowTop : side === 'above' ? aboveTop : window.innerHeight - h - BOTTOM_RESERVE;

    // Preferred horizontal side; flip if it overflows the opposite edge.
    let left = align === 'right' ? r.right - w : r.left;
    if (align === 'right') {
      if (left < GAP) left = r.left; // too tight on the left → extend rightward
    } else if (left + w > window.innerWidth - GAP) {
      left = r.right - w; // too tight on the right → extend leftward
    }
    // Final clamp so the card never spills past either viewport edge.
    if (left + w > window.innerWidth - GAP) left = window.innerWidth - w - GAP;
    if (left < GAP) left = GAP;

    panel.style.top = Math.max(top, GAP) + 'px';
    panel.style.left = left + 'px';
    return side;
  };

  // ---- Note box ------------------------------------------------------------
  const positionPanel = (panel, r) => {
    panel.style.display = 'block';
    placeBeside(panel, r);
  };

  // ---- Spacing control (0004) ----------------------------------------------
  // Show the labelled token + px (and an off-scale badge) for the current step.
  const renderSpacing = (c) => {
    spacingReadout.innerHTML =
      `<span class="sp-token">${c.token}</span> ${c.value}` +
      (c.offScale ? '<span class="sp-off">≈ off-scale</span>' : '');
  };

  // Paint the throwaway inline preview (precedence beats scoped CSS, D7).
  const previewSpacing = (c) => {
    if (spacing && spacing.el) spacing.el.style.setProperty(spacing.property, c.value);
  };

  // Undo the preview, returning the element's inline style to what it was.
  const restoreSpacing = () => {
    if (!spacing || !spacing.el) return;
    if (spacing.origInline) spacing.el.style.setProperty(spacing.property, spacing.origInline);
    else spacing.el.style.removeProperty(spacing.property);
  };

  // Clear any active session and reset the control's UI to "no property chosen".
  const resetSpacing = () => {
    spacing = null;
    spacingStepper.hidden = true;
    spacingReadout.innerHTML = '';
    spacingCtl.querySelectorAll('.sp-prop').forEach((b) => b.classList.remove('active'));
  };

  // Begin (or switch to) a stepping session for one property on the picked
  // element. Restores any prior property's preview first, seeds at the nearest
  // token to the element's current value, and shows the stepper.
  const selectSpacingProp = (property) => {
    if (!pending || !pending.el) return;
    // Re-clicking the active property clears it (no edit will be attached).
    if (spacing && spacing.property === property) {
      restoreSpacing();
      resetSpacing();
      return;
    }
    restoreSpacing();
    const el = pending.el;
    const px = parseFloat(getComputedStyle(el)[SPACING_SIDE[property]]) || 0;
    const session = spacingModel.begin(property, px);
    if (!session) return; // no spacing tokens on :root
    spacing = { session, property, el, origInline: el.style.getPropertyValue(property) };
    spacingCtl.querySelectorAll('.sp-prop').forEach((b) =>
      b.classList.toggle('active', b.dataset.prop === property),
    );
    spacingStepper.hidden = false;
    renderSpacing(session.current());
  };

  const stepSpacing = (dir) => {
    if (!spacing) return;
    const c = spacing.session.step(dir);
    renderSpacing(c);
    previewSpacing(c);
  };

  // ---- Color control (0005) ------------------------------------------------
  // Show the semantic role that currently applies, or flag its absence (D4/D8).
  const renderColorRole = (session) => {
    if (session.role) {
      colorRole.className = 'cl-role';
      colorRole.innerHTML = `Role: <span class="cl-rname">${session.role}</span>`;
    } else {
      colorRole.className = 'cl-role none';
      colorRole.textContent = '⚠ no semantic role — may need one';
    }
  };

  // Paint the L1 primitive ramp as clickable swatches.
  const renderColorRamp = (session) => {
    colorRampEl.innerHTML = '';
    session.swatches.forEach((s) => {
      const b = document.createElement('button');
      b.className = 'cl-swatch';
      b.dataset.token = s.name;
      b.style.background = s.value;
      b.title = `${s.name} ${s.value}`;
      colorRampEl.appendChild(b);
    });
  };

  // Undo the throwaway preview, restoring the element's inline style.
  const restoreColor = () => {
    if (!color || !color.el) return;
    if (color.origInline) color.el.style.setProperty(color.property, color.origInline);
    else color.el.style.removeProperty(color.property);
  };

  // Clear any active session and reset the control's UI to "no facet chosen".
  const resetColor = () => {
    color = null;
    colorPanel.hidden = true;
    colorRole.textContent = '';
    colorRampEl.innerHTML = '';
    colorCtl.querySelectorAll('.cl-prop').forEach((b) => b.classList.remove('active'));
  };

  // Begin (or switch to) a color session for one facet on the picked element.
  // Reads the genuine declared color and its semantic role *before* any preview,
  // so the role isn't read off our own inline override (0002 checks inline
  // first). The clean provenance is stashed for the commit.
  const selectColorProp = (property) => {
    if (!pending || !pending.el) return;
    // Re-clicking the active facet clears it (no edit will be attached).
    if (color && color.property === property) {
      restoreColor();
      resetColor();
      return;
    }
    restoreColor();
    const el = pending.el;
    const prov = provenance.inspect(el, property);
    const before = prov.value || getComputedStyle(el).getPropertyValue(property).trim();
    const session = colorModel.begin(property, before, colorModel.roleOf(prov.value));
    if (!session) return; // no primitive ramp on :root
    color = { session, property, el, origInline: el.style.getPropertyValue(property), prov };
    colorCtl.querySelectorAll('.cl-prop').forEach((b) =>
      b.classList.toggle('active', b.dataset.cprop === property),
    );
    renderColorRole(session);
    renderColorRamp(session);
    colorPanel.hidden = false;
  };

  const pickColor = (token) => {
    if (!color) return;
    const c = color.session.pick(token);
    if (!c) return;
    color.el.style.setProperty(color.property, c.value); // throwaway preview
    colorRampEl.querySelectorAll('.cl-swatch').forEach((b) =>
      b.classList.toggle('active', b.dataset.token === token),
    );
  };

  // ---- Typography control (0006) -------------------------------------------
  // Show the labelled token + value (and an off-scale badge) for the current step.
  const renderType = (c) => {
    typeReadout.innerHTML =
      `<span class="ty-token">${c.token}</span> ${c.value}` +
      (c.offScale ? '<span class="ty-off">≈ off-scale</span>' : '');
  };

  // Paint the throwaway inline preview (precedence beats scoped CSS, D7).
  const previewType = (c) => {
    if (type && type.el) type.el.style.setProperty(type.property, c.value);
  };

  // Undo the preview, returning the element's inline style to what it was.
  const restoreType = () => {
    if (!type || !type.el) return;
    if (type.origInline) type.el.style.setProperty(type.property, type.origInline);
    else type.el.style.removeProperty(type.property);
  };

  // Clear any active session and reset the control's UI to "no facet chosen".
  const resetType = () => {
    type = null;
    typeStepper.hidden = true;
    typeReadout.innerHTML = '';
    typeCtl.querySelectorAll('.ty-prop').forEach((b) => b.classList.remove('active'));
  };

  // Begin (or switch to) a stepping session for one typography facet on the
  // picked element. Restores any prior facet's preview first, seeds at the
  // nearest token to the element's current value, and shows the stepper.
  const selectTypeProp = (property) => {
    if (!pending || !pending.el) return;
    // Re-clicking the active facet clears it (no edit will be attached).
    if (type && type.property === property) {
      restoreType();
      resetType();
      return;
    }
    restoreType();
    const el = pending.el;
    const session = typographyModel.begin(property, readType(el, property));
    if (!session) return; // no tokens of that kind on :root
    type = { session, property, el, origInline: el.style.getPropertyValue(property) };
    typeCtl.querySelectorAll('.ty-prop').forEach((b) =>
      b.classList.toggle('active', b.dataset.tprop === property),
    );
    typeStepper.hidden = false;
    renderType(session.current());
  };

  const stepType = (dir) => {
    if (!type) return;
    const c = type.session.step(dir);
    renderType(c);
    previewType(c);
  };

  // ---- Copy / text control (0007) ------------------------------------------
  // Only offered on a text-leaf element — one with text and no element
  // children — so editing can't mangle nested structure and restore is a clean
  // textContent reset. Wrappers with inline children (e.g. <p>a <b>b</b></p>)
  // are out of scope for the tracer.
  const isTextLeaf = (el) =>
    !!el && el.children.length === 0 && el.textContent.trim().length > 0;

  // Open an edit session for the picked element, seeding the field with its
  // current text. Editing the field live-previews onto the element (D7).
  const armCopy = (el) => {
    copy = { session: copyModel.begin(el.textContent), el, before: el.textContent };
    copyText.value = copy.before;
  };

  // Paint the throwaway preview: the field's text replaces the element's.
  const previewCopy = () => {
    if (copy && copy.el) copy.el.textContent = copyText.value;
  };

  // Undo the preview, restoring the element's original text.
  const restoreCopy = () => {
    if (copy && copy.el) copy.el.textContent = copy.before;
  };

  // Clear the session and the field.
  const resetCopy = () => {
    copy = null;
    copyText.value = '';
  };

  const openNote = (pendingState, anchorRect, prefill) => {
    pending = pendingState;
    selectedType = (prefill && prefill.type) || TYPES[0].id;
    noteText.value = (prefill && prefill.comment) || '';
    fillSrc(noteSrc, prefill ? prefill.loc : (pendingState.el ? pendingState.el.getAttribute(LOC_ATTR) : ''));
    // Screenshot toggle only applies to element annotations (regions aren't a
    // single DOM node, so there's nothing to capture). Default on for new ones;
    // for edits, reflect whether a screenshot already exists.
    const isRegion = pendingState.region ? true : prefill ? !!prefill.region : false;
    shotField.style.display = isRegion ? 'none' : '';
    shotCheck.checked = prefill ? !!prefill.screenshot : true;
    // Spacing control only applies to a fresh element pick (a live node to read
    // and preview against) — not regions or edits of an existing comment.
    resetSpacing();
    resetColor();
    resetType();
    resetCopy();
    spacingCtl.classList.toggle('show', !!pendingState.el);
    colorCtl.classList.toggle('show', !!pendingState.el);
    typeCtl.classList.toggle('show', !!pendingState.el);
    // Copy editing only makes sense on a text leaf; arm it when one is picked.
    const textLeaf = !!pendingState.el && isTextLeaf(pendingState.el);
    copyCtl.classList.toggle('show', textLeaf);
    if (textLeaf) armCopy(pendingState.el);
    positionPanel(note, anchorRect);
    noteText.focus();
  };

  const closeNote = () => {
    restoreSpacing(); // drop the throwaway preview
    restoreColor();
    restoreType();
    restoreCopy();
    resetSpacing();
    resetColor();
    resetType();
    resetCopy();
    note.style.display = 'none';
    pending = null;
  };

  const captureShot = (el, id) => {
    return toPng(el, { cacheBust: true, pixelRatio: 1 })
      .then((png) => {
        const a = Q.get(id);
        if (a) {
          a.screenshot = png;
          Q.persist();
          if (openPopId === id) {
            popShot.src = png;
            popShotWrap.style.display = '';
            popShotWrap.classList.remove('collapsed');
            popCopyImg.style.display = '';
          }
          if (drawerOpen) renderDrawer();
        }
      })
      .catch(() => {}); // CORS images / detached nodes — skip silently
  };

  // Commit the note (from the current `pending` state + fields) to the queue.
  // Returns { id, shotPromise } — shotPromise resolves once the screenshot is
  // captured (null when none) — or null if the comment is blank. Shared by the
  // "Add comment" (Save) and "Send to Claude" buttons.
  const commitNote = () => {
    const comment = noteText.value.trim();
    if (!comment) {
      noteText.focus();
      return null;
    }
    let shotPromise = null;
    if (pending && pending.editId) {
      const a = Q.get(pending.editId);
      if (a) {
        a.comment = comment;
        a.type = selectedType;
        if (!a.region) {
          if (shotCheck.checked && !a.screenshot) {
            const el = locator.resolve(a);
            if (el) shotPromise = captureShot(el, a.id);
          } else if (!shotCheck.checked && a.screenshot) {
            a.screenshot = null;
          }
        }
      }
      Q.persist();
      renderBubbles();
      if (drawerOpen) renderDrawer();
      return { id: pending.editId, shotPromise };
    }
    const id = Q.newId();
    const a = {
      id, type: selectedType, comment,
      loc: '', path: null, label: '', outerHTML: '', styles: {}, screenshot: null, region: null,
    };
    if (pending && pending.el) {
      const el = pending.el;
      // Capture the structured visual intents (0003) and drop the throwaway
      // previews *before* reading provenance / outerHTML — otherwise the inline
      // preview would masquerade as the style's source (0002 checks inline
      // first) and pollute the captured snapshot. Color stashed its clean
      // pre-preview provenance at select time, so it reuses that (0005).
      const edits = [];
      if (spacing) {
        restoreSpacing();
        edits.push(spacing.session.toEdit(provenance.inspect(el, spacing.property)));
      }
      if (color) {
        restoreColor();
        const colorEdit = color.session.toEdit(color.prov);
        if (colorEdit) edits.push(colorEdit);
      }
      if (type) {
        restoreType();
        edits.push(type.session.toEdit(provenance.inspect(el, type.property)));
      }
      if (copy) {
        // Read the edited text before restoring the preview; attach only if the
        // wording actually changed (toEdit returns null otherwise).
        const copyEdit = copy.session.toEdit(copy.el.textContent);
        restoreCopy();
        if (copyEdit) edits.push(copyEdit);
      }
      if (edits.length) a.edits = edits;
      locator.remember(id, el);
      a.loc = el.getAttribute(LOC_ATTR) || '';
      a.path = locator.indexPath(el);
      a.label = labelFor(el);
      a.outerHTML = el.outerHTML.slice(0, 2000);
      a.styles = keyStylesOf(el);
      if (shotCheck.checked) shotPromise = captureShot(el, id);
    } else if (pending && pending.region) {
      a.region = pending.region;
      a.label = `region ${Math.round(pending.region.w)}×${Math.round(pending.region.h)}`;
    }
    Q.add(a);
    refreshCount();
    renderBubbles();
    return { id, shotPromise };
  };

  const saveNote = () => {
    if (commitNote()) closeNote(); // stays in Pick mode for the next element
  };

  // Send the just-written comment straight to Claude instead of leaving it in
  // the queue: commit it, wait for its screenshot, then run on that one comment.
  // On success the run's removeSent() drops it from the queue.
  const sendNote = () => {
    const res = commitNote();
    if (!res) return;
    closeNote();
    const run = () => runAgent({ annotations: [Q.get(res.id)].filter(Boolean), note: '', surface: 'panel' });
    if (res.shotPromise) res.shotPromise.then(run);
    else run();
  };

  // ---- Popover (view / edit / copy / delete) -------------------------------
  const positionPopover = () => {
    const a = Q.get(openPopId);
    const r = a && locator.rectFor(a);
    if (!r) {
      closePopover();
      return;
    }
    // Anchor to the numbered bubble (top-right of the element), not the element
    // rect: a large element's left/bottom can sit far from where the bubble —
    // and the user's click — actually is.
    const bubble = bubblesWrap.querySelector('.bubble[data-id="' + openPopId + '"]');
    // Latch the vertical side on first placement so expanding the screenshot
    // (which animates the height) extends in one direction instead of jumping.
    popSide = placeBeside(popover, bubble ? bubble.getBoundingClientRect() : r, 'right', popSide);
  };

  const openPopover = (id) => {
    const a = Q.get(id);
    if (!a) return;
    openPopId = id;
    popSide = null; // recompute the side fresh for this open
    fillSrc(popSrc, a.loc);
    if (a.screenshot) {
      popShot.src = a.screenshot;
      popShotWrap.style.display = '';
      popShotWrap.classList.add('collapsed'); // collapsed by default each open
      popCopyImg.style.display = '';
    } else {
      popShot.removeAttribute('src');
      popShotWrap.style.display = 'none';
      popCopyImg.style.display = 'none';
    }
    popBody.textContent = a.comment;
    popover.style.display = 'block';
    positionPopover();
  };

  const closePopover = () => {
    openPopId = null;
    popover.style.display = 'none';
  };

  const editAnnotation = (id) => {
    const a = Q.get(id);
    if (!a) return;
    const r = locator.rectFor(a) || { bottom: 80, left: 80 };
    closePopover();
    openNote({ editId: id }, r, a);
  };

  const deleteAnnotation = (id) => {
    Q.remove(id);
    locator.forget(id);
    refreshCount();
    renderBubbles();
    closePopover();
  };

  // ---- Handoff: markdown ---------------------------------------------------
  // The block/header builders live in handoff.mjs (pure). Display numbers stay
  // aligned with the on-screen bubbles via the queue index, so a checked subset
  // sent to Claude reads the same numbers as "Copy all" over the whole queue.
  const numberOf = (a) => Q.indexOf(a) + 1;
  const toMarkdown = (embedImages) => buildHandoff(Q.all(), numberOf, embedImages, TYPES);
  const toMarkdownFor = (annos) => buildHandoff(annos, numberOf, false, TYPES);

  const CHECK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  const flash = (btn, label) => {
    const prev = btn.innerHTML; // these buttons hold icons / label spans, so restore by markup
    // Icon-only buttons get a checkmark (no width jump); text buttons show the label.
    if (btn.classList.contains('act')) btn.innerHTML = CHECK_SVG;
    else btn.textContent = label;
    setTimeout(() => {
      btn.innerHTML = prev;
    }, 1200);
  };

  // ---- Send to agent -------------------------------------------------------
  // POST the markdown handoff (+ screenshots) to the dev-server Bridge, which
  // runs the selected agent's CLI, normalizes its events into Actions, and streams
  // them back as a uniform NDJSON protocol. The agent edits the source; HMR swaps
  // it in. The client stays agent-agnostic — it only consumes Actions.
  const escHtml = (s) =>
    String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const relPath = (p) => String(p).split('/').slice(-2).join('/');
  const TOOL_ICONS = { Edit: '✎', MultiEdit: '✎', Write: '✎', Read: '→', Bash: '$', Grep: '⌕', Glob: '⌕' };

  const cLog = (cls, ic, html) => {
    const box = (surface && surface.log) || stream;
    const row = document.createElement('div');
    row.className = 'evt ' + cls;
    row.innerHTML = (ic ? `<span class="ic">${ic}</span>` : '') + `<span class="msg">${html}</span>`;
    box.appendChild(row);
    box.scrollTop = box.scrollHeight; // auto-scroll to the newest line
  };

  // Stream assistant prose into ONE line: delta:true chunks accumulate, a complete
  // block finalizes (authoritative full text) and closes the line. A line with no
  // preceding deltas is just a one-shot row. Any non-text Action closes the line.
  const closeTextRow = () => { openTextMsg = null; openTextBuf = ''; };
  const streamText = (text, isDelta) => {
    const box = (surface && surface.log) || stream;
    if (!openTextMsg) {
      const row = document.createElement('div');
      row.className = 'evt text';
      row.innerHTML = `<span class="msg"></span>`;
      box.appendChild(row);
      openTextMsg = row.querySelector('.msg');
      openTextBuf = '';
    }
    if (isDelta) {
      openTextBuf += text;
      openTextMsg.innerHTML = escHtml(openTextBuf);
    } else {
      openTextMsg.innerHTML = escHtml(text); // authoritative full text
      closeTextRow();
    }
    box.scrollTop = box.scrollHeight;
  };
  const selectedAnnotations = () => selectedIds.map((id) => Q.get(id)).filter(Boolean);
  // What the composer Send dispatches: the checked queue subset (0008, default
  // all) unioned with any @-mentioned comments, deduped and in queue order.
  const composerDispatch = () => {
    const ids = new Set(selectedIds);
    Q.selectedItems().forEach((a) => ids.add(a.id));
    return Q.all().filter((a) => ids.has(a.id));
  };
  // One chip per @-referenced comment, shown inside the composer box.
  const renderChips = () => {
    composerChips.innerHTML = '';
    selectedAnnotations().forEach((a) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.dataset.id = a.id;
      chip.title = `${a.loc || 'source unknown'} — ${a.comment}`;
      chip.innerHTML =
        `<span class="chip-num">${Q.indexOf(a) + 1}</span>` +
        `<span class="chip-lbl">${escHtml(a.comment || '(no comment)')}</span>` +
        `<button class="chip-x" data-act="chip-remove" title="Remove">×</button>`;
      composerChips.appendChild(chip);
    });
  };
  const updateComposerState = () => {
    selectedIds = selectedIds.filter((id) => Q.get(id)); // drop references to deleted comments
    const n = composerDispatch().length;
    const hasNote = composerText.value.trim().length > 0;
    composerSend.disabled = agentRunning || !selectedAgent || (n === 0 && !hasNote);
    selInfo.textContent = n ? `${n} selected` : '';
    renderChips();
  };

  // ---- "@" comment picker --------------------------------------------------
  // Typing "@" (at start or after whitespace) opens a dropdown of un-referenced
  // comments; picking one strips the "@query" and adds the comment as a chip.
  let mentionList = [];
  let mentionActive = 0;
  const mentionIsOpen = () => mentionPop.classList.contains('open');
  const mentionCtx = () => {
    const caret = composerText.selectionStart;
    const m = /(?:^|\s)@([^\s@]*)$/.exec(composerText.value.slice(0, caret));
    return m ? { at: caret - m[1].length - 1, caret, query: m[1].toLowerCase() } : null;
  };
  const renderMention = () => {
    if (!mentionList.length) {
      mentionPop.innerHTML = '<div class="mention-empty">No comments to reference</div>';
      return;
    }
    mentionPop.innerHTML = mentionList
      .map((a, i) => {
        const src = a.loc ? a.loc.split('/').pop() : '';
        return (
          `<button class="mitem${i === mentionActive ? ' active' : ''}" data-id="${a.id}">` +
          `<span class="mitem-num">${Q.indexOf(a) + 1}</span>` +
          `<span class="mitem-text">${escHtml(a.comment || '(no comment)')}</span>` +
          (src ? `<span class="mitem-src">${escHtml(src)}</span>` : '') +
          `</button>`
        );
      })
      .join('');
  };
  const openMention = (query) => {
    const taken = new Set(selectedIds);
    mentionList = Q.all().filter(
      (a) =>
        !taken.has(a.id) &&
        (!query ||
          (a.comment || '').toLowerCase().includes(query) ||
          (a.loc || '').toLowerCase().includes(query)),
    );
    mentionActive = 0;
    renderMention();
    mentionPop.classList.add('open');
  };
  const closeMention = () => {
    mentionPop.classList.remove('open');
    mentionList = [];
  };
  const pickMention = (a) => {
    const ctx = mentionCtx();
    if (ctx) {
      const v = composerText.value;
      composerText.value = v.slice(0, ctx.at) + v.slice(ctx.caret);
      composerText.selectionStart = composerText.selectionEnd = ctx.at;
    }
    if (!selectedIds.includes(a.id)) selectedIds.push(a.id);
    closeMention();
    updateComposerState();
    composerText.focus();
  };
  // Drop the comments dispatched in the just-finished run (success only).
  const removeSent = () => {
    if (!sentIds.length) return;
    const ids = new Set(sentIds);
    Q.removeMany(ids);
    ids.forEach((id) => locator.forget(id));
    selectedIds = selectedIds.filter((id) => !ids.has(id));
    sentIds = [];
    refreshCount();
    renderBubbles();
    closePopover();
  };
  // CLI-style whimsical progress words, cycled while Claude works.
  const AGENT_WORDS = [
    'Razzmatazzing', 'Caramelizing', 'Effervescing', 'Percolating', 'Frolicking',
    'Noodling', 'Bamboozling', 'Galumphing', 'Cogitating', 'Marinating', 'Conjuring',
    'Finagling', 'Whittling', 'Discombobulating', 'Flummoxing', 'Schlepping',
    'Shimmying', 'Kerfuffling', 'Transmogrifying', 'Wrangling',
  ];
  let wordTimer = null;
  const nextWord = () => AGENT_WORDS[Math.floor(Math.random() * AGENT_WORDS.length)] + '…';
  // mode: 'run' (animated logo + word) | 'done' | 'err' (elapsed time).
  const setStatus = (mode, text) => {
    const s = surface && surface.status;
    if (!s) return;
    s.classList.add('show');
    s.classList.toggle('running', mode === 'run');
    s.classList.toggle('err', mode === 'err');
    s.querySelector('.cstat-text').textContent = text;
  };
  const fmtDuration = (ms) => {
    const s = Math.max(1, Math.round(ms / 1000));
    return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
  };
  const startThinking = () => {
    if (wordTimer) clearInterval(wordTimer);
    setStatus('run', nextWord());
    wordTimer = setInterval(() => setStatus('run', nextWord()), 2800);
  };
  const stopThinking = (errored) => {
    if (wordTimer) { clearInterval(wordTimer); wordTimer = null; }
    const dur = fmtDuration(Date.now() - agentStartAt);
    setStatus(errored ? 'err' : 'done', errored ? `Failed after ${dur}` : `✻ Brewed for ${dur}`);
  };

  // One tool-call row (shared by the Comments stream and the Chat transcript,
  // live and on reload-restore — so the markup stays identical everywhere).
  const renderToolRow = ({ name, file, command }) => {
    const ic = TOOL_ICONS[name] || '·';
    const detail = file
      ? `<code>${escHtml(relPath(file))}</code>`
      : command
        ? `<code>${escHtml(String(command).slice(0, 80))}</code>`
        : '';
    cLog('tool', ic, `${escHtml(name)} ${detail}`.trim());
  };

  // Render one normalized Action (from agent-run.mjs) into the active surface.
  const renderAction = (a) => {
    if (a.kind === 'text') {
      streamText(a.text, a.delta);
      return;
    }
    closeTextRow(); // any non-text event ends the current streamed line
    if (a.kind === 'session') {
      if (a.id) agentSessionId = a.id; // enables follow-up turns
    } else if (a.kind === 'tool') {
      renderToolRow(a);
    } else if (a.kind === 'result') {
      if (!a.ok) {
        agentErrored = true;
        if (a.errorText) cLog('err', '⚠', escHtml(a.errorText));
      } else {
        cLog('done', '✓', 'Changes applied — HMR should refresh the page.');
        removeSent(); // drop just the comments that were dispatched in this run
      }
    }
  };

  const finishAgent = (reason) => {
    if (!agentRunning) return;
    agentRunning = false;
    closeTextRow(); // stop accumulating into the last streamed line
    if (reason) {
      agentErrored = true;
      cLog('err', '⚠', escHtml(reason));
    }
    stopThinking(agentErrored);
    sendBtn.disabled = Q.count() === 0 || !selectedAgent;
    updateComposerState();
  };

  // Run a turn: dispatch the chosen comments (+ optional typed note) to the
  // bridge (agent-run.mjs) and stream the reply into one surface. Resumes the
  // prior session when one exists, so the composer reads as a conversation.
  const runAgent = ({ annotations, note, surface: target }) => {
    if (agentRunning || !selectedAgent) return;
    const anns = annotations || [];
    const text = (note || '').trim();
    if (!anns.length && !text) return;

    agentRunning = true;
    agentErrored = false;
    closeTextRow(); // fresh run — don't append onto a prior run's last line
    sendBtn.disabled = true;
    composerSend.disabled = true;
    // Stream into exactly one surface — the floating panel OR the drawer.
    const onPanel = target === 'panel';
    surface = onPanel ? { log: cpanelLog, status: panelStatus } : { log: stream, status: drawerStatus };
    if (onPanel) cpanel.classList.add('open'); // drawer sends already have the drawer open
    agentStartAt = Date.now();
    startThinking();
    sentIds = anns.map((a) => a.id);

    const parts = [];
    if (anns.length) parts.push(toMarkdownFor(anns));
    if (text) parts.push('## Additional instruction\n' + text);
    const markdown = parts.join('\n\n');
    const images = anns.map((a) => a.screenshot).filter(Boolean);

    // Echo the user's turn into the transcript.
    const cn = anns.length ? `${anns.length} comment${anns.length > 1 ? 's' : ''}` : '';
    cLog('you', '›', escHtml([cn, text && `“${text}”`].filter(Boolean).join(' + ')));

    streamAgentRun(
      { agent: selectedAgent, model: selectedModel, markdown, images, resume: agentSessionId },
      {
        onAction: renderAction,
        onBridgeError: (m) => { agentErrored = true; cLog('err', '⚠', escHtml(m)); },
        onBridgeEnd: () => finishAgent(null),
        onStreamEnd: () => finishAgent(null),
        onError: (m) => finishAgent(m),
      },
      bridgeFetch,
    );
  };

  // Bar "Send all" / ⌥G — whole queue, streams into the floating panel only.
  const sendAll = () => runAgent({ annotations: Q.all().slice(), note: '', surface: 'panel' });
  // Drawer composer — checked comments (∪ @-mentions) + note, streams into the
  // drawer only.
  const sendFromComposer = () => {
    const note = composerText.value.trim();
    const anns = composerDispatch();
    if (agentRunning || (!anns.length && !note)) return;
    runAgent({ annotations: anns, note, surface: 'drawer' });
    composerText.value = '';
    updateComposerState();
  };

  // ---- Chat tab (0010) -----------------------------------------------------
  // A continuous discuss session, separate from the Comments-tab runs above:
  // its own session id (chat.sessionId()), its own transcript, and an "Apply
  // changes" toggle that flips a single turn from discuss → apply-once (D16).
  // Reuses the shared run gate (agentRunning) and stream primitives, so a chat
  // turn and a comments run can never interleave on the shared streaming state.
  const chatStateUpdate = () => {
    const hasText = chatText.value.trim().length > 0;
    const hasChips = chat.chips().length > 0;
    chatSend.disabled = agentRunning || !selectedAgent || (!hasText && !hasChips);
    const on = chat.applyOn();
    chatApplyBtn.classList.toggle('on', on);
    chatApplyBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  // One chip per element attached to the current chat draft (0011). Numbered to
  // match the screenshot image refs the turn's markdown cites.
  const renderChatChips = () => {
    chatChips.innerHTML = '';
    chat.chips().forEach((c, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.dataset.chip = c.id;
      chip.title = `${c.loc || 'source unknown'} — ${c.label}`;
      chip.innerHTML =
        `<span class="chip-num">${i + 1}</span>` +
        `<span class="chip-lbl">${escHtml(c.label)}</span>` +
        `<button class="chip-x" data-act="chat-chip-remove" title="Remove">×</button>`;
      chatChips.appendChild(chip);
    });
  };
  // Capture a screenshot for a chip the same way annotations do — async, and
  // tolerant of CORS/detached nodes (chip just stays image-less on failure).
  const captureChipShot = (el, chip) =>
    toPng(el, { cacheBust: true, pixelRatio: 1 })
      .then((png) => { chip.screenshot = png; })
      .catch(() => {});
  // Chat tab is active and the user picked an element: attach it as a read-only
  // context chip (D13) instead of opening a comment note. Reuses the locator +
  // style provenance (0002) — color is the most telling Spark/scoped/shared signal.
  const attachChatChip = (el) => {
    const prov = provenance.inspect(el, 'color');
    const chip = chat.addChip({
      loc: el.getAttribute(LOC_ATTR) || '',
      label: labelFor(el),
      tag: el.tagName.toLowerCase(),
      classList: Array.from(el.classList || []),
      provenance: { selector: prov.selector, sourceKind: prov.sourceKind, value: prov.value },
      screenshot: null,
    });
    captureChipShot(el, chip);
    if (!drawerOpen) openDrawer(); // surface the landing chip + composer
    renderChatChips();
    chatStateUpdate();
  };
  // Render one persisted transcript entry — also the live-render path, so the
  // markup is identical whether streamed now or replayed after a reload.
  const renderChatEntry = (e) => {
    if (e.k === 'you') cLog('you', '›', escHtml(e.text));
    else if (e.k === 'ctx') cLog('ctx', '↳', escHtml(e.labels));
    else if (e.k === 'text') streamText(e.text, false);
    else if (e.k === 'tool') renderToolRow(e);
    else if (e.k === 'err') cLog('err', '⚠', escHtml(e.m));
  };
  // Like renderAction, but for the chat surface: capture the session into the
  // chat model (not the comments agentSessionId), persist each rendered entry,
  // and never removeSent() — chat has no queue subset.
  const renderChatAction = (a) => {
    if (a.kind === 'text') {
      streamText(a.text, a.delta);
      if (!a.delta) chat.record({ k: 'text', text: a.text }); // authoritative full block
      return;
    }
    // A non-text Action closes the streamed line; persist delta-only prose that
    // never got an authoritative final block (openTextMsg still open).
    if (openTextMsg && openTextBuf) chat.record({ k: 'text', text: openTextBuf });
    closeTextRow();
    if (a.kind === 'session') {
      chat.setSession(a.id); // resume the same thread on the next turn
    } else if (a.kind === 'tool') {
      const e = { k: 'tool', name: a.name, file: a.file, command: a.command };
      renderToolRow(e);
      chat.record(e);
    } else if (a.kind === 'result' && !a.ok) {
      agentErrored = true;
      if (a.errorText) { cLog('err', '⚠', escHtml(a.errorText)); chat.record({ k: 'err', m: a.errorText }); }
    }
  };
  const finishChat = (reason) => {
    if (!agentRunning) return;
    agentRunning = false;
    if (openTextMsg && openTextBuf) chat.record({ k: 'text', text: openTextBuf }); // trailing prose
    closeTextRow();
    if (reason) { agentErrored = true; cLog('err', '⚠', escHtml(reason)); chat.record({ k: 'err', m: reason }); }
    stopThinking(agentErrored);
    sendBtn.disabled = Q.count() === 0 || !selectedAgent;
    chatStateUpdate();
    updateComposerState();
  };
  const runChat = () => {
    const text = chatText.value.trim();
    const chips = chat.chips();
    if (agentRunning || !selectedAgent || (!text && !chips.length)) return;
    agentRunning = true;
    agentErrored = false;
    closeTextRow();
    sendBtn.disabled = true;
    composerSend.disabled = true;
    chatSend.disabled = true;
    surface = { log: chatStream, status: chatStatus };
    const empty = chatStream.querySelector('.chat-empty');
    if (empty) chatStream.innerHTML = ''; // first turn — drop the placeholder
    agentStartAt = Date.now();
    startThinking();
    const mode = chat.takeMode(); // discuss, or apply-once for this one turn (then OFF)

    // Fold any attached context chips into the turn: their element references go
    // into the markdown, their screenshots ride along as numbered images (0011).
    let markdown = text;
    let images = [];
    if (chips.length) {
      markdown = (text ? text + '\n\n' : '') + contextChipsBlock(chips);
      images = chips.map((c) => c.screenshot).filter(Boolean);
    }
    chat.clearChips(); // attachments are per-turn — no auto-carry (D13)
    renderChatChips();
    chatStateUpdate(); // reflect the toggle reset + cleared chips

    if (text) cLog('you', '›', escHtml(text));
    if (text) chat.record({ k: 'you', text });
    if (chips.length) {
      const labels = chips.map((c) => c.label).join(', ');
      cLog('ctx', '↳', escHtml(labels));
      chat.record({ k: 'ctx', labels });
    }
    chatText.value = '';

    streamAgentRun(
      { agent: selectedAgent, model: selectedModel, markdown, images, resume: chat.sessionId(), mode },
      {
        onAction: renderChatAction,
        onBridgeError: (m) => { agentErrored = true; cLog('err', '⚠', escHtml(m)); chat.record({ k: 'err', m }); },
        onBridgeEnd: () => finishChat(null),
        onStreamEnd: () => finishChat(null),
        onError: (m) => finishChat(m),
      },
      bridgeFetch,
    );
  };
  // Replay the persisted transcript into the stream (called once on init); an
  // empty thread shows a placeholder instead.
  const restoreChat = () => {
    const es = chat.entries();
    chatStream.innerHTML = '';
    if (!es.length) {
      chatStream.innerHTML =
        '<div class="chat-empty">Ask anything about this page.<br>Discuss freely — toggle “Apply changes” to let the agent edit.</div>';
      return;
    }
    surface = { log: chatStream, status: chatStatus };
    closeTextRow();
    es.forEach(renderChatEntry);
    closeTextRow();
    surface = null;
  };

  // Write the screenshot to the clipboard as an IMAGE (not text) so it can be
  // pasted straight into Claude as a real image. One item per write, so this is
  // per-annotation: paste the markdown once, then paste each image where needed.
  // Decode a data: URL to a Blob synchronously — no fetch/await, so the clipboard
  // write below stays inside the click's user-activation.
  const dataURLToBlob = (dataURL) => {
    const comma = dataURL.indexOf(',');
    const meta = dataURL.slice(5, comma); // after "data:"
    const mime = meta.split(';')[0] || 'image/png';
    const bin = atob(dataURL.slice(comma + 1));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  };

  // Download the screenshot as a PNG — the reliable path on http origins, where
  // no API can place a genuinely pasteable image on the clipboard. Drag the file
  // into Claude.
  const downloadImage = (a, btn) => {
    const link = document.createElement('a');
    link.href = a.screenshot;
    link.download = `annotation-${Q.indexOf(a) + 1}.png`;
    link.click();
    flash(btn, 'Saved PNG ↓');
  };

  const copyImage = (a, btn) => {
    if (!a.screenshot) return;
    // Secure context only: the async Clipboard API can place a real image/png
    // that Claude accepts on paste. Falls back to a download otherwise.
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      try {
        const blob = dataURLToBlob(a.screenshot);
        navigator.clipboard
          .write([new ClipboardItem({ 'image/png': blob })])
          .then(() => flash(btn, 'Copied!'))
          .catch(() => downloadImage(a, btn));
        return;
      } catch (_) {}
    }
    downloadImage(a, btn);
  };

  const exportMarkdown = () => {
    if (!Q.count()) return;
    const blob = new Blob([toMarkdown(true)], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pointcut-handoff.md';
    link.click();
    URL.revokeObjectURL(url);
  };

  // ---- Jump-to-source ------------------------------------------------------
  const openInEditor = (loc) => {
    if (!loc || !loc.includes(':')) return;
    const [file, line, col] = loc.split(':');
    bridgeFetch(`/__pointcut/open?file=${encodeURIComponent(file)}&line=${line || 1}&col=${col || 1}`).catch(() => {});
  };

  // ---- Pick mode + marquee -------------------------------------------------
  const setPicking = (on) => {
    picking = on;
    pickBtn.classList.toggle('on', on);
    if (!on) {
      hideOutline();
      marquee.style.display = 'none';
      closeNote();
    }
  };

  const hideOutline = () => {
    outline.style.display = 'none';
    tagLabel.style.display = 'none';
  };

  const positionOutline = (el) => {
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

  let dragStart = null;
  let dragging = false;
  let justDragged = false;

  const marqueeRect = (a, b) => ({
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  });

  const onMouseDown = (e) => {
    // Click-away closes an open popover — unless the press lands on the popover
    // itself or a bubble (the bubble's own handler toggles it).
    if (openPopId != null) {
      const path = e.composedPath();
      if (!path.includes(popover) && !path.some((n) => n.classList && n.classList.contains('bubble'))) {
        closePopover();
      }
    }
    if (!picking || isOwn(e.composedPath()[0])) return;
    dragStart = { x: e.clientX, y: e.clientY };
    dragging = false;
  };

  const onMove = (e) => {
    if (!picking) return;
    if (dragStart) {
      const cur = { x: e.clientX, y: e.clientY };
      if (!dragging && Math.hypot(cur.x - dragStart.x, cur.y - dragStart.y) > DRAG_THRESHOLD) {
        dragging = true;
        hideOutline();
      }
      if (dragging) {
        const r = marqueeRect(dragStart, cur);
        marquee.style.display = 'block';
        marquee.style.left = r.left + 'px';
        marquee.style.top = r.top + 'px';
        marquee.style.width = r.width + 'px';
        marquee.style.height = r.height + 'px';
        return;
      }
    }
    const el = e.composedPath()[0];
    if (!el || !el.nodeType || isOwn(el)) {
      hideOutline();
      return;
    }
    positionOutline(el);
  };

  const onMouseUp = (e) => {
    if (!picking || !dragStart) return;
    if (dragging) {
      const r = marqueeRect(dragStart, { x: e.clientX, y: e.clientY });
      marquee.style.display = 'none';
      justDragged = true;
      const region = {
        x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height,
      };
      openNote({ region }, { bottom: r.top + r.height, left: r.left }, null);
    }
    dragStart = null;
    dragging = false;
  };

  const onClick = (e) => {
    if (!picking) return;
    if (justDragged) {
      justDragged = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const target = e.composedPath()[0];
    if (isOwn(target)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = locator.stampedAncestor(target);
    // Pick is tab-aware (D13): with the Chat tab active a pick attaches the
    // element to the chat draft as a context chip; otherwise it creates a comment.
    if (activeTab === 'chat') {
      attachChatChip(el);
      return;
    }
    openNote({ el }, el.getBoundingClientRect(), null);
  };


  // ---- Comments drawer -----------------------------------------------------
  const renderDrawer = () => {
    drawerCount.textContent = Q.count() ? String(Q.count()) : '';
    if (!Q.count()) {
      drawerList.innerHTML =
        '<div class="drawer-empty">No comments yet.<br>Use Pick to annotate an element or region.</div>';
      updateComposerState();
      return;
    }
    drawerList.innerHTML = '';
    Q.all().forEach((a, i) => {
      const row = document.createElement('div');
      row.className = 'crow' + (expandedIds.has(a.id) ? '' : ' collapsed');
      row.dataset.id = a.id;
      row.innerHTML =
        `<div class="crow-top">` +
        `<input type="checkbox" class="crow-check" data-act="drow-select"${Q.isSelected(a.id) ? ' checked' : ''} title="Include when sending" />` +
        `<span class="crow-num">${i + 1}</span>` +
        `<div class="src"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><span class="src-name"></span></div>` +
        `<div class="crow-tools">` +
        `<button class="crow-act" data-act="drow-edit" data-tip="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>` +
        `<button class="crow-act danger" data-act="drow-delete" data-tip="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg></button>` +
        `</div>` +
        `<svg class="crow-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>` +
        `</div>` +
        `<div class="crow-detail">` +
        (a.screenshot
          ? `<div class="shot-wrap collapsed"><button class="disclosure" data-act="toggle-shot"><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg><span>Screenshot</span></button><img class="crow-shot" src="${a.screenshot}" alt="" /></div>`
          : '') +
        `<div class="comment"><div class="comment-title">Comment</div><blockquote class="crow-body"></blockquote></div>` +
        `</div>`;
      fillSrc(row.querySelector('.src'), a.loc);
      row.querySelector('.crow-body').textContent = a.comment;
      drawerList.appendChild(row);
    });
    updateComposerState();
  };

  // Reflect the active tab onto the drawer (CSS shows/hides each pane) and the
  // tab buttons. Persisted so it survives a reload.
  const applyTab = () => {
    drawer.classList.toggle('tab-chat', activeTab === 'chat');
    drawerTabs.querySelectorAll('.dtab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === activeTab);
    });
  };
  const selectTab = (tab) => {
    if (tab !== 'comments' && tab !== 'chat') return;
    activeTab = tab;
    try { localStorage.setItem(TAB_KEY, tab); } catch (_) {}
    applyTab();
  };

  const openDrawer = () => {
    drawerOpen = true;
    renderDrawer();
    applyTab();
    scrim.classList.add('open');
    drawer.classList.add('open');
  };
  const closeDrawer = () => {
    drawerOpen = false;
    scrim.classList.remove('open');
    drawer.classList.remove('open');
  };

  const clearAll = () => {
    Q.clear();
    locator.clear();
    refreshCount();
    renderBubbles();
    closePopover();
  };

  // ---- Wiring --------------------------------------------------------------
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'pick') setPicking(!picking);
    else if (act === 'comments') openDrawer();
    else if (act === 'send') sendAll();
    else if (act === 'clear') clearAll();
    else if (act === 'collapse') collapseBar();
  });

  // ---- Draggable bar -------------------------------------------------------
  // The bar defaults to bottom-center via CSS. Grabbing the grip pins it to
  // free left/top (px) so it can be dragged anywhere, clamped to the viewport.
  // The chosen spot is saved to localStorage and restored on the next load.
  let barDrag = null;
  // Pin the bar at a free left/top, clamped to the viewport, dropping the
  // CSS bottom-center anchoring. Returns the applied { left, top }.
  const setBarPos = (left, top) => {
    const r = bar.getBoundingClientRect();
    const l = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));
    const t = Math.max(8, Math.min(top, window.innerHeight - r.height - 8));
    bar.style.left = l + 'px';
    bar.style.top = t + 'px';
    bar.style.bottom = 'auto';
    bar.style.transform = 'none';
    return { left: l, top: t };
  };
  const onGripMove = (e) => {
    if (!barDrag) return;
    if (Math.hypot(e.clientX - barDrag.x0, e.clientY - barDrag.y0) > DRAG_THRESHOLD) barDrag.moved = true;
    setBarPos(e.clientX - barDrag.dx, e.clientY - barDrag.dy);
  };
  const onGripUp = () => {
    const d = barDrag;
    barDrag = null;
    d.handle.classList.remove('dragging');
    document.removeEventListener('mousemove', onGripMove, true);
    document.removeEventListener('mouseup', onGripUp, true);
    if (d.moved) {
      const r = bar.getBoundingClientRect();
      try { localStorage.setItem(POS_KEY, JSON.stringify({ left: r.left, top: r.top })); } catch (_) {}
    } else if (d.onTap) {
      d.onTap(); // a press that never moved = a click on the handle
    }
  };
  // Start dragging the bar by `handle`. If the press never crosses the drag
  // threshold, it counts as a tap and `onTap` fires (used to expand the puck).
  const startBarDrag = (e, handle, onTap) => {
    e.preventDefault();
    const r = bar.getBoundingClientRect();
    barDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false, handle, onTap };
    setBarPos(r.left, r.top);
    handle.classList.add('dragging');
    document.addEventListener('mousemove', onGripMove, true);
    document.addEventListener('mouseup', onGripUp, true);
  };
  grip.addEventListener('mousedown', (e) => startBarDrag(e, grip, null));
  puck.addEventListener('mousedown', (e) => startBarDrag(e, puck, () => expandBar()));

  // Collapse the bar to the sparkle puck; expand restores the full bar. The
  // circle stays anchored to the bar's RIGHT edge (where the collapse button
  // is) so it shrinks toward the click, not back to the centered start. A FLIP
  // animation tweens between the two footprints so the swap reads as a smooth
  // shrink/grow rather than a teleport.
  const flipBar = (mutate) => {
    const first = bar.getBoundingClientRect();
    mutate(first); // toggle class + set the final right-anchored position
    const last = bar.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const sx = first.width / last.width;
    const sy = first.height / last.height;
    bar.style.transformOrigin = 'top left';
    bar.style.transition = 'none';
    bar.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    bar.getBoundingClientRect(); // force reflow so the start frame sticks
    requestAnimationFrame(() => {
      bar.style.transition = 'transform .32s cubic-bezier(.2,.9,.3,1)';
      bar.style.transform = 'none';
    });
    const done = (e) => {
      if (e.target !== bar || e.propertyName !== 'transform') return;
      bar.style.transition = '';
      bar.style.transformOrigin = '';
      bar.removeEventListener('transitionend', done);
    };
    bar.addEventListener('transitionend', done);
  };
  // Center the new footprint (width w, height h) on the old one's right edge.
  const rightAnchor = (first, w, h) => setBarPos(first.right - w, first.top + (first.height - h) / 2);
  const collapseBar = () => {
    flipBar((first) => {
      bar.classList.add('collapsed');
      const r = bar.getBoundingClientRect();
      rightAnchor(first, r.width, r.height);
    });
  };
  const expandBar = () => {
    flipBar((first) => {
      bar.classList.remove('collapsed');
      const r = bar.getBoundingClientRect();
      rightAnchor(first, r.width, r.height);
    });
  };

  composerText.addEventListener('input', () => {
    const ctx = mentionCtx();
    if (ctx) openMention(ctx.query);
    else closeMention();
    updateComposerState();
  });
  composerText.addEventListener('keydown', (e) => {
    if (mentionIsOpen()) {
      if (e.key === 'Escape') { e.preventDefault(); closeMention(); return; }
      if (mentionList.length) {
        if (e.key === 'ArrowDown') { e.preventDefault(); mentionActive = (mentionActive + 1) % mentionList.length; renderMention(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); mentionActive = (mentionActive - 1 + mentionList.length) % mentionList.length; renderMention(); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mentionList[mentionActive]); return; }
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendFromComposer();
    }
  });

  chatText.addEventListener('input', chatStateUpdate);
  chatText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      runChat();
    }
  });

  cpanel.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="agent-close"]')) cpanel.classList.remove('open');
  });

  scrim.addEventListener('click', closeDrawer);
  drawer.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="drawer-close"]')) {
      closeDrawer();
      return;
    }
    if (e.target.closest('[data-act="composer-send"]')) {
      sendFromComposer();
      return;
    }
    if (e.target.closest('[data-act="chat-send"]')) {
      runChat();
      return;
    }
    if (e.target.closest('[data-act="chat-apply"]')) {
      chat.setApply(!chat.applyOn()); // toggle "Apply changes" for the next turn
      chatStateUpdate();
      return;
    }
    const tab = e.target.closest('[data-act="tab"]');
    if (tab) {
      selectTab(tab.dataset.tab);
      return;
    }
    if (e.target.closest('[data-act="toggle-list"]')) {
      listCollapsed = !listCollapsed;
      drawerList.classList.toggle('collapsed', listCollapsed);
      drawerTabs.classList.toggle('collapsed', listCollapsed);
      drawerHead.classList.toggle('collapsed', listCollapsed);
      return;
    }
    const mitem = e.target.closest('.mitem');
    if (mitem) {
      const a = Q.get(mitem.dataset.id);
      if (a) pickMention(a);
      return;
    }
    const chatChipX = e.target.closest('[data-act="chat-chip-remove"]');
    if (chatChipX) {
      chat.removeChip(chatChipX.closest('.chip').dataset.chip);
      renderChatChips();
      chatStateUpdate();
      return; // drop one context attachment before sending
    }
    const chipX = e.target.closest('[data-act="chip-remove"]');
    if (chipX) {
      const id = chipX.closest('.chip').dataset.id;
      selectedIds = selectedIds.filter((x) => x !== id);
      updateComposerState();
      return; // removing a chip just drops that reference
    }
    const row = e.target.closest('.crow');
    if (!row) return;
    const id = row.dataset.id;
    const check = e.target.closest('[data-act="drow-select"]');
    if (check) {
      Q.setSelected(id, check.checked); // include/exclude this item from Send
      updateComposerState();
      return; // don't toggle the card's expanded detail
    }
    const loc = e.target.closest('.src');
    if (loc && loc.classList.contains('linkable')) {
      openInEditor(loc.dataset.loc);
      return;
    }
    const btn = e.target.closest('button[data-act]');
    if (btn) {
      if (btn.dataset.act === 'toggle-shot') {
        btn.closest('.shot-wrap').classList.toggle('collapsed');
      } else if (btn.dataset.act === 'drow-edit') {
        closeDrawer();
        editAnnotation(id);
      } else if (btn.dataset.act === 'drow-delete') {
        deleteAnnotation(id);
      }
      return;
    }
    // Clicking anywhere else on the card toggles its expanded detail.
    if (expandedIds.has(id)) expandedIds.delete(id);
    else expandedIds.add(id);
    row.classList.toggle('collapsed', !expandedIds.has(id));
  });

  note.addEventListener('click', (e) => {
    const act = e.target.getAttribute && e.target.getAttribute('data-act');
    if (act === 'save') saveNote();
    else if (act === 'send-agent') sendNote();
    else if (act === 'sp-dec') stepSpacing(-1);
    else if (act === 'sp-inc') stepSpacing(1);
    else if (act === 'ty-dec') stepType(-1);
    else if (act === 'ty-inc') stepType(1);
    else {
      const prop = e.target.closest && e.target.closest('.sp-prop');
      if (prop) selectSpacingProp(prop.dataset.prop);
      const cprop = e.target.closest && e.target.closest('.cl-prop');
      if (cprop) selectColorProp(cprop.dataset.cprop);
      const swatch = e.target.closest && e.target.closest('.cl-swatch');
      if (swatch) pickColor(swatch.dataset.token);
      const tprop = e.target.closest && e.target.closest('.ty-prop');
      if (tprop) selectTypeProp(tprop.dataset.tprop);
    }
  });
  noteSrc.addEventListener('click', () => openInEditor(noteSrc.dataset.loc));
  noteText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote();
    else if (e.key === 'Escape') closeNote();
  });
  copyText.addEventListener('input', previewCopy); // live preview onto the element
  copyText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote();
    else if (e.key === 'Escape') closeNote();
  });

  popover.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'toggle-shot') popShotWrap.classList.toggle('collapsed');
    else if (act === 'delete') deleteAnnotation(openPopId);
    else if (act === 'edit') editAnnotation(openPopId);
    else if (act === 'send-agent') {
      const a = Q.get(openPopId);
      closePopover();
      if (a) runAgent({ annotations: [a], note: '', surface: 'panel' });
    } else if (act === 'copy-img') {
      const a = Q.get(openPopId);
      if (a) copyImage(a, btn);
    }
  });
  popSrc.addEventListener('click', () => openInEditor(popSrc.dataset.loc));

  bubblesWrap.addEventListener('click', (e) => {
    const b = e.target.closest('.bubble');
    if (!b) return;
    if (openPopId === b.dataset.id) closePopover();
    else openPopover(b.dataset.id);
  });

  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('click', onClick, true);
  const isTyping = () => {
    if (shadow.activeElement === noteText || shadow.activeElement === composerText) return true;
    const el = document.activeElement;
    if (!el) return false;
    return (
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable
    );
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (pickers.some((p) => p.menu.classList.contains('open'))) { closeAgentMenu(); return; }
      if (cpanel.classList.contains('open')) cpanel.classList.remove('open');
      else if (drawerOpen) closeDrawer();
      else if (note.style.display === 'block') closeNote();
      else if (openPopId != null) closePopover();
      else if (picking) setPicking(false);
      return;
    }
    // Alt/⌥ + S / E → Pick / Export. Match on the physical key (e.code) so
    // Option+letter — which remaps e.key on Mac — still resolves; skip while
    // typing and when Cmd/Ctrl is held so we never shadow the browser's own
    // shortcuts. S is left-hand-friendly for one-handed use.
    if (!e.altKey || e.metaKey || e.ctrlKey || isTyping()) return;
    if (e.code === 'KeyS') {
      e.preventDefault();
      setPicking(!picking);
    } else if (e.code === 'KeyE') {
      e.preventDefault();
      exportMarkdown();
    } else if (e.code === 'KeyG') {
      e.preventDefault();
      sendAll();
    } else if (e.code === 'KeyC') {
      e.preventDefault();
      if (drawerOpen) closeDrawer();
      else openDrawer();
    }
  });
  window.addEventListener('scroll', () => picking && hideOutline(), true);

  // ---- Init ----------------------------------------------------------------
  // (Legacy-record backfill — missing id/type — is handled inside createQueue.)
  // Label the popover image button (its tooltip) for what it can actually do
  // here: a real clipboard copy needs a secure context; otherwise it downloads a PNG.
  popCopyImg.dataset.tip =
    window.ClipboardItem && navigator.clipboard && navigator.clipboard.write ? 'Copy image' : 'Save PNG';
  refreshCount();
  renderBubbles();
  restoreChat(); // replay the persisted chat transcript (resumes via chat.sessionId())
  chatStateUpdate();

  // ---- Agent + model picker ------------------------------------------------
  // Probe the bridge for installed coding-agent CLIs and their models, then build
  // a custom combobox: one group per agent, one row per model (value encodes
  // "agent:model"; model '' = the CLI default). Shown whenever there's a choice;
  // none installed → Send stays disabled. The picker is the only place an agent
  // name appears (everything else stays agent-agnostic).
  const modelsOf = (ag) => (ag.models && ag.models.length ? ag.models : [{ label: 'Default', value: '' }]);
  const AGENT_CHECK =
    '<svg class="agent-opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  // Three instances — the bar, the drawer composer, and the chat composer —
  // share one selection; all reflect and drive the same selectedAgent/model.
  const pickers = ['.bar .agent-pick', '.drawer-composer .agent-pick', '.chat-composer .agent-pick'].map((sel) => {
    const wrap = $(sel);
    return {
      wrap,
      trigger: wrap.querySelector('.agent-trigger'),
      label: wrap.querySelector('.agent-trigger-label'),
      menu: wrap.querySelector('.agent-menu'),
    };
  });
  const menuHtml = () =>
    availableAgents
      .map((ag) => {
        const opts = modelsOf(ag)
          .map((m) => {
            const sel = ag.name === selectedAgent && m.value === selectedModel;
            return (
              `<button class="agent-opt${sel ? ' sel' : ''}" data-value="${ag.name}:${m.value}" data-label="${escHtml(m.label)}">` +
              AGENT_CHECK +
              `<span>${escHtml(m.label)}</span></button>`
            );
          })
          .join('');
        return `<div class="agent-group"><div class="agent-group-label">${escHtml(ag.name)}</div>${opts}</div>`;
      })
      .join('');
  const renderAllMenus = () => { const html = menuHtml(); pickers.forEach((p) => { p.menu.innerHTML = html; }); };
  const closeAgentMenu = () => pickers.forEach((p) => { p.menu.classList.remove('open'); p.trigger.classList.remove('open'); });
  const select = (agent, model, label) => {
    selectedAgent = agent;
    selectedModel = model;
    pickers.forEach((p) => { p.label.textContent = label; });
    agentSessionId = null; // a resume id is per-agent/model — don't carry it across a switch
    chat.setSession(null); // ditto for the chat thread — its resume id is stale under a new agent
    renderAllMenus();
    refreshCount();
    updateComposerState();
    chatStateUpdate();
  };
  const applyAgents = (agents) => {
    availableAgents = Array.isArray(agents) ? agents : [];
    const first = availableAgents[0];
    selectedAgent = first ? first.name : null;
    selectedModel = first ? modelsOf(first)[0].value : '';
    const label = first ? modelsOf(first)[0].label : 'No agent';
    const total = availableAgents.reduce((n, ag) => n + modelsOf(ag).length, 0);
    pickers.forEach((p) => { p.label.textContent = label; p.wrap.classList.toggle('show', total > 1); });
    if (!availableAgents.length) sendBtn.dataset.tip = 'No coding-agent CLI found on PATH';
    renderAllMenus();
    refreshCount();
    updateComposerState();
    chatStateUpdate();
  };
  pickers.forEach((p) => {
    p.wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="agent-toggle"]')) {
        const wasOpen = p.menu.classList.contains('open');
        closeAgentMenu(); // only one menu open at a time
        if (!wasOpen) { p.menu.classList.add('open'); p.trigger.classList.add('open'); }
        return;
      }
      const opt = e.target.closest('.agent-opt');
      if (opt) {
        const v = opt.dataset.value;
        const i = v.indexOf(':');
        select(v.slice(0, i), v.slice(i + 1), opt.dataset.label);
        closeAgentMenu();
      }
    });
  });
  // Dismiss on any press outside both comboboxes (composedPath crosses the shadow).
  document.addEventListener('mousedown', (e) => {
    const open = pickers.some((p) => p.menu.classList.contains('open'));
    if (open && !pickers.some((p) => e.composedPath().includes(p.wrap))) closeAgentMenu();
  }, true);
  bridgeFetch('/__pointcut/agents')
    .then((r) => (r.ok ? r.json() : { agents: [] }))
    .then((d) => applyAgents(d && d.agents))
    .catch(() => applyAgents([]));

  // Restore a previously-dragged bar position (clamped, in case the viewport
  // shrank since). Absent or invalid → keep the CSS bottom-center default.
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      setBarPos(saved.left, saved.top);
    }
  } catch (_) {}
}

mount();
