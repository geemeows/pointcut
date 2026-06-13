/* eslint-disable */
// Design Toolbar — Claude Driver.
//
// One of the pluggable coding-agent adapters. A Driver owns three things:
//   - command:         the CLI to spawn
//   - buildArgs(turn):  the argv for one Turn (prompt + flags + resume)
//   - parse(event):     normalize one native CLI event into Actions
// `interpretClaudeEvent` (the parser) and its tests moved here from the client
// (the old claude-run.mjs) when the toolbar went agent-agnostic — see the ADR.
import { directiveForMode, isWriteMode } from './shared.mjs';

// Normalize one CLI stream-json event into zero or more Actions:
//   { kind:'session', id }
//   { kind:'text', text }
//   { kind:'tool', name, file, command }   // file/command may be null
//   { kind:'result', ok:true }
//   { kind:'result', ok:false, errorText }  // errorText may be null
// An assistant message can carry several content items, hence an array.
export const interpretClaudeEvent = (e) => {
  if (!e || !e.type) return [];
  if (e.type === 'system' && e.subtype === 'init') {
    return e.session_id ? [{ kind: 'session', id: e.session_id }] : [];
  }
  // Incremental text under --include-partial-messages: each content_block_delta
  // carries one token. Marked delta:true so the client accumulates them into a
  // single line; the final `assistant` message below then finalizes that line
  // with the authoritative full text (so dropping the flag still works).
  if (e.type === 'stream_event' && e.event && e.event.type === 'content_block_delta') {
    const d = e.event.delta;
    return d && d.type === 'text_delta' && d.text ? [{ kind: 'text', text: d.text, delta: true }] : [];
  }
  if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
    const out = [];
    e.message.content.forEach((c) => {
      if (c.type === 'text' && c.text && c.text.trim()) {
        out.push({ kind: 'text', text: c.text.trim() });
      } else if (c.type === 'tool_use') {
        const inp = c.input || {};
        out.push({
          kind: 'tool',
          name: c.name,
          file: inp.file_path || inp.path || null,
          command: inp.command || null,
        });
      }
    });
    return out;
  }
  if (e.type === 'result') {
    if (e.is_error || e.subtype !== 'success') {
      return [{ kind: 'result', ok: false, errorText: e.result ? String(e.result) : null }];
    }
    return [{ kind: 'result', ok: true }];
  }
  return [];
};

// Compose the prompt: the toolbar's markdown handoff, the screenshot file list
// (Claude reads images from the paths named in the prompt), then the directive.
const buildPrompt = (markdown, shots, mode) => {
  const parts = [markdown.trim()];
  if (shots.length) {
    parts.push(
      '## Screenshots\n' +
        shots.map(({ n, file }) => `- Item ${n}: ${file}`).join('\n') +
        '\n\nRead each screenshot above to see the actual rendered element.',
    );
  }
  parts.push(directiveForMode(mode));
  return parts.join('\n\n');
};

export const claude = {
  command: 'claude',
  // Picker options (grouped under "claude"), passed via --model. The first entry
  // is the default selection (Opus 4.8). Confirmed ids: opus-4-8, sonnet-4-6,
  // haiku-4-5, fable-5. The 4.7/4.6 ids are best-effort — edit here if your
  // install rejects one.
  models: [
    { label: 'Opus 4.8', value: 'claude-opus-4-8' },
    { label: 'Opus 4.7', value: 'claude-opus-4-7' },
    { label: 'Opus 4.6', value: 'claude-opus-4-6' },
    { label: 'Sonnet 4.6', value: 'claude-sonnet-4-6' },
    { label: 'Haiku 4.5', value: 'claude-haiku-4-5-20251001' },
    { label: 'Fable 5', value: 'claude-fable-5' },
  ],
  // Permission posture follows the turn's mode: apply/apply-once → acceptEdits
  // (applies file edits without prompting); discuss → plan (Claude proposes but
  // writes nothing in a --print run). cwd is the project root so the repo is in
  // scope. stream-json + --verbose is the only combo that emits incremental
  // events under --print. A resume session id continues the conversation.
  buildArgs({ markdown, shots, resume, model, mode }) {
    const args = [
      '-p', buildPrompt(markdown, shots, mode),
      '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', // stream assistant prose token-by-token
      '--permission-mode', isWriteMode(mode) ? 'acceptEdits' : 'plan',
    ];
    if (model) args.push('--model', String(model));
    if (resume) args.push('--resume', String(resume));
    return args;
  },
  parse: interpretClaudeEvent,
};
