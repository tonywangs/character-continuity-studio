// Independent all-pairs transitive closure, not DFS/SCC production code.
// Input edges come from the independent story interpreter in reference.js.
export function closure(keys, edges, endings, exhaustive) {
  const index = new Map(keys.map((key,i) => [key,i]));
  const reach = keys.map((_,i) => keys.map((__,j) => i === j));
  for (const e of edges) reach[index.get(e.from)][index.get(e.to)] = true;
  for (let k=0;k<keys.length;k++) for(let i=0;i<keys.length;i++) for(let j=0;j<keys.length;j++) reach[i][j] ||= reach[i][k] && reach[k][j];
  const status = keys.map((_,i) => keys.some((key,j) => endings.has(key) && reach[i][j]) ? 'reachable' : exhaustive ? 'no-route' : 'unresolved');
  const assigned = new Set(), cycles = [];
  for (let i=0;i<keys.length;i++) {
    if(assigned.has(i)) continue;
    const members = keys.map((_,j)=>j).filter(j=>reach[i][j] && reach[j][i]);
    members.forEach(j=>assigned.add(j));
    if(members.length>1 || edges.some(e=>e.from===keys[i] && e.to===keys[i])) cycles.push(members);
  }
  return {status,cycles};
}
