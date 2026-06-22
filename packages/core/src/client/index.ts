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
// accumulates in a Session/Queue persisted to localStorage. Numbered bubbles pin
// to annotated spots. A tabbed side panel holds Comments (the Queue) and Chat
// (a continuous discuss session); it toggles from the toolbar and is non-modal —
// no backdrop, and clicking the page leaves it open (close it from the toolbar
// or its own close button). "Export" downloads a paste-and-go markdown
// Handoff; "Send to agent" streams the chosen agent's Actions back through the
// Bridge. The source loc is clickable to open the file in your editor.
//
// Pure-logic lives in the sibling models (../models/*.mjs) so this file is only
// glue + DOM. The whole thing is wrapped in mount() (idempotent, SSR-safe) and
// auto-mounts on import — the unplugin injects a bare `import '@pointcut/core/client'`.
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
// @ts-ignore — .mjs sibling, typed structurally.
import { renderMarkdown } from '../models/markdown.mjs';
// @ts-ignore — .mjs sibling, typed structurally.
import * as slashMenu from '../models/slash-menu.mjs';
// @ts-ignore — .mjs sibling, typed structurally.
import { reducePickMode } from '../models/pick-mode.mjs';

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
      /* While the agent works, the collapsed puck pulses its visibility — the
         same cpulse the in-stream thinking logo uses — so the circle reads as
         "busy" even with the feed scrolled away. */
      .bar.collapsed.thinking .puck { animation: cpulse 1.1s ease-in-out infinite; }
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
      .drawer-head .dbrand { padding: 0; gap: 6px; }
      .drawer-head .dbrand svg { height: 26px; }
      .drawer-head .dbrand .brand-name { font-size: 16px; }
      .drawer-head .dcount { font-size: 12px; opacity: .5; }
      .drawer-head .dclose {
        all: unset; cursor: pointer; margin-left: 8px; width: 30px; height: 30px; border-radius: 8px;
        display: inline-flex; align-items: center; justify-content: center; color: #cfd5df; flex: none;
      }
      .drawer-head .dclose:hover { background: rgba(255,255,255,.08); color: #fff; }
      .drawer-head .dclose svg { width: 17px; height: 17px; }
      /* Header navigation — the Chat view (home) shows the brand + a comments
         bubble that opens the Comments sub-view; the Comments view swaps in a
         back arrow + "Comments" heading that returns to Chat. */
      .dhead-spacer { flex: 1; }
      .drawer-head .dback, .drawer-head .dbubble {
        all: unset; cursor: pointer; width: 30px; height: 30px; border-radius: 8px; position: relative;
        display: inline-flex; align-items: center; justify-content: center; color: #cfd5df; flex: none;
      }
      .drawer-head .dback:hover, .drawer-head .dbubble:hover { background: rgba(255,255,255,.08); color: #fff; }
      .drawer-head .dback svg, .drawer-head .dbubble svg { width: 18px; height: 18px; }
      .drawer-head .dhead-title { font-size: 16px; font-weight: 600; color: #fff; }
      .dbubble-badge {
        position: absolute; top: -2px; right: -2px; min-width: 15px; height: 15px; padding: 0 4px;
        border-radius: 8px; background: var(--pc-accent); color: var(--pc-ink); font-size: 10px; font-weight: 700;
        display: none; align-items: center; justify-content: center; box-sizing: border-box;
      }
      .dbubble-badge.show { display: flex; }
      /* Chat view (home): brand + bubble; hide the Comments-view affordances. */
      .drawer.tab-chat .drawer-head .dback,
      .drawer.tab-chat .drawer-head .dhead-title,
      .drawer.tab-chat .drawer-head .dcount { display: none; }
      /* Comments view (sub): back arrow + heading; hide the brand + bubble. */
      .drawer:not(.tab-chat) .drawer-head .dbrand,
      .drawer:not(.tab-chat) .drawer-head .dbubble { display: none; }
      /* Chat tab (0010) — a continuous discuss session: transcript + composer
         with an "Apply changes" toggle. Hidden until the Chat tab is active. */
      .chat-pane { display: none; flex: 1 1 0; min-height: 0; flex-direction: column; }
      .drawer.tab-chat .chat-pane { display: flex; }
      .drawer.tab-chat .drawer-list, .drawer.tab-chat .drawer-stream, .drawer.tab-chat .drawer-actions, .drawer.tab-chat .add-note-box { display: none; }
      /* Chat header — start a fresh thread or jump back to a previous one. */
      .chat-head { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,.08); }
      /* Conversation title — agent-generated from context (falls back to the
         first message, then "New chat"). The new-chat + history actions are
         icon-only buttons grouped on the right. */
      .chat-title { flex: 1 1 auto; min-width: 0; font-size: 13px; font-weight: 600; color: #e7e9ee; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .chat-title.untitled { color: rgba(231,233,238,.5); font-weight: 500; }
      .chat-head-actions { flex: none; display: flex; align-items: center; gap: 2px; }
      .chat-hist-wrap { position: relative; }
      .chat-icon-btn {
        appearance: none; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
        background: none; border: 1px solid transparent; border-radius: 8px; color: rgba(231,233,238,.7);
        width: 30px; height: 30px; padding: 0;
      }
      .chat-icon-btn:hover, .chat-icon-btn.open { background: rgba(255,255,255,.08); color: #e7e9ee; }
      .chat-icon-btn svg { width: 16px; height: 16px; }
      .chat-hist-menu {
        display: none; position: absolute; top: calc(100% + 6px); right: 0; z-index: 5; width: 248px; max-height: 320px; overflow-y: auto;
        background: #1b1d23; border: 1px solid rgba(255,255,255,.12); border-radius: 10px; padding: 4px;
        box-shadow: 0 12px 32px rgba(0,0,0,.45);
      }
      .chat-hist-menu.open { display: block; }
      .chat-hist-empty { opacity: .5; font-size: 12px; padding: 10px 12px; text-align: center; }
      .chat-hist-item {
        display: flex; align-items: center; gap: 6px; border-radius: 7px; padding: 0 2px 0 0;
      }
      .chat-hist-item:hover { background: rgba(255,255,255,.06); }
      .chat-hist-item.active { background: rgba(255,255,255,.09); }
      .chat-hist-open {
        appearance: none; flex: 1 1 auto; min-width: 0; cursor: pointer; text-align: left;
        background: none; border: none; color: #e7e9ee; font: inherit; font-size: 12px; padding: 8px 8px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .chat-hist-item.active .chat-hist-open { font-weight: 600; }
      .chat-hist-del {
        appearance: none; flex: none; cursor: pointer; background: none; border: none; border-radius: 6px;
        color: rgba(231,233,238,.45); width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;
      }
      .chat-hist-del:hover { background: rgba(255,80,80,.16); color: #ff8a8a; }
      .chat-hist-del svg { width: 13px; height: 13px; }
      .chat-stream { flex: 1 1 0; min-height: 0; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
      .chat-empty { opacity: .5; text-align: center; padding: 48px 16px; font-size: 13px; line-height: 1.6; }
      .chat-composer { flex: none; position: relative; border-top: 1px solid rgba(255,255,255,.08); padding: 12px; }
      .chat-composer > .cstatus { padding: 0 2px 8px; }
      /* Attach-element button — picks an on-page element to attach as context.
         A direct icon button in the composer bar (no menu). */
      .add-trigger {
        all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
        width: 32px; height: 32px; border-radius: 9px; border: 1px solid #2f343c; color: rgba(231,233,238,.8);
        transition: border-color .12s, background .12s, color .12s;
      }
      .add-trigger svg { width: 17px; height: 17px; }
      .add-trigger:hover { color: #e7e9ee; background: rgba(255,255,255,.06); }
      .add-trigger.armed { color: var(--pc-accent); border-color: var(--pc-accent); }
      /* Agent mode line — Claude-Code-style sticky posture, cycled with Shift+Tab.
         Sits under the input; clicking it also cycles. discuss = read-only/neutral,
         apply = accent (the turn will edit files). */
      .mode-hint {
        all: unset; box-sizing: border-box; cursor: pointer; align-self: flex-start;
        display: inline-flex; align-items: center; gap: 6px; padding: 2px 7px; border-radius: 7px;
        font-size: 11.5px; line-height: 1.45; color: rgba(231,233,238,.5); transition: background .12s, color .12s;
      }
      .mode-hint:hover { background: rgba(255,255,255,.06); }
      .mode-hint .mode-caret { font-weight: 800; letter-spacing: -1.5px; }
      .mode-hint .mode-name { font-weight: 600; text-transform: lowercase; }
      .mode-hint .mode-cycle { opacity: .6; }
      .mode-hint.discuss .mode-caret, .mode-hint.discuss .mode-name { color: rgba(231,233,238,.72); }
      .mode-hint.apply { color: var(--pc-accent); }
      .mode-hint.apply .mode-caret, .mode-hint.apply .mode-name { color: var(--pc-accent); }
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
        border: 1px solid #2b313c; border-radius: 14px; padding: 12px 12px 10px;
      }
      .composer-box:focus-within { border-color: var(--pc-accent); box-shadow: 0 0 0 3px rgba(182,250,5,.22); }
      /* Input row: brand spark sits to the left of the first line of the textarea. */
      .composer-input { position: relative; display: flex; align-items: flex-start; gap: 9px; }
      .composer-spark { flex: none; width: 18px; height: 18px; margin-top: 2px; color: var(--pc-accent); pointer-events: none; }
      .composer-spark svg { width: 100%; height: 100%; display: block; }
      /* "/" slash-menu — project skills/commands the chosen agent can invoke.
         Pops ABOVE the input (composer sits low in the drawer); opens on "/" at
         the start of a token, filters as you type. Mirrors .agent-menu styling. */
      .skill-menu {
        position: absolute; left: 0; right: 0; bottom: calc(100% + 8px); display: none; flex-direction: column; gap: 1px;
        max-height: 260px; overflow-y: auto; z-index: 8;
        background: #1b1d21; border: 1px solid #2b313c; border-radius: 12px; padding: 6px;
        box-shadow: 0 16px 44px rgba(0,0,0,.55);
      }
      .skill-menu.open { display: flex; }
      .skill-opt {
        all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; gap: 2px;
        padding: 7px 9px; border-radius: 8px; color: #e7e9ee;
      }
      .skill-opt:hover, .skill-opt.active { background: #2a2c30; }
      .skill-opt-top { display: flex; align-items: center; gap: 7px; }
      .skill-opt-name { font-size: 13px; font-weight: 500; }
      .skill-opt-name b { color: var(--pc-accent); font-weight: 600; } /* matched query span */
      .skill-opt-kind {
        font-size: 10px; line-height: 1; text-transform: uppercase; letter-spacing: .04em;
        color: #8b93a1; border: 1px solid rgba(255,255,255,.12); border-radius: 5px; padding: 2px 4px; flex: none;
      }
      .skill-opt-desc {
        font-size: 11px; color: #8b93a1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
      }
      .skill-menu-empty { padding: 8px 9px; font-size: 12px; color: #8b93a1; }
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
      .chip .chip-ico { width: 13px; height: 13px; flex: none; color: var(--pc-accent); opacity: .85; }
      .chip .chip-lbl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
      .chip .chip-x { all: unset; cursor: pointer; opacity: .5; font-size: 14px; line-height: 1; padding: 0 1px; flex: none; }
      .chip .chip-x:hover { opacity: 1; color: #ff8d8d; }
      .composer-box textarea {
        flex: 1; width: 100%; box-sizing: border-box; min-height: 64px; max-height: 140px; resize: none;
        background: transparent; color: #fff; border: 0; padding: 0; margin-top: 1px; font: inherit; font-size: 14px; line-height: 1.4;
      }
      .composer-box textarea::placeholder { color: rgba(231,233,238,.4); }
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
        position: relative; background: #1a1b1e; border: 1px solid rgba(255,255,255,.07); border-radius: 16px;
        overflow: hidden; display: flex; flex-direction: column;
        transition: border-color .12s, background .12s;
      }
      .crow:hover { border-color: rgba(255,255,255,.14); background: #1d1e22; }
      .crow-detail { display: flex; flex-direction: column; gap: 8px; }
      .crow-top { display: flex; align-items: center; gap: 8px; }
      /* Checkbox + number fused into one brand-tinted pill. */
      .crow-idgrp {
        display: inline-flex; align-items: center; gap: 8px; flex: none;
        padding: 5px 8px; border-radius: 11px;
        background: rgba(182,250,5,.07); border: 1px solid rgba(182,250,5,.28);
      }
      .crow-num {
        width: 22px; height: 22px; border-radius: 6px; background: var(--pc-accent); color: var(--pc-ink);
        font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex: none;
        border: 1.5px solid #fff;
      }
      .crow-top .src { margin-bottom: 0; min-width: 0; flex: 1; border: 1px solid rgba(255,255,255,.1); }
      /* Labeled Edit / Dismiss buttons — quiet until the row is hovered. */
      .crow-tools { display: flex; gap: 6px; flex: none; }
      .crow-act {
        all: unset; box-sizing: border-box; cursor: pointer; flex: none;
        display: inline-flex; align-items: center; justify-content: center; padding: 6px;
        border-radius: 8px; font-size: 12px; font-weight: 600;
        color: var(--pc-accent); border: 1px solid rgba(182,250,5,.3); background: rgba(182,250,5,.06);
        transition: background .12s, border-color .12s, color .12s;
      }
      .crow-act svg { width: 14px; height: 14px; }
      .crow-act:hover { background: rgba(182,250,5,.14); border-color: rgba(182,250,5,.5); }
      .crow-act.danger { color: #ff8d8d; border-color: rgba(255,90,90,.3); background: rgba(255,90,90,.06); }
      .crow-act.danger:hover { background: rgba(255,90,90,.14); border-color: rgba(255,90,90,.5); color: #ffa3a3; }
      /* Titled comment block — popover keeps the left-rail blockquote look. */
      .comment-title {
        font-size: 11px; font-weight: 600; letter-spacing: .03em; text-transform: uppercase;
        color: #8b93a1; margin-bottom: 6px;
      }
      .body {
        margin: 0; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
        color: #e7e9ee; border-left: 3px solid rgba(255,255,255,.16); background: rgba(255,255,255,.035);
        border-radius: 0 7px 7px 0; padding: 8px 11px;
      }
      /* Drawer comment body — plain text panel below the head divider. */
      .crow-body {
        margin: 0; font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
        color: #e7e9ee; padding: 12px 14px; min-height: 22px;
      }
      /* ---- Comments tab revamp ------------------------------------------- */
      /* Top action bar (replaces the old foot composer): selection count, Add
         note, and Send to agent. Sits above the scrolling list, and only shows
         once at least one comment is checked. */
      .drawer-actions {
        flex: none; display: none; align-items: center; gap: 8px; padding: 10px 12px;
        border-bottom: 1px solid rgba(255,255,255,.08);
      }
      .drawer-actions.show { display: flex; }
      .drawer-actions .sel-info { font-size: 12px; color: #8b93a1; }
      .actbtn {
        all: unset; box-sizing: border-box; cursor: pointer; margin-left: auto;
        font-size: 12px; font-weight: 600; color: #cfd5df; padding: 7px 11px; border-radius: 9px;
        transition: background .12s, color .12s;
      }
      .actbtn:hover { background: rgba(255,255,255,.07); color: #fff; }
      .send-claude {
        all: unset; box-sizing: border-box; cursor: pointer; flex: none; display: inline-flex;
        align-items: center; gap: 7px; padding: 7px 12px; border-radius: 10px;
        background: var(--pc-accent); color: var(--pc-ink); font-size: 12px; font-weight: 600;
        transition: background .12s;
      }
      .send-claude:hover { background: var(--pc-accent-hover); }
      .send-claude[disabled] { background: rgba(182,250,5,.3); color: rgba(24,26,14,.5); cursor: not-allowed; }
      .send-claude svg { width: 14px; height: 14px; display: block; }
      /* Add-note input — drops below the action bar when "Add note" is clicked. */
      .add-note-box { flex: none; display: none; flex-direction: column; gap: 8px; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.08); }
      .add-note-box.open { display: flex; }
      .mini-input {
        width: 100%; box-sizing: border-box; min-height: 54px; max-height: 140px; resize: none;
        background: #11141a; color: #fff; border: 1px solid #2b313c; border-radius: 10px;
        padding: 8px 9px; font: inherit; font-size: 13px;
      }
      .mini-input:focus { outline: none; border-color: var(--pc-accent); box-shadow: 0 0 0 3px rgba(182,250,5,.22); }
      .mini-actions { display: flex; gap: 8px; justify-content: flex-end; }
      .mini-btn {
        all: unset; box-sizing: border-box; cursor: pointer; padding: 7px 13px; border-radius: 9px;
        font-size: 12px; font-weight: 600; background: var(--pc-accent); color: var(--pc-ink);
        transition: background .12s;
      }
      .mini-btn:hover { background: var(--pc-accent-hover); }
      .mini-btn[disabled] { opacity: .4; cursor: not-allowed; }
      .mini-btn.ghost { background: #2a2c30; color: #e7e9ee; }
      .mini-btn.ghost:hover { background: #363940; }
      /* Filename chip in the card head — boxed, with the file icon in its own
         faint inner square. */
      .crow .src {
        margin: 0; min-width: 0; padding: 5px 9px; border-radius: 9px; font-size: 12px;
        background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); color: #cfd5df;
      }
      .crow .src svg {
        width: 12px; height: 12px; padding: 3px; border-radius: 5px; box-sizing: content-box;
        background: rgba(255,255,255,.06); opacity: .85;
      }
      /* Filename chip + divider + relative time, sharing the left of the head. */
      .crow-meta { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
      .crow-divider { width: 1px; height: 18px; background: rgba(255,255,255,.12); flex: none; }
      /* Comment card head — filename + time on the left, Selected + tools on the right. */
      .crow-head {
        display: flex; align-items: center; gap: 10px; padding: 10px 12px;
        border-bottom: 1px solid rgba(255,255,255,.07);
      }
      .crow-time { font-size: 12px; color: #8b93a1; flex: none; }
      .crow-resolve {
        all: unset; box-sizing: border-box; cursor: pointer; flex: none;
        display: inline-flex; align-items: center; color: #8b93a1; transition: color .12s;
      }
      .crow-resolve:hover { color: #e7e9ee; }
      .crow-resolve-box {
        width: 18px; height: 18px; border-radius: 5px; border: 1.5px solid rgba(255,255,255,.22);
        display: inline-flex; align-items: center; justify-content: center; flex: none; position: relative;
      }
      .crow-resolve:hover .crow-resolve-box { border-color: rgba(255,255,255,.4); }
      /* Selected = brand-tinted box with a chartreuse check (outline, not filled). */
      .crow-resolve-box.on { border-color: var(--pc-accent); background: rgba(182,250,5,.08); }
      .crow-resolve-box.on::after {
        content: ''; position: absolute; left: 6px; top: 2.5px; width: 4px; height: 8px;
        border: solid var(--pc-accent); border-width: 0 2px 2px 0; transform: rotate(45deg);
      }
      .crow.selected { border-color: rgba(255,255,255,.12); }
      .panel {
        position: fixed; pointer-events: auto; display: none;
        background: #1b1d21; color: #fff; padding: 14px; border-radius: 14px;
        box-shadow: 0 12px 36px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.06);
        width: 320px; box-sizing: border-box; font-size: 13px;
      }
      /* Note panel — Concept 2 "command-bar bubble": a compact, intent-first
         strip (header · intent · input · property row · value strip · footer).
         Surfaces are scoped to the note so the rest of the toolbar keeps its
         own palette; only the brand accent (--pc-accent) is shared. */
      .panel.note {
        --nb-bg: #11161D; --nb-surface: #151A21; --nb-surface-2: #0D1117; --nb-surface-3: #1B222B;
        --nb-border: #2A3440; --nb-border-strong: #3B4654;
        --nb-text: #F4F7FB; --nb-text-2: #B6BEC9; --nb-muted: #7D8793; --nb-warning: #F7C948;
        width: 456px; max-width: calc(100vw - 24px); padding: 14px; border-radius: 14px;
        /* Hidden until openNote(); positionPanel() sets an inline display:block
           to reveal it. (The base must stay none — it's more specific than
           .panel's display:none, so a flex/block here would show it on load.) */
        display: none; flex-direction: column; gap: 10px;
        background: var(--nb-bg); border: 1px solid var(--nb-border); color: var(--nb-text);
        box-shadow: 0 18px 42px rgba(0,0,0,.34);
      }
      /* positionPanel() forces an inline display:block when the note opens,
         which overrides display:flex and silently kills the column gap. Carry
         the major-row rhythm on adjacent-sibling margins so it survives that.
         Hidden rows (display:none tray, collapsed tabs) drop out cleanly. */
      .panel.note > * + * { margin-top: 10px; }
      /* 1. Header — source pill on the left, ⌘↵ hint + close on the right. */
      .note-head { display: flex; align-items: center; gap: 6px; height: 22px; }
      .note .src {
        height: 22px; padding: 0 8px; margin-bottom: 0; min-width: 0; border-radius: 7px;
        background: var(--nb-surface-3); color: var(--nb-text-2); font-size: 11px;
      }
      .note .src svg { opacity: .8; }
      .note .src.linkable:hover { color: var(--pc-accent); background: var(--nb-surface-3); }
      .head-spacer { flex: 1; }
      .icon-x {
        all: unset; box-sizing: border-box; cursor: pointer; flex: none;
        width: 22px; height: 22px; border-radius: 7px; display: inline-flex;
        align-items: center; justify-content: center; color: var(--nb-muted); transition: background .12s, color .12s;
      }
      .icon-x:hover { background: var(--nb-surface-3); color: var(--nb-text); }
      .icon-x svg { width: 13px; height: 13px; }
      /* 2. Intent row label — the category selector sits inline after it. */
      .intent-label {
        flex: none; width: 46px; font-size: 10px; font-weight: 700; letter-spacing: .08em;
        text-transform: uppercase; color: var(--nb-muted);
      }
      /* 3. Command input — compact (~40px) until expanded. */
      .input-wrap {
        position: relative; background: var(--nb-surface-2);
        border: 1px solid var(--nb-border); border-radius: 10px; transition: border-color .12s, box-shadow .12s;
      }
      .input-wrap:focus-within { border-color: var(--pc-accent); box-shadow: 0 0 0 2px rgba(182,250,5,.08); }
      .note .input-wrap textarea {
        width: 100%; box-sizing: border-box; min-height: 42px; max-height: 76px; resize: none;
        background: transparent; color: var(--nb-text); border: 0; box-shadow: none;
        padding: 12px 46px 12px 12px; font: inherit; font-size: 13px; line-height: 18px;
      }
      .note .input-wrap textarea::placeholder { color: var(--nb-muted); }
      .note.expanded .input-wrap textarea { min-height: 92px; max-height: 140px; padding-top: 10px; padding-bottom: 10px; }
      .note .input-wrap textarea:focus { outline: none; border: 0; box-shadow: none; }
      /* Expand/collapse — a compact ghost icon button vertically centred on the
         input's right edge. Quiet at rest; firms up when the input or the button
         is hovered/focused, so it reads as an intentional action rather than a
         resize grip. The icon swaps with the expanded state. */
      .expand {
        all: unset; box-sizing: border-box; cursor: pointer; position: absolute; right: 8px; top: 50%;
        transform: translateY(-50%); width: 26px; height: 26px; border-radius: 7px;
        display: inline-flex; align-items: center; justify-content: center;
        background: transparent; border: 1px solid transparent; color: var(--nb-muted);
        opacity: .65; transition: background .12s, border-color .12s, color .12s, opacity .12s;
      }
      .input-wrap:hover .expand, .input-wrap:focus-within .expand { opacity: 1; }
      .expand:hover { background: var(--nb-surface-3); border-color: var(--nb-border); color: var(--nb-text); opacity: 1; }
      .expand:focus-visible {
        background: var(--nb-surface-3); border-color: rgba(182,250,5,.7);
        box-shadow: 0 0 0 2px rgba(182,250,5,.12); color: var(--nb-text); opacity: 1;
      }
      .expand svg { width: 13px; height: 13px; display: block; }
      .note.expanded .expand { top: 12px; transform: none; }
      .expand .ic-collapse { display: none; }
      .note.expanded .expand .ic-expand { display: none; }
      .note.expanded .expand .ic-collapse { display: block; }
      .src {
        display: inline-flex; align-items: center; gap: 6px; max-width: 100%; box-sizing: border-box;
        background: rgba(255,255,255,.05); border-radius: 7px; padding: 5px 8px; margin-bottom: 12px;
        font-family: ui-monospace, monospace; font-size: 11px; color: #aeb6c2;
      }
      .src svg { width: 13px; height: 13px; flex: none; opacity: .7; }
      .src .src-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .src.linkable { cursor: pointer; }
      .src.linkable:hover { color: var(--pc-accent); background: rgba(182,250,5,.1); }
      .panel textarea {
        width: 100%; box-sizing: border-box; min-height: 76px; resize: none;
        background: #11141a; color: #fff; border: 1px solid #2b313c; border-radius: 12px;
        padding: 9px 10px; font: inherit; font-size: 13px;
      }
      .panel textarea:focus { outline: none; border-color: var(--pc-accent); box-shadow: 0 0 0 3px rgba(182,250,5,.22); }
      /* 2. Intent row container — the change categories. Single source of truth
         for the active category; it drives the property row + value strip below.
         Stays one line (scrolls if cramped); a staged edit flags its tab. */
      .ctl-tabs { display: none; align-items: center; gap: 7px; height: 30px; flex-wrap: nowrap; overflow-x: auto; }
      .ctl-tabs.show { display: flex; }
      .ctl-tab {
        all: unset; box-sizing: border-box; cursor: pointer; position: relative; flex: none; white-space: nowrap;
        height: 30px; padding: 0 12px; border-radius: 9px; display: inline-flex; align-items: center;
        background: var(--nb-surface-3); border: 1px solid transparent;
        color: var(--nb-text); font-size: 12px; font-weight: 700; transition: background .12s, border-color .12s;
      }
      .ctl-tab[hidden] { display: none; }
      .ctl-tab:hover { background: #222b35; }
      .ctl-tab.active { background: rgba(182,250,5,.08); border-color: rgba(182,250,5,.75); }
      .ctl-tab.staged::after {
        content: ''; position: absolute; top: 4px; right: 6px; width: 5px; height: 5px;
        border-radius: 50%; background: var(--pc-accent);
      }
      /* 4. Contextual controls tray — progressive disclosure. Hidden until an
         intent chip opens it; wraps the active category's property row + value
         editor in one quiet surface so the resting bubble stays calm. */
      .ctl-tray {
        display: none; flex-direction: column; gap: 8px; box-sizing: border-box; padding: 8px;
        border-radius: 11px; background: var(--nb-surface-2); border: 1px solid #202A36;
      }
      .ctl-tray.show { display: flex; }
      /* Property row — the active category's properties (Padding/Margin/Gap,
         Fill/Text/Border, …) as content-sized chips, not a stretched bar. */
      .ctl-strip {
        display: inline-flex; align-self: flex-start; align-items: center; gap: 6px; width: fit-content;
        max-width: 100%; flex-wrap: nowrap; overflow-x: auto;
      }
      .sp-prop, .cl-prop, .ty-prop {
        all: unset; box-sizing: border-box; cursor: pointer; position: relative; flex: none;
        height: 28px; padding: 0 11px; border-radius: 8px;
        display: inline-flex; align-items: center; justify-content: center;
        background: var(--nb-surface); border: 1px solid var(--nb-border); color: var(--nb-text-2);
        font-size: 12px; font-weight: 650; transition: background .12s, color .12s, border-color .12s;
      }
      .sp-prop:hover, .cl-prop:hover, .ty-prop:hover { color: var(--nb-text); border-color: var(--nb-border-strong); }
      .sp-prop.active, .cl-prop.active, .ty-prop.active {
        background: rgba(182,250,5,.08); border-color: rgba(182,250,5,.65); color: var(--pc-accent);
      }
      /* 5. Contextual value editor — edits the selected property only. Shared
         shell across spacing/type (token · value · stepper · off-scale) and
         color (role · swatches). Hidden until a property is chosen. */
      .ctl-body { display: none; flex-direction: column; gap: 8px; }
      .ctl-body.show { display: flex; }
      .ctl-ctx {
        display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 12px; min-height: 38px;
        box-sizing: border-box; padding: 7px 8px; background: var(--nb-surface); border: 1px solid var(--nb-border); border-radius: 9px;
      }
      .ctl-ctx[hidden] { display: none; }
      .ctx-token { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
      .ctx-token .ctx-tok { font-size: 12px; font-weight: 750; color: var(--pc-accent); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
      .ctx-token .ctx-val { font-size: 12px; font-weight: 600; color: var(--nb-text-2); }
      .ctx-note { font-size: 11px; color: var(--nb-muted); white-space: nowrap; }
      .ctx-note.warn { color: var(--nb-warning); }
      .ctx-note:empty { display: none; }
      /* Numeric stepper (spacing + type) — −  value  +  in one bordered cell. */
      .sp-stepper, .ty-stepper {
        display: grid; grid-template-columns: 28px 40px 28px; height: 28px; flex: none;
        border: 1px solid var(--nb-border); border-radius: 7px; overflow: hidden;
      }
      .sp-step, .ty-step {
        all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center;
        justify-content: center; background: var(--nb-surface-3); color: var(--nb-text-2);
        font-size: 14px; line-height: 1; transition: background .12s;
      }
      .sp-step:hover, .ty-step:hover { background: #222b35; }
      .sp-num, .ty-num {
        display: flex; align-items: center; justify-content: center; background: var(--nb-bg);
        color: var(--nb-text); font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums;
      }
      /* Color strip (reuses the .ctl-ctx shell) — role label · primitive ramp. */
      .cl-role { font-size: 11px; color: var(--nb-text-2); min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .cl-role .cl-rname { color: var(--pc-accent); font-weight: 600; }
      .cl-role.none { color: var(--nb-warning); }
      .cl-ramp { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; grid-column: 2 / 4; justify-self: end; }
      .cl-swatch {
        all: unset; box-sizing: border-box; cursor: pointer; width: 18px; height: 18px; border-radius: 5px;
        border: 1px solid var(--nb-border); transition: transform .1s, box-shadow .1s;
      }
      .cl-swatch:hover { transform: scale(1.12); }
      .cl-swatch.active { border: 2px solid var(--pc-accent); }
      /* Copy / text control (text-leaf picks only) — the lone "Text" property,
         so it's just the edit field inside the value strip. */
      .copy-ctl .cp-label { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--nb-muted); }
      .cp-text {
        all: unset; box-sizing: border-box; width: 100%; padding: 10px 12px; border-radius: 10px;
        background: var(--nb-surface-2); border: 1px solid var(--nb-border); color: var(--nb-text); font-size: 13px;
        line-height: 1.4; resize: vertical; min-height: 40px;
      }
      .cp-text:focus { border-color: var(--pc-accent); box-shadow: 0 0 0 2px rgba(182,250,5,.12); }
      .pop-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
      .pop-head .src { margin-bottom: 0; min-width: 0; flex: 1; }
      .popover .comment { margin-bottom: 14px; }
      .actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 12px; }
      .act-right { display: flex; align-items: center; gap: 8px; margin-left: auto; }
      /* 6. Footer — no drag handle; a quiet comment (save-to-queue) and one
         bright, compact Send, both flush right. */
      .note-foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; height: 36px; }
      .foot-ghost {
        all: unset; box-sizing: border-box; cursor: pointer; flex: none;
        width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--nb-border); background: var(--nb-surface-3);
        color: var(--nb-text-2); display: inline-flex; align-items: center; justify-content: center;
        transition: background .12s, color .12s;
      }
      .foot-ghost:hover { background: #222b35; color: var(--nb-text); }
      .foot-ghost svg { width: 16px; height: 16px; }
      .foot-send {
        all: unset; box-sizing: border-box; cursor: pointer; flex: none; display: inline-flex;
        align-items: center; justify-content: center; gap: 7px; width: 88px; height: 36px; border-radius: 10px;
        background: var(--pc-accent); color: var(--pc-ink); font-size: 13px; font-weight: 800; transition: background .12s;
      }
      .foot-send:hover { background: var(--pc-accent-hover); }
      .foot-send svg { width: 14px; height: 14px; display: block; }
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
      /* A comment's pin pulses while the agent works on it — same cpulse the
         collapsed puck uses, so a glance at the pin or the circle reads "busy". */
      .bubble.thinking { animation: cpulse 1.1s ease-in-out infinite; }
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
      .composer-bar .add-trigger { margin-right: auto; } /* attach left; model pill + send float right */
      .composer-bar .dsend { margin-left: 0; }
      .agent-pick.sm .agent-trigger {
        height: 32px; border-radius: 9px; padding: 0 8px; gap: 6px; font-size: 12px;
        min-width: 0; max-width: 150px;
      }
      .agent-pick.sm .agent-icon, .agent-pick.sm .agent-chev { width: 14px; height: 14px; }
      .agent-pick.right .agent-menu { left: auto; right: 0; }
      /* Settings (gear) menu — a native-style context menu that pops above the
         bar; the "Default model" row opens a flyout submenu listing every model
         (grouped per agent by a horizontal divider label, not nested), then the
         destructive "Delete all comments" action. */
      .gear-pick { position: relative; display: inline-flex; flex: none; }
      .gear-menu {
        position: absolute; right: 0; bottom: calc(100% + 8px); display: none; flex-direction: column; gap: 2px;
        min-width: 230px; z-index: 6; background: #1b1d21; border: 1px solid #2b313c; border-radius: 12px;
        padding: 6px; box-shadow: 0 16px 44px rgba(0,0,0,.55);
      }
      .gear-menu.open { display: flex; }
      .gear-sep { height: 1px; background: rgba(255,255,255,.08); margin: 4px 2px; }
      .gear-item {
        all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px;
        padding: 9px 10px; border-radius: 8px; color: #e7e9ee; font-size: 13px;
      }
      .gear-item:hover { background: #2a2c30; }
      .gear-item > svg:first-child { width: 16px; height: 16px; flex: none; opacity: .8; }
      .gear-item.danger { color: #ff8d8d; }
      .gear-item.danger:hover { background: rgba(255,90,90,.12); }
      .gear-item-label { flex: 1; white-space: nowrap; }
      .gear-model-val {
        color: #8b93a1; font-size: 12px; white-space: nowrap;
        max-width: 110px; overflow: hidden; text-overflow: ellipsis;
      }
      .gear-chev { width: 15px; height: 15px; flex: none; opacity: .55; margin-right: -2px; }
      /* Flyout submenu — opens to the RIGHT by default; .flip-left swaps it to
         the left when the bar sits too near the viewport's right edge (decided
         in JS when the gear menu opens). A transparent bridge (::after) spans
         the gap on the flyout's near side so the pointer keeps :hover while
         crossing from the row to the flyout. */
      .gear-sub { position: relative; }
      .gear-flyout {
        position: absolute; left: calc(100% + 6px); top: -6px; display: none; flex-direction: column; gap: 1px;
        min-width: 168px; max-height: 320px; overflow-y: auto; z-index: 7;
        background: #1b1d21; border: 1px solid #2b313c; border-radius: 12px;
        padding: 6px; box-shadow: 0 16px 44px rgba(0,0,0,.55);
      }
      .gear-flyout::after { content: ''; position: absolute; top: 0; bottom: 0; left: -6px; width: 6px; }
      .gear-sub.flip-left > .gear-flyout { left: auto; right: calc(100% + 6px); }
      .gear-sub.flip-left > .gear-flyout::after { left: auto; right: -6px; }
      .gear-sub:hover > .gear-flyout { display: flex; }
      .gear-sub:hover > .gear-item { background: #2a2c30; }
      /* Group header: agent name flanked by inline divider lines (no nesting). */
      .gear-group-label {
        display: flex; align-items: center; gap: 8px;
        font-size: 12px; color: #8b93a1; text-transform: capitalize; user-select: none;
        margin: 2px 0; padding: 6px 3px;
      }
      .gear-group-label::before { content: ''; flex: none; width: 14px; height: 1px; background: rgba(255,255,255,.08); }
      .gear-group-label::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,.08); }
      .gear-opt {
        all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 8px;
        padding: 8px 9px; border-radius: 8px; color: #e7e9ee; font-size: 13px; white-space: nowrap;
      }
      .gear-opt:hover { background: #2a2c30; }
      .gear-opt-check { width: 14px; height: 14px; flex: none; opacity: 0; }
      .gear-opt.sel { color: var(--pc-accent); }
      .gear-opt.sel .gear-opt-check { opacity: 1; }
      .gear-opt-label { flex: 1; }
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
      .evt.text { color: #cfd5df; }
      .evt .msg { min-width: 0; }
      .evt.text .msg { display: block; }
      .evt.text code { overflow-wrap: anywhere; }
      .evt.text .msg > :first-child { margin-top: 0; }
      .evt.text .msg > :last-child { margin-bottom: 0; }
      .evt.text p { margin: 0 0 8px; }
      .evt.text h1, .evt.text h2, .evt.text h3, .evt.text h4, .evt.text h5, .evt.text h6 {
        margin: 12px 0 6px; font-size: 13px; font-weight: 700; color: #e7e9ee;
      }
      .evt.text strong { color: #fff; font-weight: 600; }
      .evt.text em { font-style: italic; }
      .evt.text code {
        font-family: ui-monospace, monospace; font-size: 12px; background: #2a2c30;
        padding: 1px 4px; border-radius: 4px; color: #d7c3a0;
      }
      .evt.text pre {
        margin: 0 0 8px; background: #16181c; border: 1px solid #2a2c30; border-radius: 6px;
        padding: 8px 10px; overflow-x: auto;
      }
      .evt.text pre code { background: none; padding: 0; border-radius: 0; color: #cfd5df; white-space: pre; }
      .evt.text ul { margin: 0 0 8px; padding-left: 18px; list-style: disc; }
      .evt.text li { margin: 2px 0; }
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
        <div class="note-head">
          <div class="src">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
            <span class="src-name"></span>
          </div>
          <span class="head-spacer"></span>
          <button class="icon-x" data-act="note-close" title="Close" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="ctl-tabs">
          <span class="intent-label">Intent</span>
          <button class="ctl-tab" data-group="spacing" aria-expanded="false">Spacing</button>
          <button class="ctl-tab" data-group="color" aria-expanded="false">Color</button>
          <button class="ctl-tab" data-group="type" aria-expanded="false">Type</button>
          <button class="ctl-tab" data-group="copy" aria-expanded="false" hidden>Copy</button>
        </div>
        <div class="input-wrap">
          <textarea rows="1" placeholder="Describe the change…  (⌘/Ctrl+Enter to save)"></textarea>
          <button class="expand" data-act="expand" type="button" title="Expand" aria-label="Expand prompt input">
            <svg class="ic-expand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
            <svg class="ic-collapse" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10 21 3M3 21l7-7"/></svg>
          </button>
        </div>
        <div class="ctl-tray">
        <div class="spacing-ctl ctl-body">
          <div class="sp-props ctl-strip">
            <button class="sp-prop" data-prop="padding">Padding</button>
            <button class="sp-prop" data-prop="margin">Margin</button>
            <button class="sp-prop" data-prop="gap">Gap</button>
          </div>
          <div class="ctl-ctx sp-ctx" hidden>
            <div class="ctx-token sp-readout"></div>
            <div class="sp-stepper">
              <button class="sp-step" data-act="sp-dec" title="Smaller">−</button>
              <span class="sp-num"></span>
              <button class="sp-step" data-act="sp-inc" title="Larger">+</button>
            </div>
            <div class="ctx-note sp-warn"></div>
          </div>
        </div>
        <div class="color-ctl ctl-body">
          <div class="cl-props ctl-strip">
            <button class="cl-prop" data-cprop="background-color">Fill</button>
            <button class="cl-prop" data-cprop="color">Text</button>
            <button class="cl-prop" data-cprop="border-color">Border</button>
          </div>
          <div class="ctl-ctx cl-panel" hidden>
            <span class="cl-role"></span>
            <div class="cl-ramp"></div>
          </div>
        </div>
        <div class="type-ctl ctl-body">
          <div class="ty-props ctl-strip">
            <button class="ty-prop" data-tprop="font-size">Size</button>
            <button class="ty-prop" data-tprop="font-weight">Weight</button>
            <button class="ty-prop" data-tprop="line-height">Line height</button>
          </div>
          <div class="ctl-ctx ty-ctx" hidden>
            <div class="ctx-token ty-readout"></div>
            <div class="ty-stepper">
              <button class="ty-step" data-act="ty-dec" title="Smaller">−</button>
              <span class="ty-num"></span>
              <button class="ty-step" data-act="ty-inc" title="Larger">+</button>
            </div>
            <div class="ctx-note ty-warn"></div>
          </div>
        </div>
        <div class="copy-ctl ctl-body">
          <div class="cp-label">New copy</div>
          <textarea class="cp-text" rows="2" placeholder="Edit the copy…"></textarea>
        </div>
        </div>
        <div class="note-foot">
          <button class="foot-ghost" data-act="save" type="button" title="Add comment" aria-label="Add comment">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </button>
          <button class="foot-send" data-act="send-agent" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>
            <span>Send</span>
          </button>
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
        <div class="actions">
          <button class="act danger" data-act="delete" data-tip="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
          <div class="act-right">
            <button class="act" data-act="edit" data-tip="Edit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button class="act primary" data-act="send-agent" data-tip="Send to agent">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>
            </button>
          </div>
        </div>
      </div>

      <aside class="drawer">
        <div class="drawer-head">
          <button class="dback" data-act="comments-back" title="Back to chat" aria-label="Back to chat">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <span class="brand dbrand" title="Pointcut">${SPARK_ICON}<span class="brand-name">Pointcut</span></span>
          <span class="dhead-title">Comments</span>
          <span class="dcount"></span>
          <span class="dhead-spacer"></span>
          <button class="dbubble" data-act="open-comments" title="Comments" aria-label="Comments">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg>
            <span class="dbubble-badge">0</span>
          </button>
          <button class="dclose" data-act="drawer-close" title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="drawer-actions">
          <span class="sel-info"></span>
          <button class="actbtn" data-act="add-note">Add note</button>
          <button class="send-claude" data-act="comments-send" title="Send to agent">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>
            <span>Send to agent</span>
          </button>
        </div>
        <div class="add-note-box">
          <textarea class="mini-input" placeholder="How should the agent apply these? (optional)"></textarea>
        </div>
        <div class="drawer-list"></div>
        <div class="drawer-stream"></div>
        <div class="chat-pane">
          <div class="chat-head">
            <span class="chat-title untitled" title="">New chat</span>
            <div class="chat-head-actions">
              <button class="chat-icon-btn" data-act="chat-new" title="Start a new chat" aria-label="Start a new chat">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
              </button>
              <div class="chat-hist-wrap">
                <button class="chat-icon-btn chat-hist-btn" data-act="chat-history-toggle" title="Previous chats" aria-label="Previous chats" aria-expanded="false">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>
                </button>
                <div class="chat-hist-menu"></div>
              </div>
            </div>
          </div>
          <div class="chat-stream"></div>
          <div class="chat-composer">
            <span class="cstatus"><span class="cstat-logo">${AGENT_ICON}</span><span class="cstat-text"></span></span>
            <div class="composer-box">
              <div class="chat-chips"></div>
              <div class="composer-input">
                <span class="composer-spark" aria-hidden="true">${SPARK_ICON}</span>
                <textarea placeholder="Ask about this page…"></textarea>
                <div class="skill-menu" role="listbox" aria-label="Project skills"></div>
              </div>
              <button class="mode-hint discuss" data-act="chat-mode" type="button" title="Cycle agent mode (Shift+Tab)" aria-label="Cycle agent mode">
                <span class="mode-caret" aria-hidden="true">⏵⏵</span>
                <span class="mode-name">discuss mode</span>
                <span class="mode-cycle">(shift+tab to cycle)</span>
              </button>
              <div class="composer-bar">
                <button class="add-trigger" data-act="chat-pick" title="Attach an element on the page as context" aria-label="Attach element" aria-pressed="false">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><circle cx="12" cy="12" r="2.5"/></svg>
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
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
                </button>
              </div>
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
          <span class="lbl">Pick</span><span class="kbd">${KBD("S")}</span>
        </button>
        <button class="icon-btn" data-act="comments" data-tip="Toggle comments  ${KBD("C")}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg>
          <span class="cbadge">0</span>
        </button>
        <div class="gear-pick">
          <button class="icon-btn" data-act="gear-toggle" data-tip="Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <div class="gear-menu">
            <div class="gear-sub">
              <button class="gear-item" data-act="model-sub" aria-haspopup="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>
                <span class="gear-item-label">Default model</span>
                <span class="gear-model-val"></span>
                <svg class="gear-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
              </button>
              <div class="gear-flyout gear-model-menu"></div>
            </div>
            <div class="gear-sep"></div>
            <button class="gear-item danger" data-act="clear">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>
              <span>Delete all comments</span>
            </button>
          </div>
        </div>
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
  const commentsBtn = $('.bar [data-act="comments"]');
  const grip = $('.bar .grip');
  const puck = $('.bar .puck');
  const pickBtn = $('.bar [data-act="pick"]');
  const countBadge = $('.cbadge');
  const gearWrap = $('.bar .gear-pick');
  const gearMenu = $('.bar .gear-menu');
  const drawer = $('.drawer');
  const drawerList = $('.drawer-list');
  const drawerCount = $('.drawer-head .dcount');
  const stream = $('.drawer-stream');
  const drawerBubbleBadge = $('.drawer-head .dbubble-badge');
  const cpanel = $('.cpanel');
  const cpanelLog = $('.cpanel .clog');
  // Each surface is independent: a run streams into the chat transcript OR the
  // floating panel, never both. `surface` ({ log, status }) is set per run to
  // the chosen one, so cLog/setStatus write only there.
  const panelStatus = $('.cpanel .cstatus');
  // Chat tab (0010): its own transcript surface + composer.
  const chatStream = $('.chat-stream');
  const chatText = $('.chat-composer textarea');
  const chatSend = $('.chat-composer [data-act="chat-send"]');
  const chatStatus = $('.chat-composer .cstatus');
  const chatModeHint = $('.chat-composer [data-act="chat-mode"]');
  const chatPickBtn = $('.chat-composer [data-act="chat-pick"]');
  const chatChips = $('.chat-composer .chat-chips');
  const chatSkillMenu = $('.chat-composer .skill-menu');
  const chatTitle = $('.chat-head .chat-title');
  // Chat history — "New chat" + a dropdown listing previous conversations.
  const chatHistWrap = $('.chat-head .chat-hist-wrap');
  const chatHistBtn = $('.chat-head [data-act="chat-history-toggle"]');
  const chatHistMenu = $('.chat-head .chat-hist-menu');
  const closeChatHistory = () => {
    chatHistMenu.classList.remove('open');
    chatHistBtn.classList.remove('open');
    chatHistBtn.setAttribute('aria-expanded', 'false');
  };
  let surface = null;
  // The selected coding Agent + model (picker value) and the list the bridge says
  // are installed (each { name, models:[{label,value}] }). selectedAgent gates
  // Send; the picker is the only place an agent name shows.
  let selectedAgent = null;
  let selectedModel = '';
  let availableAgents = [];
  // Skills/commands the chosen agent can invoke at the project root (the "/" menu).
  // Fetched per agent from the Bridge's skills-probe; cached client-side by agent.
  let availableSkills = [];
  const skillsByAgent = Object.create(null);
  // Comments-tab top action bar (replaces the old foot composer).
  const drawerActions = $('.drawer-actions');
  const selInfo = $('.drawer-actions .sel-info');
  const commentsSend = $('.drawer-actions [data-act="comments-send"]');
  const addNoteBtn = $('.drawer-actions [data-act="add-note"]');
  const addNoteBox = $('.add-note-box');
  const addNoteText = $('.add-note-box textarea');

  const note = $('.note');
  const noteSrc = note.querySelector('.src');
  const noteText = note.querySelector('textarea');
  const spacingCtl = note.querySelector('.spacing-ctl');
  const spacingStrip = note.querySelector('.spacing-ctl .ctl-ctx'); // value strip, hidden until a prop is picked
  const spacingReadout = note.querySelector('.sp-readout'); // left cell: token + value
  const spacingNum = note.querySelector('.sp-num'); // stepper centre cell
  const spacingWarn = note.querySelector('.sp-warn'); // off-scale note
  const colorCtl = note.querySelector('.color-ctl');
  const colorPanel = note.querySelector('.cl-panel');
  const colorRole = note.querySelector('.cl-role');
  const colorRampEl = note.querySelector('.cl-ramp');
  const typeCtl = note.querySelector('.type-ctl');
  const typeStrip = note.querySelector('.type-ctl .ctl-ctx');
  const typeReadout = note.querySelector('.ty-readout');
  const typeNum = note.querySelector('.ty-num');
  const typeWarn = note.querySelector('.ty-warn');
  const copyCtl = note.querySelector('.copy-ctl');
  const copyText = note.querySelector('.cp-text');
  const ctlTabs = note.querySelector('.ctl-tabs');
  const ctlTray = note.querySelector('.ctl-tray'); // contextual controls; shown only when controlsOpen

  const popover = $('.popover');
  const popSrc = popover.querySelector('.src');
  const popBody = popover.querySelector('.body');

  let picking = false;
  // What a pick does on click: 'comment' (open a note — the toolbar Pick) or
  // 'chat' (attach the element to the chat draft — the composer's Select button).
  let pickMode = 'comment';
  let agentRunning = false;
  let agentErrored = false;
  // Active drawer view ('chat' | 'comments'). Chat is home; the header's
  // comments bubble opens Comments, whose back arrow returns here.
  let activeTab = 'chat';
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (t === 'comments' || t === 'chat') activeTab = t;
  } catch (_) {}
  let agentStartAt = 0; // run start timestamp, for the "Brewed for …" elapsed time
  let openTextMsg = null; // the .msg node currently accumulating streamed prose deltas
  let openTextBuf = ''; // its accumulated text so far
  let sentIds = []; // ids dispatched in the current panel run — removed on success
  let workingIds = []; // pins currently pulsing (the comments the agent is working on)
  let dismissTimer = null; // post-run timer: auto-closes the panel + re-expands the bar
  let selectedIds = []; // comments checked in the Comments tab (default none); drives the action bar
  let pendingResolveIds = []; // comments handed to Chat via "Send to agent" — deleted on success
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
  // Which intent (control group) is currently active — always one for an
  // element pick (null for regions/edits). Switching only toggles visibility,
  // so each intent keeps its last-selected property. Reset on each openNote.
  let activeGroup = null;
  // Progressive disclosure: the contextual controls tray (property row + value
  // editor) only renders when this is true. The bubble opens collapsed; an
  // intent chip opens the tray, and re-clicking the active intent closes it.
  let controlsOpen = false;
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

  // Coarse relative timestamp for a comment ("just now", "21h ago"). Comments
  // predating the createdAt field (legacy records) show no time.
  const relTime = (ts) => {
    if (!ts) return '';
    const s = Math.round((Date.now() - ts) / 1000);
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

  const refreshCount = () => {
    const n = Q.count();
    countBadge.textContent = String(n);
    countBadge.classList.toggle('show', n > 0);
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
      // Keep the pulse if this pin is mid-run (a re-render during the agent turn
      // would otherwise drop it).
      if (agentRunning && workingIds.includes(a.id)) b.classList.add('thinking');
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
      `<span class="ctx-tok">${c.token}</span><span class="ctx-val">${c.value}</span>`;
    spacingNum.textContent = c.value;
    spacingWarn.textContent = c.offScale ? 'off-scale' : '';
    spacingWarn.classList.toggle('warn', !!c.offScale);
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
    spacingStrip.hidden = true;
    spacingReadout.innerHTML = '';
    spacingNum.textContent = '';
    spacingWarn.textContent = '';
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
    spacingStrip.hidden = false;
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
      colorRole.textContent = '⚠ No semantic role — may need one';
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
      `<span class="ctx-tok">${c.token}</span><span class="ctx-val">${c.value}</span>`;
    typeNum.textContent = c.value;
    typeWarn.textContent = c.offScale ? 'off-scale' : '';
    typeWarn.classList.toggle('warn', !!c.offScale);
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
    typeStrip.hidden = true;
    typeReadout.innerHTML = '';
    typeNum.textContent = '';
    typeWarn.textContent = '';
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
    typeStrip.hidden = false;
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

  // ---- Control group tabs --------------------------------------------------
  // The note box surfaces one change category at a time: clicking a tab opens
  // that group's controls and collapses the others. Each group's staged session
  // (spacing/color/type/copy) survives regardless of which body is visible, so
  // a note can carry edits from several groups. A group holding a staged edit
  // flags its tab with an accent dot.
  const CTL_BODIES = { spacing: spacingCtl, color: colorCtl, type: typeCtl, copy: copyCtl };

  const groupStaged = (g) =>
    g === 'spacing' ? !!spacing
      : g === 'color' ? !!color
        : g === 'type' ? !!type
          : !!(copy && copyText.value !== copy.before);

  const refreshCtlTabs = () => {
    ctlTabs.querySelectorAll('.ctl-tab').forEach((t) => {
      const active = activeGroup === t.dataset.group;
      // Accent the chip only while its tray is open — a collapsed bubble shows
      // no highlighted intent, so it reads calm rather than mid-edit.
      t.classList.toggle('active', active && controlsOpen);
      t.classList.toggle('staged', groupStaged(t.dataset.group));
      t.setAttribute('aria-expanded', active && controlsOpen ? 'true' : 'false');
    });
  };

  // Reflect activeGroup/controlsOpen onto the DOM: the tray shows only when
  // open, and within it only the active intent's body. Staged sessions are
  // untouched — only visibility changes, so each intent keeps its last-selected
  // property when you switch away and back.
  const syncControls = () => {
    ctlTray.classList.toggle('show', controlsOpen && !!activeGroup);
    Object.entries(CTL_BODIES).forEach(([k, body]) =>
      body.classList.toggle('show', activeGroup === k),
    );
    refreshCtlTabs();
  };

  // Clicking an intent chip selects it and opens the tray; re-clicking the
  // already-active intent toggles the tray shut (and back open). This is the
  // sole driver of controlsOpen, so the resting bubble stays collapsed.
  const selectGroup = (g) => {
    if (g === activeGroup) controlsOpen = !controlsOpen;
    else { activeGroup = g; controlsOpen = true; }
    syncControls();
  };

  const openNote = (pendingState, anchorRect, prefill) => {
    pending = pendingState;
    selectedType = (prefill && prefill.type) || TYPES[0].id;
    noteText.value = (prefill && prefill.comment) || '';
    fillSrc(noteSrc, prefill ? prefill.loc : (pendingState.el ? pendingState.el.getAttribute(LOC_ATTR) : ''));
    // Spacing control only applies to a fresh element pick (a live node to read
    // and preview against) — not regions or edits of an existing comment.
    resetSpacing();
    resetColor();
    resetType();
    resetCopy();
    // Controls apply only to a live element pick. Start collapsed: the tabs row
    // offers the change categories and each group's body discloses on demand,
    // so the resting panel stays calm instead of stacking three chip rows.
    const textLeaf = !!pendingState.el && isTextLeaf(pendingState.el);
    if (textLeaf) armCopy(pendingState.el);
    const hasEl = !!pendingState.el;
    ctlTabs.classList.toggle('show', hasEl);
    ctlTabs.querySelector('.ctl-tab[data-group="copy"]').hidden = !textLeaf;
    // An element pick rests on a default intent (spacing) but starts collapsed:
    // the tray (property row + value editor) stays hidden until a chip opens it,
    // so the bubble opens calm. Regions/edits show no controls at all.
    activeGroup = hasEl ? 'spacing' : null;
    controlsOpen = false;
    syncControls();
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
    note.classList.remove('expanded');
    const expandBtn = note.querySelector('.expand');
    expandBtn.setAttribute('aria-label', 'Expand prompt input');
    expandBtn.setAttribute('title', 'Expand');
    controlsOpen = false;
    ctlTray.classList.remove('show');
    pending = null;
  };

  // Commit the note (from the current `pending` state + fields) to the queue.
  // Returns the committed annotation's id, or null if the comment is blank.
  // Shared by the "Add comment" (Save) and "Send to Claude" buttons.
  const commitNote = () => {
    const comment = noteText.value.trim();
    if (!comment) {
      noteText.focus();
      return null;
    }
    if (pending && pending.editId) {
      const a = Q.get(pending.editId);
      if (a) {
        a.comment = comment;
        a.type = selectedType;
      }
      Q.persist();
      renderBubbles();
      if (drawerOpen) renderDrawer();
      return pending.editId;
    }
    const id = Q.newId();
    const a = {
      id, type: selectedType, comment,
      author: 'You', createdAt: Date.now(), replies: [],
      loc: '', path: null, label: '', outerHTML: '', styles: {}, region: null,
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
    } else if (pending && pending.region) {
      a.region = pending.region;
      a.label = `region ${Math.round(pending.region.w)}×${Math.round(pending.region.h)}`;
    }
    Q.add(a);
    refreshCount();
    renderBubbles();
    return id;
  };

  const saveNote = () => {
    if (commitNote()) closeNote(); // stays in Pick mode for the next element
  };

  // Send the just-written comment straight to Claude instead of leaving it in
  // the queue: commit it, then run on that one comment. On success the run's
  // removeSent() drops it from the queue.
  const sendNote = () => {
    const id = commitNote();
    if (!id) return;
    closeNote();
    runAgent({ annotations: [Q.get(id)].filter(Boolean), note: '', surface: 'panel' });
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
    popSide = placeBeside(popover, bubble ? bubble.getBoundingClientRect() : r, 'right', popSide);
  };

  const openPopover = (id) => {
    const a = Q.get(id);
    if (!a) return;
    openPopId = id;
    popSide = null; // recompute the side fresh for this open
    fillSrc(popSrc, a.loc);
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
  const toMarkdown = () => buildHandoff(Q.all(), numberOf, TYPES);
  const toMarkdownFor = (annos) => buildHandoff(annos, numberOf, TYPES);

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
  // POST the markdown handoff to the dev-server Bridge, which
  // runs the selected agent's CLI, normalizes its events into Actions, and streams
  // them back as a uniform NDJSON protocol. The agent edits the source; HMR swaps
  // it in. The client stays agent-agnostic — it only consumes Actions.
  const escHtml = (s) =>
    String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // Agent-output markdown → HTML lives in models/markdown.mjs (renderMarkdown).
  // It HTML-escapes untrusted agent text first, so markup can never be injected.
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
      openTextMsg.innerHTML = renderMarkdown(openTextBuf);
    } else {
      openTextMsg.innerHTML = renderMarkdown(text); // authoritative full text
      closeTextRow();
    }
    box.scrollTop = box.scrollHeight;
  };
  // Comments-tab top action bar: checking comments selects them; the bar appears
  // only once something is selected, and its count drives "Send to agent".
  const updateCommentsActions = () => {
    selectedIds = selectedIds.filter((id) => Q.get(id)); // drop deleted comments
    const n = selectedIds.length;
    drawerActions.classList.toggle('show', n > 0);
    if (!n) addNoteBox.classList.remove('open'); // nothing selected → no note input
    selInfo.textContent = `${n} selected`;
    commentsSend.disabled = agentRunning || !selectedAgent || n === 0;
  };

  // Drop the comments dispatched in the just-finished panel run (success only).
  const removeSent = () => {
    if (!sentIds.length) return;
    const ids = new Set(sentIds);
    Q.removeMany(ids);
    ids.forEach((id) => locator.forget(id));
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
    bar.classList.add('thinking'); // pulses the puck while collapsed (CSS-gated on .collapsed)
    setStatus('run', nextWord());
    wordTimer = setInterval(() => setStatus('run', nextWord()), 2800);
  };
  const stopThinking = (errored) => {
    bar.classList.remove('thinking');
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

  // Render one normalized Action (from agent-run.mjs) into the floating panel.
  // The panel is wiped on each send (see runAgent), so it always shows just the
  // current comment's run — no transcript persistence, no cross-send resume.
  const renderAction = (a) => {
    if (a.kind === 'text') {
      streamText(a.text, a.delta);
      return;
    }
    closeTextRow(); // any non-text event ends the current streamed line
    if (a.kind === 'tool') {
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

  // Pulse the on-page pins for the comments in the current run, so each
  // annotated spot flashes while the agent works on it — whether the run goes
  // to the floating panel (sentIds) or the Chat drawer (pendingResolveIds).
  // `ids` arms the pulse; passing none stops it.
  const markThinkingBubbles = (ids) => {
    workingIds = ids || [];
    bubblesWrap.querySelectorAll('.bubble').forEach((b) => {
      b.classList.toggle('thinking', workingIds.includes(b.dataset.id));
    });
  };

  // Tear down the post-run UI: hide the floating feed, re-expand the toolbar
  // from its brand circle, and disarm any element picker. Used by the auto-
  // dismiss timer and whenever the panel is closed by hand.
  const cancelDismiss = () => { if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; } };
  const dismissPanel = () => {
    cancelDismiss();
    cpanel.classList.remove('open');
    if (bar.classList.contains('collapsed')) expandBar();
    if (picking) setPicking(false);
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
    markThinkingBubbles(); // stop the pin pulse (surviving pins on error / not-yet-removed)
    updateCommentsActions();
    // The comments run is done: let the user read the result for a beat, then
    // clear the panel and restore the full toolbar. A new send (which cancels
    // this) or a clean reload after an applied edit pre-empts it. Errors stay
    // up so the failure is readable.
    cancelDismiss();
    if (!agentErrored) {
      cLog('ctx', '✕', 'This panel will close automatically in 3s…');
      dismissTimer = setTimeout(dismissPanel, 3000);
    }
  };

  // Run a turn: dispatch the chosen comments (+ optional typed note) to the
  // bridge (agent-run.mjs) and stream the reply into the floating panel. Each
  // send is an independent one-shot (no resume) shown in a freshly wiped feed.
  const runAgent = ({ annotations, note }) => {
    if (agentRunning || !selectedAgent) return;
    const anns = annotations || [];
    const text = (note || '').trim();
    if (!anns.length && !text) return;

    cancelDismiss(); // a new send pre-empts a pending auto-dismiss
    agentRunning = true;
    agentErrored = false;
    closeTextRow(); // fresh run — don't append onto a prior run's last line
    commentsSend.disabled = true;
    // Single-comment / whole-queue sends from the bar + bubbles stream into the
    // floating panel. (The Comments tab's "Send to agent" routes to Chat instead.)
    surface = { log: cpanelLog, status: panelStatus };
    // Each send is its own one-shot: wipe the feed so the bubble shows only this
    // comment's run, never a stale stack from an earlier comment (which a later
    // visit to the tool would otherwise resurface).
    cpanelLog.innerHTML = '';
    panelStatus.classList.remove('show', 'running', 'err');
    closeTextRow();
    // Collapse the toolbar to its brand circle and float the feed above it: the
    // puck pulses (startThinking adds .thinking) while the agent works and the
    // chat reads as hovering over the circle, matching the send-to-agent intent.
    if (!bar.classList.contains('collapsed')) collapseBar();
    cpanel.classList.add('open');
    positionCpanel();
    agentStartAt = Date.now();
    startThinking();
    sentIds = anns.map((a) => a.id);
    markThinkingBubbles(sentIds); // flash the pins for the comments in this run

    const parts = [];
    if (anns.length) parts.push(toMarkdownFor(anns));
    if (text) parts.push('## Additional instruction\n' + text);
    const markdown = parts.join('\n\n');

    // Echo the user's turn into the (freshly cleared) transcript.
    const cn = anns.length ? `${anns.length} comment${anns.length > 1 ? 's' : ''}` : '';
    cLog('you', '›', escHtml([cn, text && `“${text}”`].filter(Boolean).join(' + ')));

    streamAgentRun(
      { agent: selectedAgent, model: selectedModel, markdown, resume: null },
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

  // ---- Chat tab (0010) -----------------------------------------------------
  // A continuous discuss session, separate from the Comments-tab runs above:
  // its own session id (chat.sessionId()), its own transcript, and a sticky
  // posture (chat.mode()) cycled discuss⇄apply with Shift+Tab or the mode line.
  // Reuses the shared run gate (agentRunning) and stream primitives, so a chat
  // turn and a comments run can never interleave on the shared streaming state.
  const chatStateUpdate = () => {
    const hasText = chatText.value.trim().length > 0;
    const hasChips = chat.chips().length > 0;
    chatSend.disabled = agentRunning || !selectedAgent || (!hasText && !hasChips);
    const apply = chat.mode() === 'apply';
    chatModeHint.classList.toggle('apply', apply);
    chatModeHint.classList.toggle('discuss', !apply);
    chatModeHint.querySelector('.mode-name').textContent = apply ? 'apply mode' : 'discuss mode';
  };
  // One chip per element attached to the current chat draft (0011). Numbered to
  // match the element references the turn's markdown cites.
  const renderChatChips = () => {
    chatChips.innerHTML = '';
    chat.chips().forEach((c, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.dataset.chip = c.id;
      chip.title = `${c.loc || 'source unknown'} — ${c.label}`;
      // Show the source reference (e.g. App.vue:25:7) — that's what the turn cites
      // and sends to the agent. Fall back to the element label when unstamped.
      const ref = c.loc ? c.loc.split('/').pop() : '';
      chip.innerHTML =
        (ref
          ? `<svg class="chip-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">` +
            `<path d="M9 1.75H4.5A1.5 1.5 0 0 0 3 3.25v9.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.75Z"/>` +
            `<path d="M9 1.75V5.75H13"/></svg>`
          : `<span class="chip-num">${i + 1}</span>`) +
        `<span class="chip-lbl">${escHtml(ref || c.label)}</span>` +
        `<button class="chip-x" data-act="chat-chip-remove" title="Remove">×</button>`;
      chatChips.appendChild(chip);
    });
  };
  // Pick-to-attach (from the chat composer's Select button): add the picked
  // element to the chat draft as a read-only context chip. Reuses the locator +
  // style provenance (0002) — color is the most telling Spark/scoped/shared signal.
  const attachChatChip = (el) => {
    const prov = provenance.inspect(el, 'color');
    chat.addChip({
      loc: el.getAttribute(LOC_ATTR) || '',
      label: labelFor(el),
      tag: el.tagName.toLowerCase(),
      classList: Array.from(el.classList || []),
      provenance: { selector: prov.selector, sourceKind: prov.sourceKind, value: prov.value },
    });
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
  // chat model (the chat thread persists; the floating panel does not),
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
    markThinkingBubbles(); // stop the pin pulse (resolved pins drop below; a failed run keeps them un-pulsed)
    // A successful comments→chat send resolves those comments: drop them from the
    // queue, clear the selection + note. A failed run keeps them for a retry.
    if (pendingResolveIds.length) {
      if (!agentErrored) {
        const ids = new Set(pendingResolveIds);
        Q.removeMany(ids);
        ids.forEach((id) => locator.forget(id));
        selectedIds = selectedIds.filter((id) => !ids.has(id));
        addNoteText.value = '';
        addNoteBox.classList.remove('open');
        refreshCount();
        renderBubbles();
        closePopover();
      }
      pendingResolveIds = [];
    }
    renderChatHead(); // a first message gives the thread a fallback title now
    // Once a turn lands cleanly, name the thread from its context (once) — the
    // agent-generated title then replaces the first-message fallback.
    if (!agentErrored && !chat.hasTitle() && chat.entries().some((e) => e.k === 'you')) requestTitle();
    chatStateUpdate();
    updateCommentsActions();
  };
  // Ask the agent for a short title for the current thread. A self-contained
  // one-shot (no resume) that feeds the transcript as context, so it never
  // touches the live session or collides with a follow-up turn. Runs in the
  // background — failure just leaves the first-message fallback in place.
  let titleRunning = false;
  const cleanTitle = (s) => {
    let t = String(s || '').trim().split('\n')[0].trim();
    t = t.replace(/^["'`*\s]+|["'`*\s]+$/g, '').replace(/[.,;:!?]+$/, '').replace(/\s+/g, ' ').trim();
    return t.length > 48 ? t.slice(0, 48) + '…' : t;
  };
  const requestTitle = () => {
    if (titleRunning || !selectedAgent) return;
    const cid = chat.currentId();
    const convo = chat
      .entries()
      .filter((e) => (e.k === 'you' || e.k === 'text') && e.text)
      .map((e) => (e.k === 'you' ? 'User: ' : 'Assistant: ') + e.text)
      .join('\n')
      .slice(0, 4000);
    if (!convo) return;
    titleRunning = true;
    let buf = '';
    const finishTitle = () => {
      if (!titleRunning) return;
      titleRunning = false;
      const title = cleanTitle(buf);
      if (!title) return;
      chat.setTitle(cid, title);
      if (chat.currentId() === cid) renderChatHead(); // still the open thread
      renderChatHistory();
    };
    streamAgentRun(
      {
        agent: selectedAgent,
        model: selectedModel,
        markdown:
          'Reply with ONLY a short title (3–6 words, no quotes, no trailing punctuation) ' +
          'that summarizes the conversation below. Output just the title text — nothing else.\n\n' +
          convo,
        resume: null,
        mode: 'discuss',
      },
      {
        onAction: (a) => { if (a.kind === 'text') buf = a.delta ? buf + a.text : a.text; },
        onBridgeError: () => {},
        onBridgeEnd: finishTitle,
        onStreamEnd: finishTitle,
        onError: () => { titleRunning = false; },
      },
      bridgeFetch,
    );
  };
  // Turn the slash-menu picks into prompt text. A leading run of "/name" tokens
  // (chosen from the "/" menu) is peeled off the typed text: a *skill* becomes an
  // explicit "Use the X skill." instruction (skills are model-invoked in headless
  // runs — there's no CLI flag to force one), while a *command*/*prompt* is left
  // as its literal /name invocation. Unknown tokens are left in the body as-is.
  const applySkillTokens = (raw) => {
    const directives = [];
    let rest = raw;
    for (;;) {
      const m = rest.match(/^\/([A-Za-z0-9][\w-]*)(?:\s+|$)/);
      if (!m) break;
      const item = availableSkills.find((s) => s.name === m[1]);
      if (!item) break; // not a known skill/command — leave it in the text
      directives.push(item.kind === 'skill' ? `Use the "${item.name}" skill.` : `/${item.name}`);
      rest = rest.slice(m[0].length);
    }
    return { directives: directives.join('\n'), body: rest.trim() };
  };
  const runChat = () => {
    const text = chatText.value.trim();
    const chips = chat.chips();
    if (agentRunning || !selectedAgent || (!text && !chips.length)) return;
    pendingResolveIds = []; // a plain chat turn never resolves queued comments
    agentRunning = true;
    agentErrored = false;
    closeTextRow();
    commentsSend.disabled = true;
    chatSend.disabled = true;
    surface = { log: chatStream, status: chatStatus };
    const empty = chatStream.querySelector('.chat-empty');
    if (empty) chatStream.innerHTML = ''; // first turn — drop the placeholder
    agentStartAt = Date.now();
    startThinking();
    const mode = chat.takeMode(); // sticky posture: 'discuss' or 'apply' (Shift+Tab cycles)

    // Peel any leading slash-menu picks off the typed text into agent directives,
    // then fold attached context chips in: directives → body → chips (0011).
    const { directives, body } = applySkillTokens(text);
    let markdown = body;
    if (chips.length) {
      markdown = (body ? body + '\n\n' : '') + contextChipsBlock(chips);
    }
    if (directives) markdown = directives + (markdown ? '\n\n' + markdown : '');
    chat.clearChips(); // attachments are per-turn — no auto-carry (D13)
    renderChatChips();
    chatStateUpdate(); // reflect the toggle reset + cleared chips

    if (text) cLog('you', '›', escHtml(text));
    if (text) chat.record({ k: 'you', text });
    if (chips.length) {
      const labels = chips.map((c) => (c.loc ? c.loc.split('/').pop() : c.label)).join(', ');
      cLog('ctx', '↳', escHtml(labels));
      chat.record({ k: 'ctx', labels });
    }
    chatText.value = '';

    streamAgentRun(
      { agent: selectedAgent, model: selectedModel, markdown, resume: chat.sessionId(), mode },
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
  // Comments-tab "Send to agent": hand the *selected* comments (+ an optional
  // note on how to apply them) to the Chat tab and let the agent resolve them
  // there (apply-once, so it edits the source this turn). Switches to Chat so
  // the user watches the work stream into one continuous thread, reusing the
  // chat session + finish/render path. The sent comments are deleted on success.
  const sendCommentsToChat = () => {
    const anns = selectedIds.map((id) => Q.get(id)).filter(Boolean);
    if (agentRunning || !selectedAgent || !anns.length) return;
    const noteText = addNoteText.value.trim();
    selectTab('chat');
    if (!drawerOpen) openDrawer();
    // Start a fresh chat thread so the comments stream into a clean transcript —
    // the same clean slate the floating panel gives, never stacking onto an
    // earlier run. Prior threads stay reachable from the history menu. (Done
    // before agentRunning flips, so switchChat's mid-stream guard passes.)
    chat.newChat();
    switchChat();
    agentRunning = true;
    agentErrored = false;
    closeTextRow();
    commentsSend.disabled = true;
    chatSend.disabled = true;
    surface = { log: chatStream, status: chatStatus };
    const empty = chatStream.querySelector('.chat-empty');
    if (empty) chatStream.innerHTML = ''; // first turn — drop the placeholder
    agentStartAt = Date.now();
    startThinking();
    pendingResolveIds = anns.map((a) => a.id); // deleted once the run succeeds
    markThinkingBubbles(pendingResolveIds); // flash the pins for the comments being resolved

    const parts = ['Please resolve the following comments by editing the source:', toMarkdownFor(anns)];
    if (noteText) parts.push('## How to apply\n' + noteText);
    const markdown = parts.join('\n\n');
    const summary = `${anns.length} comment${anns.length > 1 ? 's' : ''} to resolve` + (noteText ? ` — “${noteText}”` : '');
    cLog('you', '›', escHtml(summary));
    chat.record({ k: 'you', text: summary });

    streamAgentRun(
      { agent: selectedAgent, model: selectedModel, markdown, resume: chat.sessionId(), mode: 'apply-once' },
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

  // Build the chat-history dropdown from the model's conversation summaries
  // (most-recent-first). Each row opens that thread; the trash icon deletes it.
  const renderChatHistory = () => {
    const list = chat.chats();
    if (!list.length) {
      chatHistMenu.innerHTML = '<div class="chat-hist-empty">No chats yet.</div>';
      return;
    }
    chatHistMenu.innerHTML = list
      .map(
        (c) =>
          `<div class="chat-hist-item${c.active ? ' active' : ''}" data-chat="${c.id}">` +
          `<button class="chat-hist-open" data-act="chat-open" title="${escHtml(c.title)}">${escHtml(c.title)}</button>` +
          `<button class="chat-hist-del" data-act="chat-del" title="Delete chat" aria-label="Delete chat">` +
          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>` +
          `</button></div>`,
      )
      .join('');
  };
  // Reflect the current conversation's title into the chat header. Muted while
  // it's still the "New chat" placeholder.
  const renderChatHead = () => {
    const t = chat.title();
    chatTitle.textContent = t;
    chatTitle.title = t;
    chatTitle.classList.toggle('untitled', t === 'New chat');
  };
  // Switch the open conversation: drop the half-composed draft (chips/input are
  // per-turn, not per-chat), replay the target thread, and refresh the chrome.
  const switchChat = () => {
    if (agentRunning) return; // never swap threads mid-stream
    chat.clearChips();
    renderChatChips();
    chatText.value = '';
    restoreChat();
    renderChatHead();
    chatStateUpdate();
    renderChatHistory();
  };

  const exportMarkdown = () => {
    if (!Q.count()) return;
    const blob = new Blob([toMarkdown()], { type: 'text/markdown' });
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
  const setPicking = (on, mode = 'comment') => {
    picking = on;
    pickMode = on ? mode : 'comment';
    pickBtn.classList.toggle('on', on && pickMode === 'comment');
    chatPickBtn.classList.toggle('armed', on && pickMode === 'chat'); // accent the attach button while arming a pick
    chatPickBtn.setAttribute('aria-pressed', on && pickMode === 'chat' ? 'true' : 'false');
    if (!on) {
      hideOutline();
      marquee.style.display = 'none';
      closeNote();
    }
  };
  // Toggle a pick mode: clicking the active mode's button turns picking off;
  // clicking the other switches modes (and keeps picking on).
  const togglePick = (mode) => setPicking(!(picking && pickMode === mode), mode);

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

  // The press→drag→release→click gesture is a pure state machine in
  // models/pick-mode.mjs (was/dragging/justDragged transitions + marquee
  // geometry + click-vs-drag). The handlers below stay thin DOM glue: they
  // translate real pointer events into the model's events, then apply the
  // returned effect to the DOM.
  let pickState = { dragStart: null, dragging: false, justDragged: false };

  const onMouseDown = (e) => {
    // Click-away closes an open popover — unless the press lands on the popover
    // itself or a bubble (the bubble's own handler toggles it).
    if (openPopId != null) {
      const path = e.composedPath();
      if (!path.includes(popover) && !path.some((n) => n.classList && n.classList.contains('bubble'))) {
        closePopover();
      }
    }
    // Click-away closes an open note (discarding it) — unless the press lands on
    // the note itself. A fresh pick opens its note on the later click event, so
    // this never eats the gesture that's opening one.
    if (note.style.display === 'block' && !e.composedPath().includes(note)) closeNote();
    pickState = reducePickMode(pickState, {
      type: 'down', x: e.clientX, y: e.clientY, picking, onOwn: isOwn(e.composedPath()[0]),
    }).state;
  };

  const onMove = (e) => {
    const drewBefore = pickState.dragging;
    const { state, effect } = reducePickMode(pickState, {
      type: 'move', x: e.clientX, y: e.clientY, picking, threshold: DRAG_THRESHOLD,
    });
    pickState = state;
    if (effect.kind === 'marquee') {
      if (!drewBefore) hideOutline(); // first frame of a drag drops the hover outline
      const r = effect.rect;
      marquee.style.display = 'block';
      marquee.style.left = r.left + 'px';
      marquee.style.top = r.top + 'px';
      marquee.style.width = r.width + 'px';
      marquee.style.height = r.height + 'px';
      return;
    }
    if (effect.kind !== 'hover') return;
    const el = e.composedPath()[0];
    if (!el || !el.nodeType || isOwn(el)) {
      hideOutline();
      return;
    }
    positionOutline(el);
  };

  const onMouseUp = (e) => {
    const wasDrag = pickState.dragging;
    const { state, effect } = reducePickMode(pickState, {
      type: 'up', x: e.clientX, y: e.clientY, picking, pickMode,
    });
    pickState = state;
    if (wasDrag) marquee.style.display = 'none';
    // Region marquee only makes a comment; chat-pick attaches single elements.
    if (effect.kind === 'region') {
      const r = effect.rect;
      const region = {
        x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height,
      };
      openNote({ region }, { bottom: r.top + r.height, left: r.left }, null);
    }
  };

  const onClick = (e) => {
    const { state, effect } = reducePickMode(pickState, { type: 'click', picking });
    pickState = state;
    if (effect.kind === 'suppress') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (effect.kind !== 'click') return;
    const target = e.composedPath()[0];
    if (isOwn(target)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = locator.stampedAncestor(target);
    if (pickMode === 'chat') {
      attachChatChip(el);
      setPicking(false); // single-shot: one pick attaches, then dismiss selection
      chatText.focus(); // land the cursor in the composer so you can type right away
      return;
    }
    openNote({ el }, el.getBoundingClientRect(), null);
  };


  // ---- Comments drawer -----------------------------------------------------
  // One card per comment: author + relative time, a select checkbox on the
  // right, the comment body, any threaded replies, and a Reply affordance that
  // reveals an inline reply box. Checking a comment selects it for "Send to
  // agent"; the action bar appears once anything is selected.
  const renderDrawer = () => {
    drawerCount.textContent = Q.count() ? String(Q.count()) : '';
    drawerBubbleBadge.textContent = String(Q.count());
    drawerBubbleBadge.classList.toggle('show', Q.count() > 0);
    if (!Q.count()) {
      drawerList.innerHTML =
        '<div class="drawer-empty">No comments yet.<br>Use Pick to annotate an element or region.</div>';
      updateCommentsActions();
      return;
    }
    drawerList.innerHTML = '';
    Q.all().forEach((a) => {
      const row = document.createElement('div');
      row.className = 'crow';
      row.dataset.id = a.id;
      const hasLoc = !!a.loc;
      const on = selectedIds.includes(a.id);
      if (on) row.classList.add('selected');
      row.innerHTML =
        `<div class="crow-head">` +
        `<button class="crow-resolve" data-act="crow-select" aria-pressed="${on ? 'true' : 'false'}" title="Select to send">` +
        `<span class="crow-resolve-box${on ? ' on' : ''}"></span>` +
        `</button>` +
        `<div class="crow-meta">` +
        (hasLoc
          ? `<div class="src"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><span class="src-name"></span></div>` +
            `<span class="crow-divider"></span>`
          : '') +
        `<span class="crow-time"></span>` +
        `</div>` +
        `<div class="crow-tools">` +
        `<button class="crow-act" data-act="crow-edit" title="Edit comment" aria-label="Edit comment"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>` +
        `<button class="crow-act danger" data-act="crow-delete" title="Delete comment" aria-label="Delete comment"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` +
        `</div>` +
        `</div>` +
        `<blockquote class="crow-body"></blockquote>`;
      row.querySelector('.crow-time').textContent = relTime(a.createdAt);
      if (hasLoc) fillSrc(row.querySelector('.src'), a.loc);
      row.querySelector('.crow-body').textContent = a.comment;
      drawerList.appendChild(row);
    });
    updateCommentsActions();
  };

  // Reflect the active view onto the drawer (CSS shows/hides each pane and
  // swaps the header between brand+bubble and back+heading). Persisted so it
  // survives a reload.
  const applyTab = () => {
    drawer.classList.toggle('tab-chat', activeTab === 'chat');
  };
  const selectTab = (tab) => {
    if (tab !== 'comments' && tab !== 'chat') return;
    activeTab = tab;
    try { localStorage.setItem(TAB_KEY, tab); } catch (_) {}
    applyTab();
  };

  // Non-modal: instead of overlaying the page, shrink it. A right margin on the
  // host's <html> shifts normal-flow content left by the panel's width while the
  // fixed panel fills the gap (docked-devtools effect). Margin must go on the
  // root, not <body>, so it also reflows the page's own fixed/absolute layout.
  const pushPage = (open) => {
    const root = document.documentElement;
    root.style.transition = 'margin-right .22s cubic-bezier(.4,0,.2,1)';
    root.style.marginRight = open ? `${drawer.offsetWidth}px` : '';
  };

  const openDrawer = () => {
    drawerOpen = true;
    renderDrawer();
    applyTab();
    drawer.classList.add('open');
    commentsBtn.classList.add('on');
    pushPage(true);
  };
  const closeDrawer = () => {
    drawerOpen = false;
    drawer.classList.remove('open');
    commentsBtn.classList.remove('on');
    pushPage(false);
  };

  const clearAll = () => {
    Q.clear();
    locator.clear();
    refreshCount();
    renderBubbles();
    closePopover();
  };

  const closeGearMenu = () => gearMenu.classList.remove('open');
  // Open the gear menu, deciding which way its model flyout should fly: right by
  // default, left only when the bar sits too near the viewport's right edge to
  // fit the submenu (it's draggable, so this is measured each open).
  const gearSub = gearMenu.querySelector('.gear-sub');
  const FLYOUT_W = 200; // submenu min-width + gap + a little slack
  const openGearMenu = () => {
    const room = window.innerWidth - gearMenu.getBoundingClientRect().right;
    gearSub.classList.toggle('flip-left', room < FLYOUT_W);
    gearMenu.classList.add('open');
  };

  // ---- Wiring --------------------------------------------------------------
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'pick') togglePick('comment');
    else if (act === 'comments') drawerOpen ? closeDrawer() : openDrawer();
    else if (act === 'gear-toggle') gearMenu.classList.contains('open') ? closeGearMenu() : openGearMenu();
    else if (act === 'clear') { clearAll(); closeGearMenu(); }
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
    positionCpanel(); // drag the floating feed along with the bar
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
    positionCpanel(); // keep the floating feed anchored to the bar's new footprint
  };

  // Anchor the floating agent feed (cpanel) just above the bar's resting box,
  // horizontally centred on the bar but clamped to the viewport — so when a send
  // collapses the bar to its circle, the chat sits right above the puck (and
  // hugs whichever corner the circle was dragged to). offset* reads the settled
  // layout box, ignoring the in-flight FLIP transform, so this is safe to call
  // mid-animation. No-op while the feed is closed.
  const positionCpanel = () => {
    if (!cpanel.classList.contains('open')) return;
    const cw = cpanel.offsetWidth;
    let left = bar.offsetLeft + bar.offsetWidth / 2 - cw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - cw - 8));
    cpanel.style.left = left + 'px';
    cpanel.style.right = 'auto';
    cpanel.style.bottom = Math.max(8, window.innerHeight - bar.offsetTop + 12) + 'px';
    cpanel.style.transform = 'none';
  };

  // ---- Add-note (top action bar) -------------------------------------------
  // "Add note" reveals an instruction box; its text rides along with the
  // selected comments on "Send to agent" (guidance on how to apply them). The
  // typed value is preserved while toggling, and cleared after a successful send.
  const toggleAddNote = () => {
    const open = !addNoteBox.classList.contains('open');
    addNoteBox.classList.toggle('open', open);
    if (open) addNoteText.focus();
  };
  addNoteText.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); addNoteBox.classList.remove('open'); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendCommentsToChat(); }
  });

  // ---- "/" slash-menu — pick a project skill/command into the composer -------
  // Opens when the caret sits in a leading "/token" (the first run of slash
  // tokens), filters as you type, and inserts "/name " on pick. The pick is just
  // composer text; runChat() (via applySkillTokens) is what turns it into agent
  // directives. Keyboard: ↑/↓ move, Enter/Tab pick, Esc closes.
  let skillMenuOpen = false;
  let skillActive = 0; // highlighted row into skillShown
  let skillShown = []; // currently filtered items
  let skillTokenStart = 0; // index of the '/' being completed, in the textarea

  // The slash-token under the caret. DOM glue reads the caret + composer text;
  // the parse/match decision lives in models/slash-menu.mjs.
  const slashContext = () => {
    const caret = chatText.selectionStart == null ? chatText.value.length : chatText.selectionStart;
    return slashMenu.slashContext(chatText.value, caret);
  };
  const filterSkills = (q) => slashMenu.filterSkills(availableSkills, q);
  // Bold the matched span in a name.
  const markName = (name, q) => {
    const i = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
    if (i < 0) return escHtml(name);
    return escHtml(name.slice(0, i)) + '<b>' + escHtml(name.slice(i, i + q.length)) + '</b>' + escHtml(name.slice(i + q.length));
  };
  const closeSkillMenu = () => {
    if (!skillMenuOpen) return;
    skillMenuOpen = false;
    skillActive = 0;
    chatSkillMenu.classList.remove('open');
  };
  const refreshSkillActive = () => {
    const opts = chatSkillMenu.querySelectorAll('.skill-opt');
    opts.forEach((o, i) => o.classList.toggle('active', i === skillActive));
    if (opts[skillActive]) opts[skillActive].scrollIntoView({ block: 'nearest' });
  };
  const updateSkillMenu = () => {
    const ctx = slashContext();
    if (!ctx) return closeSkillMenu();
    skillTokenStart = ctx.start;
    skillShown = filterSkills(ctx.query);
    skillActive = slashMenu.clampActive(skillActive, skillShown.length);
    if (!availableSkills.length) {
      chatSkillMenu.innerHTML = '<div class="skill-menu-empty">No project skills found</div>';
    } else if (!skillShown.length) {
      chatSkillMenu.innerHTML = '<div class="skill-menu-empty">No match</div>';
    } else {
      chatSkillMenu.innerHTML = skillShown
        .map(
          (s, i) =>
            `<button type="button" class="skill-opt${i === skillActive ? ' active' : ''}" role="option" data-name="${escHtml(s.name)}">` +
            `<span class="skill-opt-top"><span class="skill-opt-name">/${markName(s.name, ctx.query)}</span>` +
            `<span class="skill-opt-kind">${escHtml(s.kind)}</span></span>` +
            (s.description ? `<span class="skill-opt-desc">${escHtml(s.description)}</span>` : '') +
            '</button>',
        )
        .join('');
    }
    skillMenuOpen = true;
    chatSkillMenu.classList.add('open');
  };
  const pickSkill = (item) => {
    if (!item) return;
    const caret = chatText.selectionStart == null ? chatText.value.length : chatText.selectionStart;
    const next = slashMenu.applyPick(chatText.value, caret, skillTokenStart, item.name);
    chatText.value = next.value;
    chatText.setSelectionRange(next.caret, next.caret);
    closeSkillMenu();
    chatText.focus();
    chatStateUpdate();
  };
  // Pick on mousedown (not click) with preventDefault so the textarea keeps focus
  // and no blur fires mid-selection.
  chatSkillMenu.addEventListener('mousedown', (e) => {
    const opt = e.target.closest('.skill-opt');
    if (!opt) return;
    e.preventDefault();
    pickSkill(skillShown.find((s) => s.name === opt.dataset.name));
  });
  chatText.addEventListener('blur', closeSkillMenu);

  chatText.addEventListener('input', () => {
    chatStateUpdate();
    updateSkillMenu();
  });
  chatText.addEventListener('keydown', (e) => {
    // While the slash-menu is open, it owns navigation/selection keys.
    if (skillMenuOpen) {
      if (e.key === 'Escape') { e.preventDefault(); closeSkillMenu(); return; }
      if (skillShown.length) {
        if (e.key === 'ArrowDown') { e.preventDefault(); skillActive = slashMenu.moveSelection(skillActive, skillShown.length, 1); refreshSkillActive(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); skillActive = slashMenu.moveSelection(skillActive, skillShown.length, -1); refreshSkillActive(); return; }
        if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); pickSkill(skillShown[skillActive]); return; }
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      runChat();
    } else if (e.key === 'Tab' && e.shiftKey) {
      // Claude-Code-style: cycle the sticky agent posture without leaving the input.
      e.preventDefault();
      chat.cycleMode();
      chatStateUpdate();
    }
  });

  cpanel.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="agent-close"]')) { cancelDismiss(); cpanel.classList.remove('open'); }
  });

  drawer.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="drawer-close"]')) {
      closeDrawer();
      return;
    }
    if (e.target.closest('[data-act="comments-send"]')) {
      sendCommentsToChat(); // hand the selected comments to the Chat tab to resolve
      return;
    }
    if (e.target.closest('[data-act="add-note"]')) {
      toggleAddNote();
      return;
    }
    if (e.target.closest('[data-act="chat-send"]')) {
      runChat();
      return;
    }
    if (e.target.closest('[data-act="chat-new"]')) {
      if (agentRunning) return; // can't start a thread while one is streaming
      chat.newChat();
      closeChatHistory();
      switchChat();
      chatText.focus();
      return;
    }
    if (e.target.closest('[data-act="chat-history-toggle"]')) {
      const open = !chatHistMenu.classList.contains('open');
      if (open) renderChatHistory();
      chatHistMenu.classList.toggle('open', open);
      chatHistBtn.classList.toggle('open', open);
      chatHistBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }
    const histDel = e.target.closest('[data-act="chat-del"]');
    if (histDel) {
      const id = histDel.closest('.chat-hist-item').dataset.chat;
      const wasCurrent = id === chat.currentId();
      chat.deleteChat(id);
      if (wasCurrent) switchChat(); // open thread was removed — replay the fallback
      else renderChatHistory();
      return;
    }
    const histOpen = e.target.closest('[data-act="chat-open"]');
    if (histOpen) {
      if (agentRunning) return;
      chat.selectChat(histOpen.closest('.chat-hist-item').dataset.chat);
      closeChatHistory();
      switchChat();
      return;
    }
    if (e.target.closest('[data-act="chat-mode"]')) {
      chat.cycleMode(); // discuss ⇄ apply (also reachable via Shift+Tab in the composer)
      chatStateUpdate();
      return;
    }
    if (e.target.closest('[data-act="chat-pick"]')) {
      togglePick('chat'); // arm element-pick that attaches a context chip
      return;
    }
    if (e.target.closest('[data-act="open-comments"]')) {
      selectTab('comments'); // header bubble → Comments sub-view
      return;
    }
    if (e.target.closest('[data-act="comments-back"]')) {
      selectTab('chat'); // back arrow → Chat home
      return;
    }
    const chatChipX = e.target.closest('[data-act="chat-chip-remove"]');
    if (chatChipX) {
      chat.removeChip(chatChipX.closest('.chip').dataset.chip);
      renderChatChips();
      chatStateUpdate();
      return; // drop one context attachment before sending
    }
    const row = e.target.closest('.crow');
    if (!row) return;
    const id = row.dataset.id;
    // Select — check/uncheck this comment for "Send to agent" (in place, so the
    // card's reply state survives). Selection drives the top action bar.
    if (e.target.closest('[data-act="crow-select"]')) {
      const i = selectedIds.indexOf(id);
      if (i >= 0) selectedIds.splice(i, 1);
      else selectedIds.push(id);
      const on = selectedIds.includes(id);
      const btn = row.querySelector('[data-act="crow-select"]');
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.querySelector('.crow-resolve-box').classList.toggle('on', on);
      row.classList.toggle('selected', on);
      updateCommentsActions();
      return;
    }
    if (e.target.closest('[data-act="crow-edit"]')) {
      editAnnotation(id);
      return;
    }
    if (e.target.closest('[data-act="crow-delete"]')) {
      const i = selectedIds.indexOf(id);
      if (i >= 0) selectedIds.splice(i, 1);
      deleteAnnotation(id);
      renderDrawer();
      return;
    }
    const loc = e.target.closest('.src');
    if (loc && loc.classList.contains('linkable')) {
      openInEditor(loc.dataset.loc);
      return;
    }
  });

  note.addEventListener('click', (e) => {
    // Resolve via closest so a click on an icon button's inner <svg> still
    // reads the button's data-act (close + comment + send carry SVGs now).
    const actEl = e.target.closest && e.target.closest('[data-act]');
    const act = actEl && actEl.getAttribute('data-act');
    if (act === 'save') saveNote();
    else if (act === 'send-agent') sendNote();
    else if (act === 'note-close') closeNote();
    else if (act === 'expand') {
      const expanded = note.classList.toggle('expanded');
      actEl.setAttribute('aria-label', expanded ? 'Collapse prompt input' : 'Expand prompt input');
      actEl.setAttribute('title', expanded ? 'Collapse' : 'Expand');
    }
    else if (act === 'sp-dec') stepSpacing(-1);
    else if (act === 'sp-inc') stepSpacing(1);
    else if (act === 'ty-dec') stepType(-1);
    else if (act === 'ty-inc') stepType(1);
    else {
      const tab = e.target.closest && e.target.closest('.ctl-tab');
      if (tab) { selectGroup(tab.dataset.group); return; }
      const prop = e.target.closest && e.target.closest('.sp-prop');
      if (prop) selectSpacingProp(prop.dataset.prop);
      const cprop = e.target.closest && e.target.closest('.cl-prop');
      if (cprop) selectColorProp(cprop.dataset.cprop);
      const swatch = e.target.closest && e.target.closest('.cl-swatch');
      if (swatch) pickColor(swatch.dataset.token);
      const tprop = e.target.closest && e.target.closest('.ty-prop');
      if (tprop) selectTypeProp(tprop.dataset.tprop);
      refreshCtlTabs(); // a property select/clear changes which groups are staged
    }
  });
  noteSrc.addEventListener('click', () => openInEditor(noteSrc.dataset.loc));
  noteText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote();
    else if (e.key === 'Escape') closeNote();
  });
  copyText.addEventListener('input', () => { previewCopy(); refreshCtlTabs(); }); // live preview onto the element
  copyText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote();
    else if (e.key === 'Escape') closeNote();
  });

  popover.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'delete') deleteAnnotation(openPopId);
    else if (act === 'edit') editAnnotation(openPopId);
    else if (act === 'send-agent') {
      const a = Q.get(openPopId);
      closePopover();
      if (a) runAgent({ annotations: [a], note: '', surface: 'panel' });
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
    const sa = shadow.activeElement;
    if (sa && (sa.tagName === 'TEXTAREA' || sa.tagName === 'INPUT')) return true;
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
      if (gearMenu.classList.contains('open')) { closeGearMenu(); return; }
      if (chatHistMenu.classList.contains('open')) { closeChatHistory(); return; }
      if (cpanel.classList.contains('open')) { cancelDismiss(); cpanel.classList.remove('open'); }
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
      togglePick('comment');
    } else if (e.code === 'KeyE') {
      e.preventDefault();
      exportMarkdown();
    } else if (e.code === 'KeyC') {
      e.preventDefault();
      if (drawerOpen) closeDrawer();
      else openDrawer();
    }
  });
  window.addEventListener('scroll', () => picking && hideOutline(), true);
  window.addEventListener('resize', () => positionCpanel()); // re-anchor the feed if the viewport changes

  // ---- Init ----------------------------------------------------------------
  // (Legacy-record backfill — missing id/type — is handled inside createQueue.)
  refreshCount();
  renderBubbles();
  restoreChat(); // replay the persisted chat transcript (resumes via chat.sessionId())
  renderChatHead();
  chatStateUpdate();
  renderChatHistory();

  // ---- Agent + model picker ------------------------------------------------
  // Probe the bridge for installed coding-agent CLIs and their models, then build
  // a custom combobox: one group per agent, one row per model (value encodes
  // "agent:model"; model '' = the CLI default). Shown whenever there's a choice;
  // none installed → Send stays disabled. The picker is the only place an agent
  // name appears (everything else stays agent-agnostic).
  const modelsOf = (ag) => (ag.models && ag.models.length ? ag.models : [{ label: 'Default', value: '' }]);
  const AGENT_CHECK =
    '<svg class="agent-opt-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  // The chat composer hosts the inline combobox (shown only when there's more
  // than one model to pick); the "Default model" control lives in the gear menu
  // as a flyout submenu (built separately below). Both share one selection and
  // drive the same selectedAgent/model.
  const pickers = [
    { sel: '.chat-composer .agent-pick', alwaysShow: false },
  ].map(({ sel, alwaysShow }) => {
    const wrap = $(sel);
    return {
      wrap,
      alwaysShow,
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

  // The gear menu's "Default model" flyout: every model, listed flat and
  // grouped per agent by a horizontal divider label (no nested submenus).
  // Selection routes through select(), so it stays in lockstep with the chat
  // composer's combobox.
  const gearModelMenu = $('.bar .gear-model-menu');
  const gearModelVal = $('.bar .gear-model-val');
  const gearModelHtml = () =>
    availableAgents
      .map((ag) => {
        const opts = modelsOf(ag)
          .map((m) => {
            const sel = ag.name === selectedAgent && m.value === selectedModel;
            return (
              `<button class="gear-opt${sel ? ' sel' : ''}" data-value="${ag.name}:${m.value}" data-label="${escHtml(m.label)}">` +
              AGENT_CHECK.replace('agent-opt-check', 'gear-opt-check') +
              `<span class="gear-opt-label">${escHtml(m.label)}</span></button>`
            );
          })
          .join('');
        return `<div class="gear-group-label">${escHtml(ag.name)}</div>${opts}`;
      })
      .join('');
  const renderGearModels = (label) => { gearModelMenu.innerHTML = gearModelHtml(); gearModelVal.textContent = label; };

  // Skills/commands the chosen agent exposes at the project root — fed to the "/"
  // slash-menu. Fetched per agent (claude/codex scan different locations), cached
  // client-side so switching back is instant.
  const applySkills = (list) => {
    availableSkills = Array.isArray(list) ? list : [];
    if (skillMenuOpen) updateSkillMenu(); // refresh an open menu once results land
  };
  const loadSkills = (agent) => {
    if (!agent) return applySkills([]);
    if (skillsByAgent[agent]) return applySkills(skillsByAgent[agent]);
    bridgeFetch('/__pointcut/skills?agent=' + encodeURIComponent(agent))
      .then((r) => (r.ok ? r.json() : { skills: [] }))
      .then((d) => {
        skillsByAgent[agent] = (d && d.skills) || [];
        applySkills(skillsByAgent[agent]);
      })
      .catch(() => applySkills([]));
  };

  const select = (agent, model, label) => {
    selectedAgent = agent;
    selectedModel = model;
    pickers.forEach((p) => { p.label.textContent = label; });
    chat.setSession(null); // the chat thread's resume id is stale under a new agent
    renderAllMenus();
    renderGearModels(label);
    refreshCount();
    updateCommentsActions();
    loadSkills(agent); // the "/" menu follows the agent
    chatStateUpdate();
  };
  const applyAgents = (agents) => {
    availableAgents = Array.isArray(agents) ? agents : [];
    const first = availableAgents[0];
    selectedAgent = first ? first.name : null;
    selectedModel = first ? modelsOf(first)[0].value : '';
    const label = first ? modelsOf(first)[0].label : 'No agent';
    const total = availableAgents.reduce((n, ag) => n + modelsOf(ag).length, 0);
    pickers.forEach((p) => { p.label.textContent = label; p.wrap.classList.toggle('show', p.alwaysShow || total > 1); });
    renderAllMenus();
    renderGearModels(label);
    refreshCount();
    updateCommentsActions();
    loadSkills(selectedAgent); // prime the "/" menu for the default agent
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
  // Picking a model from the gear flyout commits the selection and closes the
  // whole gear menu (which collapses the flyout with it).
  gearMenu.addEventListener('click', (e) => {
    const opt = e.target.closest('.gear-opt');
    if (!opt) return;
    const v = opt.dataset.value;
    const i = v.indexOf(':');
    select(v.slice(0, i), v.slice(i + 1), opt.dataset.label);
    closeGearMenu();
  });
  // Dismiss on any press outside both comboboxes (composedPath crosses the shadow).
  document.addEventListener('mousedown', (e) => {
    const open = pickers.some((p) => p.menu.classList.contains('open'));
    if (open && !pickers.some((p) => e.composedPath().includes(p.wrap))) closeAgentMenu();
    // The gear menu hosts one of those comboboxes, so close it only once the
    // press lands outside the whole gear control (and not on its open submenu).
    if (gearMenu.classList.contains('open') && !e.composedPath().includes(gearWrap)) closeGearMenu();
    if (chatHistMenu.classList.contains('open') && !e.composedPath().includes(chatHistWrap)) closeChatHistory();
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
