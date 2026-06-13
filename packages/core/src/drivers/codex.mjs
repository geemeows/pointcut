/* eslint-disable */
// Design Toolbar — Codex Driver.
//
// Best-effort adapter for `codex exec --json`. Unlike Claude, Codex takes images
// natively (-i <path>), uses `--sandbox workspace-write` (the analog of Claude's
// acceptEdits), and resumes a thread with `codex exec resume <id>`.
//
// Verified against codex-cli 0.136.0 `exec --json`: thread.started{thread_id},
// item.completed{item:{type:'agent_message',text}}, turn.completed. The
// command_execution / file_change item types below are still best-effort (a
// trivial probe emitted no tool items) — confirm their shape on a run that edits
// files, and adjust if the item.type / field names differ.
import { directiveForMode, isWriteMode } from './shared.mjs';

// Normalize one `codex exec --json` JSONL event into zero or more Actions —
// the same vocabulary every Driver emits (session / text / tool / result).
export const interpretCodexEvent = (e) => {
  if (!e || !e.type) return [];
  const t = e.type;

  // Thread/session id — emitted once at the start; the resume key for the next Turn.
  if (t === 'thread.started' || t === 'session.created' || t === 'session_configured') {
    const id = e.thread_id || e.session_id || (e.session && e.session.id) || null;
    return id ? [{ kind: 'session', id: String(id) }] : [];
  }

  // Completed items carry the agent's prose, shell runs, and file edits.
  if (t === 'item.completed' && e.item) {
    const it = e.item;
    if ((it.type === 'assistant_message' || it.type === 'agent_message') && (it.text || it.message)) {
      const text = String(it.text || it.message).trim();
      return text ? [{ kind: 'text', text }] : [];
    }
    if (it.type === 'command_execution' || it.type === 'local_shell_call' || it.type === 'exec_command') {
      return [{ kind: 'tool', name: 'Bash', file: null, command: it.command || it.cmd || null }];
    }
    if (it.type === 'file_change' || it.type === 'patch' || it.type === 'apply_patch') {
      const changes = it.changes || it.files || [];
      const file = (changes[0] && (changes[0].path || changes[0].file)) || it.path || null;
      return [{ kind: 'tool', name: 'Edit', file, command: null }];
    }
    return [];
  }

  // Turn end — success or failure.
  if (t === 'turn.completed') return [{ kind: 'result', ok: true }];
  if (t === 'turn.failed' || t === 'error') {
    const errorText = e.message || (e.error && (e.error.message || String(e.error))) || null;
    return [{ kind: 'result', ok: false, errorText: errorText ? String(errorText) : null }];
  }
  return [];
};

// Codex reads images natively (-i), so the prompt is just the handoff + directive.
const buildPrompt = (markdown, mode) => [markdown.trim(), directiveForMode(mode)].join('\n\n');

export const codex = {
  command: 'codex',
  // Picker options (grouped under "codex"), passed via -m. EDIT THIS to whatever
  // your codex install accepts — these slugs are best-effort and vary by version
  // (codex didn't pin one in config). `codex -m <slug>` errors loudly if wrong.
  models: [
    { label: 'GPT-5.1 Codex', value: 'gpt-5.1-codex' },
    { label: 'GPT-5.1 Codex Mini', value: 'gpt-5.1-codex-mini' },
    { label: 'GPT-5 Codex', value: 'gpt-5-codex' },
    { label: 'GPT-5', value: 'gpt-5' },
    { label: 'o3', value: 'o3' },
    { label: 'o4-mini', value: 'o4-mini' },
  ],
  // Sandbox follows the turn's mode: apply/apply-once → workspace-write (the
  // analog of Claude's acceptEdits); discuss → read-only so it cannot edit.
  buildArgs({ markdown, shots, resume, model, mode }) {
    const args = ['exec'];
    if (resume) args.push('resume', String(resume)); // codex exec resume <id> …
    args.push('--json', '--sandbox', isWriteMode(mode) ? 'workspace-write' : 'read-only');
    if (model) args.push('-m', String(model));
    // The prompt positional MUST precede -i: --image is variadic (<FILE>...), so
    // a prompt after it gets swallowed as another image path (codex then looks
    // for the prompt on stdin and fails).
    args.push(buildPrompt(markdown, mode));
    shots.forEach(({ file }) => args.push('-i', file)); // images passed natively
    return args;
  },
  parse: interpretCodexEvent,
};
