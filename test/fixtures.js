// Seeded finite stories used by the independent reference experiment.
export function random(seed) {
  let n = seed >>> 0;
  return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 2 ** 32; };
}
export function tiny() {
  return {
    format: 1, id: 'tiny', title: 'A tiny story', introduction: 'A finite test story.', objective: 'Reach the end.',
    characters: [{ id: 'a', name: 'A', description: 'A test character.' }],
    variables: [{ id: 'flag', label: 'Flag', type: 'boolean', initial: false }],
    start: 'start', scenes: [
      { id: 'start', title: 'Start', text: 'At the start.', choices: [{ id: 'finish', text: 'Finish.', to: 'end', effects: [{ var: 'flag', value: true }] }] },
      { id: 'end', title: 'End', text: 'At the end.', ending: true, choices: [] },
    ],
    invariants: [{ id: 'ended', message: 'An ending needs a flag.', when: { scene: 'end' }, assert: { var: 'flag', op: 'eq', value: true } }],
  };
}
export function generated(seed) {
  const rng = random(seed); const pick = a => a[Math.floor(rng() * a.length)];
  const story = tiny(); story.id = `seed-${seed}`;
  story.variables = [
    { id: 'flag', label: 'Flag', type: 'boolean', initial: pick([false, true]) },
    { id: 'count', label: 'Counter', type: 'integer', initial: pick([0, 1, 2]), min: 0, max: 2 },
    { id: 'color', label: 'Color', type: 'enum', initial: pick(['red', 'blue', 'green']), values: ['red', 'blue', 'green'] },
  ];
  const count = 3 + Math.floor(rng() * 5); const ids = Array.from({ length: count }, (_, i) => `s${i}`);
  const domain = v => v.type === 'boolean' ? [false, true] : v.type === 'integer' ? [0, 1, 2] : v.values;
  function expression(depth = 0) {
    const type = Math.floor(rng() * (depth < 2 ? 8 : 4));
    if (type === 0) return pick([true, false]);
    if (type === 1) return { scene: pick(ids) };
    if (type < 4) {
      const v = pick(story.variables);
      return { var: v.id, op: pick(v.type === 'integer' ? ['eq', 'ne', 'lt', 'le', 'gt', 'ge'] : ['eq', 'ne']), value: pick(domain(v)) };
    }
    if (type === 4) return { not: expression(depth + 1) };
    return { [type < 6 ? 'all' : 'any']: [expression(depth + 1), expression(depth + 1)] };
  }
  story.start = ids[0];
  story.scenes = ids.map((id, i) => {
    const ending = i === count - 1;
    return { id, title: id, text: 'Seeded sample.', ending, choices: ending ? [] : Array.from({ length: 1 + Math.floor(rng() * 4) }, (_, j) => ({
      id: `c${i}_${j}`, text: 'Take this edge.', to: pick(ids), when: j === 0 ? true : expression(),
      effects: story.variables.filter(() => rng() < .45).map(v => ({ var: v.id, value: pick(domain(v)) })),
    })) };
  });
  story.invariants = Array.from({ length: 3 }, (_, i) => ({ id: `inv${i}`, message: `Seed ${seed} property ${i}`, when: expression(), assert: expression() }));
  return story;
}
export function counter(bits = 10) {
  const story = tiny(); story.id = 'counter';
  story.variables = Array.from({ length: bits }, (_, i) => ({ id: `b${i}`, label: `Bit ${i}`, type: 'boolean', initial: false }));
  story.scenes = [{ id: 'start', title: 'A bounded binary counter', text: 'Each bit can be set independently.', choices: story.variables.map((v, i) => ({ id: `set${i}`, text: `Set bit ${i}`, to: 'start', when: { var: v.id, op: 'eq', value: false }, effects: [{ var: v.id, value: true }] })) }];
  story.invariants = [{ id: 'deliberate', message: 'Deliberately false for pagination tests.', assert: false }];
  return story;
}
