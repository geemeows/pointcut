/* eslint-disable */
// Design Toolbar — Cursor Driver.
//
// Adapter for `cursor-agent` headless (`-p --output-format stream-json --force`),
// exactly like the claude/codex drivers. Two things set it apart (see ADR-0001):
//   - models is a FUNCTION, not an array: the picker is fed live from
//     `cursor-agent models` (the developer's actual account entitlements) rather
//     than a list we maintain. The Bridge awaits it and caches the result.
//   - tool calls arrive as their own `tool_call` events (key e.g. `readToolCall`),
//     not as `tool_use` blocks inside the assistant message like Claude.
// Everything else — session id, assistant prose, result — mirrors Claude's
// stream-json, so it flows through the generic Action plumbing unchanged.
import { spawn } from 'child_process';
import { directiveForMode, isWriteMode } from './shared.mjs';

// Normalize one cursor-agent stream-json event into zero or more Actions —
// the same vocabulary every Driver emits (session / text / tool / result).
export const interpretCursorEvent = (e) => {
  if (!e || !e.type) return [];
  if (e.type === 'system' && e.subtype === 'init') {
    return e.session_id ? [{ kind: 'session', id: String(e.session_id) }] : [];
  }
  // Assistant prose — cursor mirrors Claude's content-array shape (text only;
  // tool use is a separate event below). Under --stream-partial-output, prose
  // arrives as token deltas (each carrying a `timestamp_ms`) followed by a final
  // consolidated block (no timestamp). Deltas are marked delta:true so the client
  // accumulates them into one line; the consolidated block finalizes it with the
  // authoritative full text. Without the flag, a single block arrives (no
  // timestamp) and is emitted as complete — so dropping the flag still works.
  if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
    const text = e.message.content
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('');
    if (e.timestamp_ms != null) return text ? [{ kind: 'text', text, delta: true }] : [];
    return text.trim() ? [{ kind: 'text', text: text.trim() }] : [];
  }
  // Tool calls are their own events. The single key under `tool_call` names the
  // tool (readToolCall, editToolCall, shellToolCall, …). Emit once, on 'started';
  // the matching 'completed' only repeats it with the result attached.
  if (e.type === 'tool_call' && e.subtype === 'started' && e.tool_call) {
    const key = Object.keys(e.tool_call)[0] || '';
    const args = (e.tool_call[key] && e.tool_call[key].args) || {};
    const name = key ? key.replace(/ToolCall$/, '') : 'tool';
    return [
      {
        kind: 'tool',
        name: name.charAt(0).toUpperCase() + name.slice(1),
        file: args.path || args.relativePath || args.file || null,
        command: args.command || args.cmd || null,
      },
    ];
  }
  if (e.type === 'result') {
    if (e.is_error || e.subtype !== 'success') {
      return [{ kind: 'result', ok: false, errorText: e.result ? String(e.result) : null }];
    }
    return [{ kind: 'result', ok: true }];
  }
  return [];
};

// Compose the prompt: the toolbar's markdown handoff, then the directive.
const buildPrompt = (markdown, mode) => [markdown.trim(), directiveForMode(mode)].join('\n\n');

// The picker falls back to a single Auto entry when the CLI can't answer (offline
// / not logged in), so Cursor stays usable rather than vanishing from the picker.
const FALLBACK_MODELS = [{ label: 'Auto', value: 'auto' }];

// Parse `cursor-agent models` stdout — lines like "gpt-5.2 - GPT-5.2". The
// "Available models" header has no " - " so it's skipped.
export const parseCursorModels = (stdout) => {
  const models = [];
  String(stdout)
    .split('\n')
    .forEach((line) => {
      const m = line.match(/^(\S+)\s+-\s+(.+)$/);
      if (m) models.push({ value: m[1], label: m[2].trim() });
    });
  return models;
};

// Resolve the developer's actual Cursor entitlements live (ADR-0001). Never
// rejects: any failure resolves to FALLBACK_MODELS.
const discoverModels = () =>
  new Promise((resolve) => {
    let done = false;
    const finish = (models) => {
      if (!done) {
        done = true;
        resolve(models);
      }
    };
    try {
      let out = '';
      const child = spawn('cursor-agent', ['models'], { stdio: ['ignore', 'pipe', 'ignore'] });
      child.stdout.on('data', (c) => {
        out += c;
      });
      child.on('error', () => finish(FALLBACK_MODELS));
      child.on('close', () => {
        const models = parseCursorModels(out);
        finish(models.length ? models : FALLBACK_MODELS);
      });
    } catch (_) {
      finish(FALLBACK_MODELS);
    }
  });

export const cursor = {
  command: 'cursor-agent',
  // A function, not an array — resolved + cached by the Bridge's /__pointcut/agents
  // (ADR-0001). The first entry (Auto) is the default picker selection.
  models: discoverModels,
  // --force allows commands unless explicitly denied (the analog of Claude's
  // acceptEdits) — added only in a write mode (apply/apply-once); discuss omits
  // it so cursor-agent won't edit. stream-json under -p emits the incremental
  // events. A resume chat id continues the conversation — it shares history with
  // the Cursor app.
  buildArgs({ markdown, resume, model, mode }) {
    const args = [
      '-p', buildPrompt(markdown, mode),
      '--output-format', 'stream-json',
    ];
    if (isWriteMode(mode)) args.push('--force');
    args.push('--stream-partial-output'); // stream assistant prose token-by-token
    if (model) args.push('--model', String(model));
    if (resume) args.push('--resume', String(resume));
    return args;
  },
  parse: interpretCursorEvent,
};
