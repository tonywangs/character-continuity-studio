import { LIMITS } from './limits.js';
import { stateKey } from './engine.js';

export function searchOptions(options = {}) {
  const result = {};
  for (const [key, max] of [['maxStates', LIMITS.states], ['maxTransitions', LIMITS.transitions], ['maxFindings', LIMITS.findings], ['maxMilliseconds', LIMITS.milliseconds], ['maxDepth', LIMITS.history]]) {
    const v = options[key] ?? max;
    if (!Number.isSafeInteger(v) || v < (key === 'maxDepth' ? 0 : 1) || v > max) throw new Error(`${key} must be an integer in ${key === 'maxDepth' ? 0 : 1}–${max}`);
    result[key] = v;
  }
  return result;
}

/** Breadth-first exploration. Parent pointers retain shortest witnesses without
 * expanding a path for every state. Invariants are observations, not pruning. */
export async function explore(model, options = {}) {
  const limits = searchOptions(options);
  const now = options.now ?? (() => performance.now());
  const startTime = now();
  const nodes = [{ state: model.initial(), parent: null, choice: null, depth: 0 }];
  const visited = new Map([[stateKey(nodes[0].state), 0]]);
  const findings = [];
  const reached = new Set([nodes[0].state.scene]);
  const reasons = new Set();
  let transitions = 0;
  let processed = 0;
  let halted = false;
  for (let cursor = 0; cursor < nodes.length; cursor++) {
    if (options.signal?.aborted) { reasons.add('cancelled'); break; }
    if (now() - startTime >= limits.maxMilliseconds) { reasons.add('time limit'); break; }
    const node = nodes[cursor];
    for (const violation of model.violations(node.state)) {
      if (findings.length >= limits.maxFindings) { reasons.add('finding limit'); halted = true; break; }
      findings.push({ kind: 'invariant', node: cursor, invariant: violation.id, message: violation.message });
    }
    if (halted) break;
    const choices = model.choices(node.state).filter(c => c.available);
    if (!model.scenes.get(node.state.scene).ending && choices.length === 0) {
      if (findings.length >= limits.maxFindings) { reasons.add('finding limit'); break; }
      findings.push({ kind: 'dead-end', node: cursor, message: 'Nonterminal scene has no available choice.' });
    }
    processed++;
    for (const choice of choices) {
      if (transitions >= limits.maxTransitions) { reasons.add('transition limit'); halted = true; break; }
      transitions++;
      const state = model.step(node.state, choice.id).state;
      const key = stateKey(state);
      if (!visited.has(key)) {
        if (node.depth >= limits.maxDepth) { reasons.add('depth limit'); continue; }
        if (nodes.length >= limits.maxStates) { reasons.add('state limit'); continue; }
        visited.set(key, nodes.length);
        nodes.push({ state, parent: cursor, choice: choice.id, depth: node.depth + 1 });
        reached.add(state.scene);
      }
    }
    if (halted) break;
    // Yield so SIGINT/SIGTERM and API AbortControllers can be observed.
    if (cursor % 64 === 63) await new Promise(resolve => setTimeout(resolve, 0));
  }
  const exhaustive = reasons.size === 0;
  const unreached = model.story.scenes.filter(s => !reached.has(s.id)).map(s => ({ scene: s.id, ending: Boolean(s.ending), status: exhaustive ? 'unreachable' : 'not-observed' }));
  return {
    format: 1, exhaustive, reasons: [...reasons], limits,
    counts: { states: nodes.length, processed, transitions, findings: findings.length, reachedScenes: reached.size },
    nodes, findings, unreached,
  };
}

export function witness(report, nodeIndex) {
  if (!Number.isSafeInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= report.nodes.length) throw new Error('Invalid witness node');
  const path = [];
  let i = nodeIndex;
  while (report.nodes[i].parent !== null) {
    if (path.length >= LIMITS.history) throw new Error('Witness exceeds history limit');
    const n = report.nodes[i]; path.push(n.choice); i = n.parent;
  }
  return path.reverse();
}
