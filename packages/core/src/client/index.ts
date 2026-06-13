// @pointcut/core/client — the in-page toolbar (browser ESM).
//
// Injected in design mode only. Renders into a Shadow DOM (vanilla, no
// framework). Reaches the Bridge via a base URL stamped at build time:
// empty for same-origin auto-attach, http://localhost:<port> for the sidecar.
//
// Builds on the #4 tracer-bullet slice (`data-luciq-loc` → `data-pointcut-loc`,
// `/__luciq_open` → `/__pointcut/open`): the hover/lock Pick path and
// jump-to-source stay, and #5 adds the send-to-Agent loop — a Send button and a
// run-mode selector (apply / apply-once / discuss) that POST the locked pick as
// an Annotation to the Bridge's agent-run endpoint and consume its NDJSON Action
// stream. The drawer, chat, and introspection panels arrive in later slices.
import { createLocator } from '../models/locator.mjs';
import { streamAgentRun } from '../models/agent-run.mjs';

/** The run mode — sets the chosen agent's permission posture (mirrors AgentMode). */
type RunMode = 'apply' | 'apply-once' | 'discuss';

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
      .puck {
        position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
        width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer;
        background: #2a2c2f; color: #e7e9ee; font: 600 11px/1 ui-sans-serif, system-ui;
        box-shadow: 0 6px 20px rgba(0,0,0,.4);
      }
      .puck.on { background: #c6f24e; color: #11141a; }
      .panel {
        position: fixed; right: 16px; bottom: 64px; z-index: 2147483647; display: none;
        width: 280px; padding: 12px; border-radius: 10px; background: #1b1d21; color: #e7e9ee;
        font: 12px/1.45 ui-sans-serif, system-ui; box-shadow: 0 6px 20px rgba(0,0,0,.4);
      }
      .panel.open { display: block; }
      .panel .pick-loc { font: 11px/1.4 ui-monospace, monospace; color: #c6f24e; word-break: break-all; margin-bottom: 8px; }
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
    <button class="puck" title="Pick an element (Esc to exit)">pick</button>
  `;
  (document.body || document.documentElement).appendChild(host);

  const $ = <T extends Element>(sel: string) => shadow.querySelector(sel) as T;
  const outline = $<HTMLElement>('.outline');
  const tagLabel = $<HTMLElement>('.tag');
  const puck = $<HTMLButtonElement>('.puck');
  const panel = $<HTMLElement>('.panel');
  const pickLoc = $<HTMLElement>('.pick-loc');
  const msgInput = $<HTMLTextAreaElement>('.msg');
  const agentSelect = $<HTMLSelectElement>('.agent');
  const modeSelect = $<HTMLSelectElement>('.mode');
  const sendBtn = $<HTMLButtonElement>('.send');
  const logEl = $<HTMLElement>('.log');

  const locator = createLocator({ doc: document, win: window, locAttr: LOC_ATTR });

  let picking = false;
  // The locked pick awaiting a Send: its loc and a short label (or null = none).
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

  // Open the panel for a freshly locked pick: show its loc, offer Send.
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

  // Click locks the pick: resolve to the nearest stamped ancestor, then open the
  // Send panel for it (the loc is also clickable to jump to source).
  const onClick = (e: MouseEvent) => {
    if (!picking) return;
    const target = e.composedPath()[0] as Element;
    if (isOwn(target)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = locator.stampedAncestor(target);
    lockPick(el.getAttribute ? el.getAttribute(LOC_ATTR) : null);
    setPicking(false);
  };

  puck.addEventListener('click', (e) => {
    e.stopPropagation();
    setPicking(!picking);
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
