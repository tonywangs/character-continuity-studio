import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseStory, validateStory } from '../src/validate.js';
import { createModel, stateKey } from '../src/engine.js';
import { explore, witness } from '../src/search.js';
import { LIMITS } from '../src/limits.js';
import { tiny, generated, counter } from './fixtures.js';
import { reference } from './reference.js';

const normalized = xs => xs.map(x => JSON.stringify(x)).sort();
test('250 seeded finite stories agree with an independent reference enumerator', async t => {
  let states = 0, transitions = 0, findings = 0;
  for (let seed = 1; seed <= 250; seed++) {
    const story = generated(seed); const model = createModel(story);
    const expected = reference(story); const actual = await explore(model);
    assert.equal(actual.exhaustive, true, `seed ${seed}`);
    const byKey = new Map(actual.nodes.map((node, i) => [stateKey(node.state), { ...node, index: i }]));
    assert.deepEqual([...byKey.keys()].sort(), [...expected.visited.keys()].sort(), `reachable states at seed ${seed}`);
    for (const [key, ref] of expected.visited) {
      const node = byKey.get(key);
      assert.equal(node.depth, ref.path.length, `shortest distance at seed ${seed}`);
      assert.deepEqual(witness(actual, node.index), ref.path, `deterministic tie order at seed ${seed}`);
      assert.equal(stateKey(model.replay(ref.path).state), key);
      const active = model.choices(node.state).filter(c => c.available).map(c => c.id).sort();
      assert.deepEqual(active, expected.edges.filter(e => e.from === key).map(e => e.choice).sort());
      for (const choice of model.choices(node.state).filter(c => !c.available)) assert.throws(() => model.step(node.state, choice.id), /unavailable/);
    }
    for (const edge of expected.edges) {
      const from = byKey.get(edge.from).state;
      const copy = JSON.stringify(from);
      assert.equal(stateKey(model.step(from, edge.choice).state), edge.to, `transition at seed ${seed}`);
      assert.equal(JSON.stringify(from), copy, 'transition must not mutate input state');
    }
    assert.deepEqual(normalized(actual.findings.map(f => ({ key: stateKey(actual.nodes[f.node].state), kind: f.kind, invariant: f.invariant }))), normalized(expected.findings), `findings at seed ${seed}`);
    assert.deepEqual(actual.unreached.map(s => s.scene).sort(), story.scenes.filter(s => !expected.reached.has(s.id)).map(s => s.id).sort());
    states += actual.nodes.length; transitions += expected.edges.length; findings += actual.findings.length;
  }
  t.diagnostic(JSON.stringify({ seeds: 250, states, transitions, findings }));
});

test('original story is complete, all three endings replay, all scenes reachable', async () => {
  const story = parseStory(await readFile(new URL('../stories/bellwether.json', import.meta.url), 'utf8'));
  const model = createModel(story); const report = await explore(model);
  assert.equal(story.characters.length, 3); assert.ok(story.scenes.length >= 12);
  assert.equal(report.exhaustive, true); assert.deepEqual(report.findings, []); assert.deepEqual(report.unreached, []);
  const endings = story.scenes.filter(s => s.ending); assert.equal(endings.length, 3);
  for (const s of endings) {
    const i = report.nodes.findIndex(n => n.state.scene === s.id); assert.ok(i >= 0);
    assert.equal(model.replay(witness(report, i)).state.scene, s.id);
  }
});

test('cycles, converging paths, initial contradictions, dead ends, and unreachable endings', async () => {
  const story = tiny();
  story.scenes[0].choices = [
    { id: 'loop', text: 'Loop', to: 'start', effects: [] },
    { id: 'first', text: 'First', to: 'end', effects: [] },
    { id: 'second', text: 'Second', to: 'end', effects: [] },
    { id: 'stuck', text: 'Get stuck', to: 'dead', effects: [] },
  ];
  story.scenes.push({ id: 'dead', title: 'Dead', text: 'Dead.', choices: [] }, { id: 'unreachable', title: 'Unreachable', text: 'Never.', ending: true, choices: [] });
  story.invariants.push({ id: 'initial', message: 'Contradiction at the start', when: { scene: 'start' }, assert: false });
  const report = await explore(createModel(story));
  assert.equal(report.nodes.length, 3); assert.equal(report.counts.transitions, 4);
  assert.deepEqual(witness(report, 0), []);
  assert.deepEqual(witness(report, 1), ['first']);
  assert.deepEqual(report.findings.map(f => f.kind), ['invariant', 'invariant', 'dead-end']);
  assert.deepEqual(report.unreached, [{ scene: 'unreachable', ending: true, status: 'unreachable' }]);
});

test('state, transition, depth, finding, time, and cancellation budgets distinguish incomplete results', async () => {
  const model = createModel(counter(8));
  for (const [options, reason] of [
    [{ maxStates: 2 }, 'state limit'], [{ maxTransitions: 2 }, 'transition limit'],
    [{ maxDepth: 0 }, 'depth limit'], [{ maxFindings: 1 }, 'finding limit'],
    [{ maxMilliseconds: 1, now: (() => { let n = 0; return () => n++; })() }, 'time limit'],
  ]) {
    const r = await explore(model, options); assert.equal(r.exhaustive, false); assert.ok(r.reasons.includes(reason));
  }
  const aborted = new AbortController(); aborted.abort();
  const before = await explore(model, { signal: aborted.signal }); assert.deepEqual(before.reasons, ['cancelled']); assert.equal(before.counts.processed, 0);
  const active = new AbortController(); setTimeout(() => active.abort(), 0);
  const during = await explore(model, { signal: active.signal }); assert.ok(during.reasons.includes('cancelled')); assert.ok(during.counts.processed > 0);
  const story = tiny(); const incomplete = await explore(createModel(story), { maxStates: 1 });
  assert.equal(incomplete.unreached[0].status, 'not-observed');
  for (const options of [{maxStates: 0}, {maxStates: LIMITS.states + 1}, {maxDepth:-1}, {maxMilliseconds:NaN}, {maxTransitions:1.1}]) await assert.rejects(explore(model, options));
});

test('a fully visited cycle at the depth boundary is exhaustive', async () => {
  const story = tiny(); story.scenes = [story.scenes[0]]; story.scenes[0].choices[0].to = 'start'; story.scenes[0].choices[0].effects = []; story.invariants = [];
  const report = await explore(createModel(story), { maxDepth: 0 }); assert.equal(report.exhaustive, true);
});

test('parser rejects malformed references, invalid domains, executable fields, and complexity excesses', () => {
  const changes = [
    s => s.scenes[0].choices[0].to = 'missing', s => s.start = 'missing',
    s => s.scenes[0].choices[0].effects[0].var = 'missing', s => s.scenes[0].choices[0].effects[0].value = 1,
    s => s.scenes[0].choices[0].when = { var: 'missing', op: 'eq', value: true },
    s => s.scenes[0].choices[0].when = { var: 'flag', op: 'gt', value: true },
    s => s.scenes[0].choices[0].when = { scene: 'missing' },
    s => s.scenes[0].choices[0].when = { all: [] },
    s => s.scenes[0].choices[0].effects.push({ var: 'flag', value: false }),
    s => s.scenes[0].choices.push(structuredClone(s.scenes[0].choices[0])),
    s => s.scenes[0].choices[0].code = 'process.exit()', s => s.scenes[0].ending = true,
    s => s.variables[0].kind = 'memory', s => s.variables[0].owner = 'missing',
    s => Object.assign(s.variables[0], { type: 'integer', min: 0, max: 33 }),
    s => Object.assign(s.variables[0], { type: 'enum', values: ['x', 'x'], initial: 'x' }),
    s => s.variables[0].type = 'string', s => s.format = 2,
    s => s.scenes[0].id = 'a b', s => s.scenes[0].text = 'x'.repeat(LIMITS.text + 1),
    s => s.characters = [], s => s.scenes[0].lines = [{ when: true, text: '' }],
    s => { let e = true; for (let i = 0; i < 9; i++) e = { not: e }; s.invariants[0].assert = e; },
    s => s.invariants[0].assert = { all: Array.from({length:16}, () => ({ all: Array(16).fill(true) })) },
  ];
  for (const change of changes) { const story = tiny(); change(story); assert.throws(() => validateStory(story)); }
  assert.throws(() => parseStory('{'), /JSON/);
  assert.throws(() => parseStory(' '.repeat(LIMITS.inputBytes + 1)), /exceeds/);
  assert.throws(() => validateStory(JSON.parse('{"__proto__": {"polluted": true}}')));
  assert.equal({}.polluted, undefined);
});

test('replay and explanations preserve stable identifiers and cap history', () => {
  const model = createModel(tiny());
  assert.match(model.choices(model.initial())[0].reason, /Always/);
  assert.throws(() => model.replay(['missing']), /does not exist/);
  assert.throws(() => model.replay(Array(LIMITS.history + 1).fill('finish')), /History/);
  assert.throws(() => model.replay(['finish', 'finish']), /does not exist/);
  const replay = model.replay(['finish'], { trace: true });
  assert.deepEqual(replay.steps[0].changes, [{ variable: 'flag', before: false, after: true }]);
  const input = tiny(); const copied = createModel(input); input.scenes[0].choices[0].effects = [];
  assert.deepEqual(copied.step(copied.initial(), 'finish').state.values, [true]);
});

test('all structural collection ceilings are enforced', () => {
  for(const mutate of [
    s=>s.characters=Array.from({length:LIMITS.characters+1},(_,i)=>({id:`p${i}`,name:'Person',description:'Person.'})),
    s=>s.scenes=Array.from({length:LIMITS.scenes+1},(_,i)=>({id:`s${i}`,title:'Scene',text:'Scene.',choices:[]})),
    s=>s.variables=Array.from({length:LIMITS.variables+1},(_,i)=>({id:`v${i}`,label:'Variable',type:'boolean',initial:false})),
    s=>s.invariants=Array.from({length:LIMITS.invariants+1},(_,i)=>({id:`i${i}`,message:'Property.',assert:true})),
    s=>s.scenes[0].choices=Array.from({length:LIMITS.choicesPerScene+1},(_,i)=>({id:`c${i}`,text:'Choice.',to:'end',effects:[]})),
    s=>s.scenes[0].lines=Array.from({length:17},()=>({when:true,text:'Line.'})),
    s=>s.variables[0]={id:'flag',label:'Flag',type:'enum',values:Array.from({length:LIMITS.domain+1},(_,i)=>`e${i}`),initial:'e0'},
  ]) {const story=tiny();mutate(story);assert.throws(()=>validateStory(story));}
});

test('conditions and comparisons have independently asserted truth tables', () => {
  const story=tiny();story.variables=[{id:'n',label:'Number',type:'integer',min:0,max:2,initial:1}];story.scenes[0].choices[0].effects=[];story.invariants=[];
  const model=createModel(story),state=model.initial();
  for(const [op,expected] of [['eq',[false,true,false]],['ne',[true,false,true]],['lt',[false,false,true]],['le',[false,true,true]],['gt',[true,false,false]],['ge',[true,true,false]]]) {
    for(let value=0;value<=2;value++)assert.equal(model.evaluate({var:'n',op,value},state),expected[value]);
  }
  assert.equal(model.evaluate({all:[true,{not:false},{scene:'start'}]},state),true);
  assert.equal(model.evaluate({all:[true,false]},state),false);
  assert.equal(model.evaluate({any:[false,{scene:'end'}]},state),false);
  assert.equal(model.evaluate({any:[false,true]},state),true);
});
