// @pointcut/core/client — the in-page toolbar (browser ESM).
//
// Injected in design mode only. Renders into a Shadow DOM (vanilla, no
// framework). Reaches the Bridge via a base URL stamped at build time:
// empty for same-origin auto-attach, http://localhost:<port> for the sidecar.
//
// Builds on the #4 tracer-bullet Pick path (hover/lock pick + jump-to-source)
// and layers on two later slices:
//   • #5 send-to-Agent — a Send panel + run-mode selector (apply / apply-once /
//     discuss) that POSTs the locked pick as an Annotation to the Bridge's
//     agent-run endpoint and streams back its NDJSON Actions.
//   • #7 no-Agent handoff — every lock also captures the pick as an Annotation
//     in a Queue/Session, and the toolbar gains "Copy all" and "Export". Both
//     render through the ported Handoff builders (handoff.mjs) — no formatting
//     logic lives here.
// The drawer, chat, and introspection panels arrive in later slices.
import { createLocator } from '../models/locator.mjs';
import { streamAgentRun } from '../models/agent-run.mjs';
import { createQueue } from '../models/queue.mjs';
// @ts-ignore — .mjs sibling, typed structurally by the builders' contract.
import { buildHandoff, contextChipsBlock } from '../models/handoff.mjs';

/** The run mode — sets the chosen agent's permission posture (mirrors AgentMode). */
type RunMode = 'apply' | 'apply-once' | 'discuss';

/** Replaced at build time by the unplugin `define`; '' means same-origin. */
declare const __POINTCUT_BRIDGE__: string | undefined;

export const bridgeBase: string = typeof __POINTCUT_BRIDGE__ === 'string' ? __POINTCUT_BRIDGE__ : '';

/** The Source Stamp attribute, mirrored from the Vue Stamper. */
const LOC_ATTR = 'data-pointcut-loc';
/** Host element id — also the HMR / double-inject guard. */
const HOST_ID = 'pointcut-host';

/** Queue/Session persistence keys (scoped under a neutral pointcut prefix). */
const QUEUE_KEY = 'pointcut:queue';
const SELECTION_KEY = 'pointcut:queue:selected';

// The no-Agent handoff carries one annotation "type". Later slices introspect
// real type tags; the tracer bullet ships a single neutral label so blockFor()
// has a vocabulary to resolve against (it falls back to the first entry).
const TYPES = [{ id: 'pick', label: 'Pick' }];

/** Mount the toolbar into the page. Idempotent — a second call is a no-op. */
export function mount(): void {
  if (typeof document === 'undefined') return; // SSR / non-browser
  if (document.getElementById(HOST_ID)) return; // HMR / double-inject guard

  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .outline {
        position: fixed; z-index: 2147483646; pointer-events: none; display: none;
        border: 1px solid #c6f24e; background: rgba(198,242,78,.10);
        border-radius: 2px;
      }
      .tag {
        position: fixed; z-index: 2147483647; pointer-events: none; display: none;
        font: 11px/1.4 ui-monospace, monospace; color: #11141a; background: #c6f24e;
        padding: 1px 6px; border-radius: 4px; transform: translateY(-100%);
        white-space: nowrap;
      }
      .bar {
        position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
        display: flex; align-items: center; gap: 8px;
        font: 600 11px/1 ui-sans-serif, system-ui;
      }
      .btn {
        height: 40px; padding: 0 12px; border-radius: 20px; border: none; cursor: pointer;
        background: #2a2c2f; color: #e7e9ee; font: inherit;
        box-shadow: 0 6px 20px rgba(0,0,0,.4);
      }
      .btn:disabled { opacity: .45; cursor: default; }
      .puck { width: 40px; padding: 0; border-radius: 50%; }
      .puck.on { background: #c6f24e; color: #11141a; }
      .count {
        position: absolute; top: -4px; left: -4px; min-width: 16px; height: 16px;
        padding: 0 4px; border-radius: 8px; background: #c6f24e; color: #11141a;
        font: 700 10px/16px ui-sans-serif, system-ui; text-align: center;
        display: none;
      }
      .puck-wrap { position: relative; display: inline-flex; }
      .panel {
        position: fixed; right: 16px; bottom: 64px; z-index: 2147483647; display: none;
        width: 280px; padding: 12px; border-radius: 10px; background: #1b1d21; color: #e7e9ee;
        font: 12px/1.45 ui-sans-serif, system-ui; box-shadow: 0 6px 20px rgba(0,0,0,.4);
      }
      .panel.open { display: block; }
      .panel .pick-loc { font: 11px/1.4 ui-monospace, monospace; color: #c6f24e; word-break: break-all; margin-bottom: 8px; cursor: pointer; }
      .panel textarea {
        width: 100%; box-sizing: border-box; min-height: 56px; resize: vertical; margin-bottom: 8px;
        background: #11141a; color: #e7e9ee; border: 1px solid #2a2c2f; border-radius: 6px; padding: 6px;
        font: 12px/1.4 ui-sans-serif, system-ui;
      }
      .panel .row { display: flex; gap: 6px; margin-bottom: 8px; }
      .panel select {
        flex: 1; background: #11141a; color: #e7e9ee; border: 1px solid #2a2c2f;
        border-radius: 6px; padding: 4px; font: 12px/1 ui-sans-serif, system-ui;
      }
      .panel .send {
        width: 100%; border: none; border-radius: 6px; padding: 8px; cursor: pointer;
        background: #c6f24e; color: #11141a; font: 600 12px/1 ui-sans-serif, system-ui;
      }
      .panel .send:disabled { opacity: .5; cursor: default; }
      .panel .log { margin-top: 8px; max-height: 120px; overflow: auto; font: 11px/1.5 ui-monospace, monospace; color: #aeb2bd; }
      .panel .log div { white-space: pre-wrap; word-break: break-all; }
    </style>
    <div class="outline"></div>
    <div class="tag"></div>
    <div class="panel">
      <div class="pick-loc"></div>
      <textarea class="msg" placeholder="Describe the change for the agent…"></textarea>
      <div class="row">
        <select class="agent" title="Agent"></select>
        <select class="mode" title="Run mode">
          <option value="apply">apply</option>
          <option value="apply-once">apply-once</option>
          <option value="discuss">discuss</option>
        </select>
      </div>
      <button class="send" disabled>Send to agent</button>
      <div class="log"></div>
    </div>
    <div class="bar">
      <button class="btn copy" title="Copy paste-and-go markdown for the whole queue" disabled>Copy all</button>
      <button class="btn export" title="Download the handoff with screenshots embedded" disabled>Export</button>
      <span class="puck-wrap">
        <button class="btn puck" title="Pick an element (Esc to exit)">pick</button>
        <span class="count"></span>
      </span>
    </div>
  `;
  (document.body || document.documentElement).appendChild(host);

  const $ = <T extends Element>(sel: string) => shadow.querySelector(sel) as T;
  const outline = $<HTMLElement>('.outline');
  const tagLabel = $<HTMLElement>('.tag');
  const puck = $<HTMLButtonElement>('.puck');
  const copyBtn = $<HTMLButtonElement>('.copy');
  const exportBtn = $<HTMLButtonElement>('.export');
  const countBadge = $<HTMLElement>('.count');
  const panel = $<HTMLElement>('.panel');
  const pickLoc = $<HTMLElement>('.pick-loc');
  const msgInput = $<HTMLTextAreaElement>('.msg');
  const agentSelect = $<HTMLSelectElement>('.agent');
  const modeSelect = $<HTMLSelectElement>('.mode');
  const sendBtn = $<HTMLButtonElement>('.send');
  const logEl = $<HTMLElement>('.log');

  const locator = createLocator({ doc: document, win: window, locAttr: LOC_ATTR });

  // The live Queue/Session. Survives reloads via localStorage; "Copy all" and
  // "Export" read the whole queue, keeping the on-screen bubble numbers (1..n).
  const queue = createQueue({
    storage: window.localStorage,
    storageKey: QUEUE_KEY,
    selectionKey: SELECTION_KEY,
    defaultType: TYPES[0]!.id,
  });

  let picking = false;
  // The locked pick awaiting a Send: its loc (or null = none).
  let lockedLoc: string | null = null;

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

  // ---- Screenshot capture --------------------------------------------------
  // Full DOM-to-image is overkill for the tracer bullet, so we capture the
  // picked element's *bounding-rect region* as a self-describing SVG snapshot:
  // its on-page geometry, tag label, and loc, painted onto a rect the size of
  // the element. Serialized to a `data:image/svg+xml` URL it satisfies the
  // `screenshot` shape the Handoff builders expect — they inline it as an
  // <img> on Export (embedImages) and note it for paste on Copy. Later slices
  // can swap in a real raster capture without touching the handoff contract.
  const captureShot = (el: Element, label: string, loc: string): string => {
    const r = el.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const meta = `${label} · ${loc || 'unknown'} · ${w}×${h}`;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="rgba(198,242,78,0.10)" ` +
      `stroke="#c6f24e" stroke-width="1" rx="2"/>` +
      `<text x="6" y="16" font-family="ui-monospace, monospace" font-size="11" fill="#11141a">${esc(meta)}</text>` +
      `</svg>`;
    // btoa needs Latin-1; SVG text may carry Unicode, so encode via UTF-8.
    const b64 = btoa(unescape(encodeURIComponent(svg)));
    return `data:image/svg+xml;base64,${b64}`;
  };

  // ---- Queue UI sync -------------------------------------------------------
  const refreshBar = () => {
    const n = queue.count();
    copyBtn.disabled = n === 0;
    exportBtn.disabled = n === 0;
    countBadge.textContent = String(n);
    countBadge.style.display = n > 0 ? 'block' : 'none';
  };
  refreshBar();

  // The display number a handoff item carries — its 1-based queue position,
  // keeping markdown numbering aligned with the on-screen count.
  const numberOf = (a: any) => queue.indexOf(a) + 1;

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

  // ---- Send-to-Agent -------------------------------------------------------
  const log = (line: string) => {
    const div = document.createElement('div');
    div.textContent = line;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  };

  // Probe the Bridge for installed agents once; populate the agent picker. The
  // first installed agent is the default selection; Send stays disabled if none.
  let probed = false;
  const probeAgents = () => {
    if (probed) return;
    probed = true;
    fetch(`${bridgeBase}/__pointcut/agents`)
      .then((r) => (r.ok ? r.json() : { agents: [] }))
      .then((data: { agents?: Array<{ name: string }> }) => {
        const agents = data.agents || [];
        agentSelect.innerHTML = '';
        agents.forEach((a) => {
          const opt = document.createElement('option');
          opt.value = a.name;
          opt.textContent = a.name;
          agentSelect.appendChild(opt);
        });
        sendBtn.disabled = !lockedLoc || agents.length === 0;
      })
      .catch(() => {});
  };

  // Open the Send panel for a freshly locked pick: show its loc, offer Send.
  const lockPick = (loc: string | null) => {
    lockedLoc = loc;
    pickLoc.textContent = loc ? `pick: ${loc}` : 'pick: (no source stamp)';
    panel.classList.add('open');
    logEl.innerHTML = '';
    probeAgents();
    sendBtn.disabled = !lockedLoc || agentSelect.options.length === 0;
  };

  // POST the locked pick as an Annotation (markdown carrying the source loc +
  // the user's note) to the Bridge, then dispatch the NDJSON Action stream.
  const send = () => {
    if (!lockedLoc) return;
    const agent = agentSelect.value;
    if (!agent) return;
    const mode = (modeSelect.value || 'apply') as RunMode;
    const note = msgInput.value.trim();
    const markdown =
      `## Annotation 1\n- source: ${lockedLoc}\n` + (note ? `- request: ${note}\n` : '');
    sendBtn.disabled = true;
    logEl.innerHTML = '';
    log(`→ ${agent} (${mode})`);
    streamAgentRun(
      { agent, markdown, mode, images: [], resume: null },
      {
        onAction: (a: any) => {
          if (a.kind === 'text' && !a.delta) log(a.text);
          else if (a.kind === 'tool') log(`[${a.name}] ${a.file || a.command || ''}`.trim());
          else if (a.kind === 'result') log(a.ok ? '✓ done' : `✗ ${a.errorText || 'failed'}`);
        },
        onBridgeError: (m: string) => log(`error: ${m}`),
        onBridgeEnd: () => {},
        onStreamEnd: () => {
          sendBtn.disabled = false;
        },
        onError: (m: string) => {
          log(`request failed: ${m}`);
          sendBtn.disabled = false;
        },
      },
      // Same-origin auto-attach uses bare fetch; the sidecar prefixes the base URL.
      bridgeBase ? (url: string, init?: RequestInit) => fetch(bridgeBase + url, init) : undefined,
    );
  };

  // ---- Copy all / Export (no-Agent handoff) --------------------------------
  // Each queued pick doubles as a read-only context chip: same locator /
  // provenance signals (loc, tag, classList, screenshot) the chip builder
  // expects, telling the agent which on-page elements the handoff concerns.
  const chipFor = (a: any) => ({
    label: a.label,
    tag: a.tag,
    loc: a.loc,
    classList: a.classList || [],
    provenance: a.provenance || null,
    screenshot: a.screenshot,
  });

  // Emit paste-and-go markdown for the whole Queue/Session and write it to the
  // clipboard, followed by the context-chips block (read-only element refs).
  const copyAll = async () => {
    const items = queue.all();
    if (!items.length) return;
    const md = [
      buildHandoff(items, numberOf, /* embedImages */ false, TYPES),
      contextChipsBlock(items.map(chipFor)),
    ].join('\n\n');
    try {
      await navigator.clipboard.writeText(md);
      flash(copyBtn, 'Copied');
    } catch (_) {
      // Clipboard API can be blocked (insecure context / permissions): fall
      // back to a hidden textarea + execCommand so Copy all still works in dev.
      legacyCopy(md);
      flash(copyBtn, 'Copied');
    }
  };

  // Download the handoff with screenshots embedded (embedImages → each shot is
  // inlined as a data-URL <img>), so the file is self-contained.
  const exportAll = () => {
    const items = queue.all();
    if (!items.length) return;
    const md = buildHandoff(items, numberOf, /* embedImages */ true, TYPES);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pointcut-handoff-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    flash(exportBtn, 'Exported');
  };

  // Hidden-textarea clipboard fallback for non-secure dev contexts.
  const legacyCopy = (text: string) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    (document.body || document.documentElement).appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (_) {}
    ta.remove();
  };

  // Brief button label swap as success feedback, then restore.
  const flash = (btn: HTMLButtonElement, msg: string) => {
    const prev = btn.textContent;
    btn.textContent = msg;
    setTimeout(() => {
      btn.textContent = prev;
    }, 1200);
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

  // Click locks the pick: resolve to the nearest stamped ancestor, capture it
  // as an Annotation (loc + label + path + screenshot) into the Queue, and open
  // the Send panel for it. The loc line in the panel jumps to source on click.
  const onClick = (e: MouseEvent) => {
    if (!picking) return;
    const target = e.composedPath()[0] as Element;
    if (isOwn(target)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = locator.stampedAncestor(target);
    const loc = (el.getAttribute ? el.getAttribute(LOC_ATTR) : null) || '';
    const label = labelFor(el);
    const classList =
      typeof el.className === 'string' && el.className.trim() ? el.className.trim().split(/\s+/) : [];

    queue.add({
      id: queue.newId(),
      type: TYPES[0]!.id,
      label,
      loc,
      comment: '', // tracer bullet captures the pick; the change note is a later slice
      path: locator.indexPath(el),
      outerHTML: el.outerHTML || '',
      screenshot: captureShot(el, label, loc),
      // Locator/provenance signals reused to render this pick as a context chip.
      tag: el.tagName.toLowerCase(),
      classList,
    });
    refreshBar();

    lockPick(loc || null);
    setPicking(false);
  };

  puck.addEventListener('click', (e) => {
    e.stopPropagation();
    setPicking(!picking);
  });
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void copyAll();
  });
  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportAll();
  });
  sendBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    send();
  });
  // The loc line jumps to source — the #4 tracer-bullet path, still available.
  pickLoc.addEventListener('click', (e) => {
    e.stopPropagation();
    openInEditor(lockedLoc);
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
