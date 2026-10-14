// Deliberately independent: no imports of the production parser, model, search,
// evaluator, key builder, or replay. Object-valued states and a frontier queue
// provide a small, transparent semantic oracle, not a faster implementation.
export function reference(story) {
  function truth(e, scene, variables) {
    if (e === undefined) return true;
    if (typeof e === 'boolean') return e;
    const tag = Object.keys(e)[0];
    if (tag === 'all') { for (const x of e.all) if (!truth(x, scene, variables)) return false; return true; }
    if (tag === 'any') { for (const x of e.any) if (truth(x, scene, variables)) return true; return false; }
    if (tag === 'not') return truth(e.not, scene, variables) === false;
    if (tag === 'scene') return scene === e.scene;
    const lhs = variables[e.var], rhs = e.value;
    if (e.op === 'eq') return lhs === rhs;
    if (e.op === 'ne') return lhs !== rhs;
    if (e.op === 'lt') return lhs < rhs;
    if (e.op === 'le') return lhs <= rhs;
    if (e.op === 'gt') return lhs > rhs;
    if (e.op === 'ge') return lhs >= rhs;
    throw new Error('Oracle received invalid condition');
  }
  const key = (scene, values) => JSON.stringify([scene, ...story.variables.map(v => values[v.id])]);
  const initial = Object.fromEntries(story.variables.map(v => [v.id, v.initial]));
  const frontier = [{ scene: story.start, values: initial, path: [] }];
  const visited = new Map([[key(story.start, initial), frontier[0]]]);
  const findings = []; const edges = [];
  while (frontier.length) {
    const current = frontier.shift();
    const scene = story.scenes.find(s => s.id === current.scene);
    const active = [];
    for (const inv of story.invariants) {
      if (truth(inv.when, current.scene, current.values) && !truth(inv.assert, current.scene, current.values)) findings.push({ key: key(current.scene, current.values), kind: 'invariant', invariant: inv.id });
    }
    for (const choice of scene.choices) {
      if (!truth(choice.when, current.scene, current.values)) continue;
      active.push(choice.id);
      const after = Object.assign({}, current.values);
      for (const assignment of choice.effects) after[assignment.var] = assignment.value;
      const target = key(choice.to, after);
      edges.push({ from: key(current.scene, current.values), choice: choice.id, to: target });
      if (!visited.has(target)) {
        const next = { scene: choice.to, values: after, path: current.path.concat(choice.id) };
        frontier.push(next); visited.set(target, next);
      }
    }
    if (!scene.ending && !active.length) findings.push({ key: key(current.scene, current.values), kind: 'dead-end', invariant: undefined });
  }
  return { visited, findings, edges, reached: new Set([...visited.values()].map(s => s.scene)) };
}
