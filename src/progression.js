// Iterative Kosaraju plus reverse reachability on observed, choice-labelled edges.
// No recursion, fairness assumption, or inference from absent frontier edges.
export async function progression(model, nodes, edges, exhaustive, checkpoint) {
  const n = nodes.length;
  const out = Array.from({ length: n }, () => []), incoming = Array.from({ length: n }, () => []);
  for (let i = 0; i < edges.length; i++) {
    if (i % 1024 === 0) await checkpoint();
    const e = edges[i]; out[e.from].push(i); incoming[e.to].push(i);
  }
  const ending = nodes.map(v => Boolean(model.scenes.get(v.state.scene).ending));
  const canEnd = ending.slice(), queue = [];
  ending.forEach((yes, i) => { if (yes) queue.push(i); });
  for (let q = 0; q < queue.length; q++) {
    if (q % 256 === 0) await checkpoint();
    for (const i of incoming[queue[q]]) if (!canEnd[edges[i].from]) { canEnd[edges[i].from] = true; queue.push(edges[i].from); }
  }
  const seen = new Uint8Array(n), order = [];
  let work = 0;
  for (let root = 0; root < n; root++) {
    if (seen[root]) continue;
    const stack = [[root, 0]]; seen[root] = 1;
    while (stack.length) {
      if (++work % 1024 === 0) await checkpoint();
      const frame = stack.at(-1), v = frame[0];
      if (frame[1] === out[v].length) { order.push(v); stack.pop(); continue; }
      const to = edges[out[v][frame[1]++]].to;
      if (!seen[to]) { seen[to] = 1; stack.push([to, 0]); }
    }
  }
  const components = [], owner = new Int32Array(n).fill(-1);
  for (const root of order.reverse()) {
    if (owner[root] !== -1) continue;
    const id = components.length, members = [], stack = [root]; owner[root] = id;
    while (stack.length) {
      if (++work % 256 === 0) await checkpoint();
      const v = stack.pop(); members.push(v);
      for (const i of incoming[v]) { const from = edges[i].from; if (owner[from] === -1) { owner[from] = id; stack.push(from); } }
    }
    members.sort((a,b) => a-b); components.push(members);
  }
  const cycles = [];
  for (let id = 0; id < components.length; id++) {
    await checkpoint();
    const members = components[id], entry = members[0]; // BFS index gives nearest entry, deterministic tie.
    const first = out[entry].find(i => owner[edges[i].to] === id);
    if (members.length === 1 && (first === undefined || edges[first].to !== entry)) continue;
    // Find a return path inside the component. The entire cycle is valid, not asserted shortest.
    const start = edges[first].to, parents = new Map([[start, null]]), frontier = [start];
    for (let q = 0; q < frontier.length && !parents.has(entry); q++) {
      if (q % 256 === 0) await checkpoint();
      for (const i of out[frontier[q]]) {
        const to = edges[i].to;
        if (owner[to] === id && !parents.has(to)) { parents.set(to, i); frontier.push(to); }
      }
    }
    const back = []; let v = entry;
    while (v !== start) { const i = parents.get(v); back.push(i); v = edges[i].from; }
    const cycleEdges = [first, ...back.reverse()];
    const entryPath = []; v = entry;
    while (nodes[v].parent !== null) { entryPath.push(nodes[v].choice); v = nodes[v].parent; }
    cycles.push({ id: 0, node: entry, nodes: members, scenes: [...new Set(members.map(v => nodes[v].state.scene))].sort(),
      endingReachability: canEnd[entry] ? 'reachable' : exhaustive ? 'no-route' : 'unresolved',
      entryPath: entryPath.reverse(), cycleEdges, cycle: cycleEdges.map(i => edges[i].choice) });
  }
  cycles.sort((a,b) => a.node-b.node).forEach((c,i) => { c.id = i; });
  const states = nodes.map((node, i) => ({ node: i, scene: node.state.scene,
    endingReachability: canEnd[i] ? 'reachable' : exhaustive ? 'no-route' : 'unresolved' }));
  const counts = { endingReachable: states.filter(s => s.endingReachability === 'reachable').length,
    noRoute: states.filter(s => s.endingReachability === 'no-route').length,
    unresolved: states.filter(s => s.endingReachability === 'unresolved').length, cyclicComponents: cycles.length };
  await checkpoint();
  return { format: 1, complete: true, counts, states, cycles,
    everyPlayReachesEnding: cycles.length || (exhaustive && counts.noRoute) ? 'false' : exhaustive ? 'true' : 'unresolved' };
}
