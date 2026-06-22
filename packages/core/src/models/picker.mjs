/* eslint-disable */
// Agent + model picker — pure selection model, lifted from the client (issue #5).
//
// The picker is the single place a coding-agent name appears (everything else
// stays agent-agnostic). It owns:
//   - the "agent:model" wire encode/decode (`format`/`parse`) used by both the
//     chat-composer combobox and the gear "Default model" flyout — logic that
//     lived inline, duplicated twice (`v.indexOf(':')`) in the client;
//   - the agent/model catalog (`availableAgents`) seeded from the
//     `/__pointcut/agents` probe, plus the current selection (agent/model/label).
//
// It is PURE: numbers/plain-objects in, plain-objects out. NO chat, NO Bridge,
// NO DOM. `select()` mutates the model's own selection and RETURNS an intent
// describing what changed; the CLIENT fires the effects (chat.setSession(null),
// loadSkills, re-render the two comboboxes). `applyAgents()` likewise mutates the
// catalog + default selection and returns a seed result the client renders from.
//
//   agent  = { name, models?: [{ label, value }] }   (value '' = CLI default)
//   model  = '' means "the agent's default model"

// A factory (not namespace exports) because the picker owns mutable selection
// state — mirrors createX siblings, but takes NO deps (it performs no effects).
export const createPicker = () => {
  let availableAgents = [];
  let selectedAgent = null;
  let selectedModel = '';
  let selectedLabel = 'No agent';

  // An agent's model rows, defaulting to a single "Default" ('' value) row when
  // the probe reported no explicit models. Matches the client's `modelsOf`.
  const modelsOf = (ag) => (ag && ag.models && ag.models.length ? ag.models : [{ label: 'Default', value: '' }]);

  return {
    // ---- encode / decode -------------------------------------------------
    // Encode a selection to the combobox wire value. Always "agent:model"; an
    // empty model yields a trailing ':' ("claude:") meaning the CLI default.
    format: (agent, model) => `${agent}:${model == null ? '' : model}`,

    // Decode a wire value back to { agent, model }. Splits on the FIRST ':'
    // (model strings may themselves contain ':'). A value with no ':' is treated
    // as agent-only (model ''), matching the client's indexOf-based slice intent.
    parse: (value) => {
      const v = String(value == null ? '' : value);
      const i = v.indexOf(':');
      if (i === -1) return { agent: v, model: '' };
      return { agent: v.slice(0, i), model: v.slice(i + 1) };
    },

    // ---- catalog seed ----------------------------------------------------
    // Seed the catalog + default selection from the /__pointcut/agents probe
    // (`probeAgents` is the `.agents` array; non-array → empty). Picks the first
    // agent's first model as the default. Returns the seed the client renders:
    //   { agent, model, label, total, hasChoice, agents }
    // `total` is the model count across all agents; `hasChoice` (> 1) gates the
    // inline composer combobox's visibility (the client also forces-show for any
    // picker with alwaysShow). `agent` is the agent name to prime loadSkills with.
    applyAgents: (probeAgents) => {
      availableAgents = Array.isArray(probeAgents) ? probeAgents : [];
      const first = availableAgents[0];
      selectedAgent = first ? first.name : null;
      selectedModel = first ? modelsOf(first)[0].value : '';
      selectedLabel = first ? modelsOf(first)[0].label : 'No agent';
      const total = availableAgents.reduce((n, ag) => n + modelsOf(ag).length, 0);
      return {
        agent: selectedAgent,
        model: selectedModel,
        label: selectedLabel,
        total,
        hasChoice: total > 1,
        agents: availableAgents,
      };
    },

    // ---- selection -------------------------------------------------------
    // Commit a selection and return an INTENT describing the change. Accepts
    // either a decoded (agent, model, label) triple or a single wire value
    // (select(value, label)) — the client passes the decoded form today.
    //
    // The intent reports `agentChanged` (the new agent differs from the prior
    // one) alongside `resetSession`/`reloadSkills`. Today the client fires both
    // effects UNCONDITIONALLY on every pick, so to preserve behaviour exactly
    // both default to `true` here regardless of `agentChanged`. A caller that
    // wants the spec's "only when the agent changed" gating can read
    // `agentChanged` instead — but that is a deliberate behaviour change.
    select: (agentOrValue, model, label) => {
      let agent, nextModel, nextLabel;
      if (label === undefined) {
        // Wire-value form: select(value, label) — split on the first ':'.
        const v = String(agentOrValue == null ? '' : agentOrValue);
        const i = v.indexOf(':');
        agent = i === -1 ? v : v.slice(0, i);
        nextModel = i === -1 ? '' : v.slice(i + 1);
        nextLabel = model;
      } else {
        // Decoded form: select(agent, model, label) — what the client passes.
        agent = agentOrValue;
        nextModel = model;
        nextLabel = label;
      }
      const agentChanged = agent !== selectedAgent;
      selectedAgent = agent;
      selectedModel = nextModel;
      selectedLabel = nextLabel;
      return {
        agent,
        model: nextModel,
        label: nextLabel,
        agentChanged,
        // Behaviour-preserving: the client resets the session + reloads skills on
        // every pick today.
        resetSession: true,
        reloadSkills: true,
      };
    },

    // ---- getters ---------------------------------------------------------
    modelsOf,
    getAgents: () => availableAgents,
    getSelectedAgent: () => selectedAgent,
    getSelectedModel: () => selectedModel,
    getSelectedLabel: () => selectedLabel,
    // The selection as a wire value, e.g. for marking the active option.
    getValue: () => `${selectedAgent}:${selectedModel}`,
    // True when an option's (agent, model) is the current selection — the client
    // uses this to add the `.sel` class while building both menus.
    isSelected: (agent, model) => agent === selectedAgent && model === selectedModel,
  };
};
