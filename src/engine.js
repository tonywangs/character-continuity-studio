import { validateStory } from './validate.js';
import { LIMITS } from './limits.js';

export function createModel(story) {
  // Copy so author-side mutation cannot change a running model.
  const data = JSON.parse(JSON.stringify(validateStory(story)));
  const scenes = new Map(data.scenes.map(s => [s.id, s]));
  const indices = new Map(data.variables.map((v, i) => [v.id, i]));
  function evaluate(expr, state) {
    if (expr === undefined) return true;
    if (typeof expr === 'boolean') return expr;
    if (expr.all) return expr.all.every(e => evaluate(e, state));
    if (expr.any) return expr.any.some(e => evaluate(e, state));
    if (expr.not !== undefined) return !evaluate(expr.not, state);
    if (expr.scene !== undefined) return expr.scene === state.scene;
    const v = state.values[indices.get(expr.var)];
    switch (expr.op) {
      case 'eq': return v === expr.value;
      case 'ne': return v !== expr.value;
      case 'lt': return v < expr.value;
      case 'le': return v <= expr.value;
      case 'gt': return v > expr.value;
      case 'ge': return v >= expr.value;
    }
  }
  function explain(expr, state) {
    if (expr === undefined || expr === true) return 'Always available.';
    if (expr === false) return 'Author disabled this choice.';
    if (expr.all || expr.any) {
      const kind = expr.all ? 'All required' : 'At least one required';
      return `${kind}: (${(expr.all || expr.any).map(e => explain(e, state)).join('; ')})`;
    }
    if (expr.not !== undefined) return `Must be false: (${explain(expr.not, state)})`;
    if (expr.scene !== undefined) return `Scene must be ${expr.scene}; current scene is ${state.scene}.`;
    const i = indices.get(expr.var);
    const op = { eq: '=', ne: '≠', lt: '<', le: '≤', gt: '>', ge: '≥' }[expr.op];
    return `${data.variables[i].label} ${op} ${JSON.stringify(expr.value)}; now ${JSON.stringify(state.values[i])} (${evaluate(expr, state) ? 'met' : 'not met'}).`;
  }
  function initial() { return { scene: data.start, values: data.variables.map(v => v.initial) }; }
  function choices(state) {
    return scenes.get(state.scene).choices.map(c => ({ ...c, available: evaluate(c.when, state), reason: explain(c.when, state) }));
  }
  function step(state, id) {
    const scene = scenes.get(state.scene);
    const c = scene?.choices.find(c => c.id === id);
    if (!c || scene.ending) throw new Error(`Choice ${id} does not exist at ${state.scene}`);
    if (!evaluate(c.when, state)) throw new Error(`Choice ${id} is unavailable: ${explain(c.when, state)}`);
    const values = [...state.values];
    const changes = [];
    for (const e of c.effects) {
      const i = indices.get(e.var);
      if (values[i] !== e.value) changes.push({ variable: e.var, before: values[i], after: e.value });
      values[i] = e.value;
    }
    return { state: { scene: c.to, values }, changes };
  }
  function violations(state) {
    return data.invariants.filter(inv => evaluate(inv.when, state) && !evaluate(inv.assert, state))
      .map(inv => ({ id: inv.id, message: inv.message, reason: explain(inv.assert, state) }));
  }
  function replay(ids, { trace = false } = {}) {
    if (!Array.isArray(ids) || ids.length > LIMITS.history) throw new Error(`History exceeds ${LIMITS.history} choices`);
    let state = initial();
    const steps = [];
    for (const id of ids) {
      if (typeof id !== 'string' || id.length > LIMITS.id) throw new Error('Invalid choice identifier in history');
      const from = state.scene;
      const next = step(state, id);
      state = next.state;
      if (trace) steps.push({ choice: id, from, to: state.scene, changes: next.changes });
    }
    return { state, steps };
  }
  return { story: data, scenes, evaluate, explain, initial, choices, step, violations, replay };
}

export function stateKey(state) { return JSON.stringify([state.scene, ...state.values]); }
