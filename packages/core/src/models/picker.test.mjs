/* eslint-disable */
// Run: node --import tsx --test src/models/picker.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createPicker } from './picker.mjs';

describe('format / parse round-trip', () => {
  test('encodes "agent:model"', () => {
    const p = createPicker();
    assert.equal(p.format('claude', 'opus'), 'claude:opus');
  });

  test('empty model encodes to a trailing colon (CLI default)', () => {
    const p = createPicker();
    assert.equal(p.format('claude', ''), 'claude:');
    assert.equal(p.format('claude', null), 'claude:');
    assert.equal(p.format('claude', undefined), 'claude:');
  });

  test('parse splits on the first colon', () => {
    const p = createPicker();
    assert.deepEqual(p.parse('claude:opus'), { agent: 'claude', model: 'opus' });
  });

  test('parse keeps later colons inside the model string', () => {
    const p = createPicker();
    assert.deepEqual(p.parse('codex:gpt-5:high'), { agent: 'codex', model: 'gpt-5:high' });
  });

  test('parse of "agent:" yields an empty model (CLI default)', () => {
    const p = createPicker();
    assert.deepEqual(p.parse('claude:'), { agent: 'claude', model: '' });
  });

  test('parse of an agent-only value (no colon) yields an empty model', () => {
    const p = createPicker();
    assert.deepEqual(p.parse('claude'), { agent: 'claude', model: '' });
  });

  test('round-trips: format(parse(v)) === v for colon-bearing values', () => {
    const p = createPicker();
    for (const v of ['claude:opus', 'claude:', 'codex:gpt-5:high']) {
      const { agent, model } = p.parse(v);
      assert.equal(p.format(agent, model), v);
    }
  });
});

describe('applyAgents seed', () => {
  test('seeds default selection from the first agent + first model', () => {
    const p = createPicker();
    const seed = p.applyAgents([
      { name: 'claude', models: [{ label: 'Opus', value: 'opus' }, { label: 'Sonnet', value: 'sonnet' }] },
      { name: 'codex', models: [{ label: 'GPT-5', value: 'gpt-5' }] },
    ]);
    assert.equal(seed.agent, 'claude');
    assert.equal(seed.model, 'opus');
    assert.equal(seed.label, 'Opus');
    assert.equal(seed.total, 3);
    assert.equal(seed.hasChoice, true);
    assert.equal(p.getSelectedAgent(), 'claude');
    assert.equal(p.getSelectedModel(), 'opus');
    assert.equal(p.getSelectedLabel(), 'Opus');
  });

  test('an agent with no models gets a synthetic Default row (empty value)', () => {
    const p = createPicker();
    const seed = p.applyAgents([{ name: 'claude' }]);
    assert.equal(seed.agent, 'claude');
    assert.equal(seed.model, '');
    assert.equal(seed.label, 'Default');
    assert.equal(seed.total, 1);
    assert.equal(seed.hasChoice, false); // single model → no inline combobox
  });

  test('empty / non-array probe → no agent', () => {
    const p = createPicker();
    const seed = p.applyAgents([]);
    assert.equal(seed.agent, null);
    assert.equal(seed.model, '');
    assert.equal(seed.label, 'No agent');
    assert.equal(seed.total, 0);
    assert.equal(seed.hasChoice, false);

    const seed2 = p.applyAgents(null);
    assert.equal(seed2.agent, null);
    assert.deepEqual(p.getAgents(), []);
  });

  test('total counts models across agents; hasChoice true at > 1', () => {
    const p = createPicker();
    const seed = p.applyAgents([{ name: 'a' }, { name: 'b' }]); // two synthetic defaults
    assert.equal(seed.total, 2);
    assert.equal(seed.hasChoice, true);
  });
});

describe('select intent (decoded form)', () => {
  const fresh = () => {
    const p = createPicker();
    p.applyAgents([
      { name: 'claude', models: [{ label: 'Opus', value: 'opus' }, { label: 'Sonnet', value: 'sonnet' }] },
      { name: 'codex', models: [{ label: 'GPT-5', value: 'gpt-5' }] },
    ]);
    return p;
  };

  test('switching agent reports agentChanged + resets session + reloads skills', () => {
    const p = fresh(); // selected: claude/opus
    const intent = p.select('codex', 'gpt-5', 'GPT-5');
    assert.equal(intent.agent, 'codex');
    assert.equal(intent.model, 'gpt-5');
    assert.equal(intent.label, 'GPT-5');
    assert.equal(intent.agentChanged, true);
    assert.equal(intent.resetSession, true);
    assert.equal(intent.reloadSkills, true);
    assert.equal(p.getSelectedAgent(), 'codex');
    assert.equal(p.getSelectedModel(), 'gpt-5');
  });

  test('switching model within the same agent: agentChanged false, but effects still fire (behaviour-preserving)', () => {
    const p = fresh(); // selected: claude/opus
    const intent = p.select('claude', 'sonnet', 'Sonnet');
    assert.equal(intent.agentChanged, false);
    // The client fires both effects on every pick today, so the intent keeps them true.
    assert.equal(intent.resetSession, true);
    assert.equal(intent.reloadSkills, true);
  });
});

describe('select intent (wire-value form)', () => {
  test('select(value, label) decodes and applies', () => {
    const p = createPicker();
    p.applyAgents([{ name: 'claude', models: [{ label: 'Opus', value: 'opus' }] }]);
    const intent = p.select('codex:gpt-5:high', 'GPT-5 High');
    assert.equal(intent.agent, 'codex');
    assert.equal(intent.model, 'gpt-5:high');
    assert.equal(intent.label, 'GPT-5 High');
    assert.equal(intent.agentChanged, true);
    assert.equal(p.getValue(), 'codex:gpt-5:high');
  });
});

describe('getters', () => {
  test('isSelected + getValue track the current selection', () => {
    const p = createPicker();
    p.applyAgents([{ name: 'claude', models: [{ label: 'Opus', value: 'opus' }] }]);
    assert.equal(p.getValue(), 'claude:opus');
    assert.equal(p.isSelected('claude', 'opus'), true);
    assert.equal(p.isSelected('claude', 'sonnet'), false);
    assert.equal(p.isSelected('codex', 'opus'), false);
  });

  test('modelsOf falls back to a single Default row', () => {
    const p = createPicker();
    assert.deepEqual(p.modelsOf({ name: 'x' }), [{ label: 'Default', value: '' }]);
    assert.deepEqual(p.modelsOf({ name: 'x', models: [{ label: 'M', value: 'm' }] }), [{ label: 'M', value: 'm' }]);
  });
});
