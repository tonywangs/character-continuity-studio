import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createModel, stateKey } from '../src/engine.js';
import { explore, witness } from '../src/search.js';
import { progression } from '../src/progression.js';
import { generated, tiny } from './fixtures.js';
import { reference } from './reference.js';
import { closure } from './progression-reference.js';

function verify(story, report, ref) {
  const keys=report.nodes.map(n=>stateKey(n.state));
  const observed=report.edges.map(e=>({from:keys[e.from],to:keys[e.to],choice:e.choice}));
  for(const edge of observed) assert.ok(ref.edges.some(e=>JSON.stringify(e)===JSON.stringify({from:edge.from,choice:edge.choice,to:edge.to})), 'observed edge is independently valid');
  if(report.exhaustive) assert.deepEqual(observed,ref.edges);
  const endings=new Set([...ref.visited].filter(([,s])=>story.scenes.find(v=>v.id===s.scene).ending).map(([key])=>key));
  const expected=closure(keys,report.exhaustive?ref.edges:observed,endings,report.exhaustive);
  assert.equal(report.progression.complete,true);
  assert.deepEqual(report.progression.states.map(s=>s.endingReachability),expected.status);
  assert.deepEqual(report.progression.cycles.map(c=>c.nodes),expected.cycles);
  for(const c of report.progression.cycles) {
    const entry=ref.visited.get(keys[c.node]);
    assert.deepEqual(c.entryPath,entry.path);
    assert.equal(c.entryPath.length,Math.min(...c.nodes.map(i=>ref.visited.get(keys[i]).path.length)));
    let key=keys[c.node];
    assert.ok(c.cycle.length>0);
    for(let repetition=0;repetition<3;repetition++) {
      for(let j=0;j<c.cycle.length;j++) {
        const e=ref.edges.find(e=>e.from===key&&e.choice===c.cycle[j]);assert.ok(e);
        const recorded=report.edges[c.cycleEdges[j]];
        assert.equal(keys[recorded.from],key); assert.equal(keys[recorded.to],e.to);
        key=e.to;
      }
      assert.equal(key,keys[c.node]);
    }
  }
  for(const s of report.progression.states) assert.deepEqual(witness(report,s.node),ref.visited.get(keys[s.node]).path);
}

test('250 seeded progression graphs and 750 exhausted-limit graphs agree with independent closure and replay',async t=>{
  let cycles=0,noRoute=0,unresolved=0;
  for(let seed=1;seed<=250;seed++) {
    const story=generated(seed); const original=JSON.stringify(story), ref=reference(story), model=createModel(story);
    for(const options of [{},{maxStates:1},{maxTransitions:1},{maxDepth:0}]) {
      const report=await explore(model,options);verify(story,report,ref);
      assert.deepEqual(await explore(model,options),report,'deterministic JSON structure');
      cycles+=report.progression.cycles.length;noRoute+=report.progression.counts.noRoute;unresolved+=report.progression.counts.unresolved;
    }
    assert.equal(JSON.stringify(story),original);
  }
  t.diagnostic(JSON.stringify({progressionSeeds:250,boundedRuns:750,cycles,noRoute,unresolved}));
});

test('authored recoverable loop and unavoidable trap have distinct conclusions',async()=>{
  for(const name of ['recoverable-loop','progression-trap']) {
    const story=JSON.parse(await readFile(`stories/${name}.json`,'utf8'));
    const report=await explore(createModel(story));verify(story,report,reference(story));
    assert.equal(report.progression.cycles.length,1);
    assert.equal(report.progression.everyPlayReachesEnding,'false');
    assert.equal(report.progression.counts.noRoute,name==='recoverable-loop'?0:3);
    assert.equal(report.findings.length,0,'a live closed loop is not a dead end');
  }
});

test('state-changing cycles, converging paths, multiple endings, and dead ends',async()=>{
  const story=tiny();story.invariants=[];
  story.scenes[0].choices.push({id:'flip',text:'Flip',to:'other',effects:[{var:'flag',value:true}]},{id:'second',text:'Other end',to:'end2',effects:[]},{id:'stuck',text:'Stuck',to:'dead',effects:[]});
  story.scenes.push({id:'other',title:'Other',text:'Other',choices:[{id:'back',text:'Back',to:'start',effects:[{var:'flag',value:false}]},{id:'converge',text:'Converge',to:'end',effects:[{var:'flag',value:true}]}]}, {id:'end2',title:'End two',text:'End two',ending:true,choices:[]},{id:'dead',title:'Dead',text:'Dead',choices:[]});
  const report=await explore(createModel(story));verify(story,report,reference(story));
  assert.equal(report.progression.cycles[0].nodes.length,2);assert.equal(report.progression.counts.noRoute,1);
  assert.equal(report.findings.filter(f=>f.kind==='dead-end').length,1);
});

test('incomplete exploration never promotes absent endings to no-route; observed cycles remain sound',async()=>{
  const story=tiny();story.scenes[0].choices.unshift({id:'loop',text:'Loop',to:'start',effects:[]});
  const report=await explore(createModel(story),{maxTransitions:1});
  assert.equal(report.progression.counts.noRoute,0);assert.equal(report.progression.counts.unresolved,1);
  assert.equal(report.progression.cycles.length,1);assert.equal(report.progression.everyPlayReachesEnding,'false');
  const ac=new AbortController();ac.abort();
  const cancelled=await explore(createModel(story),{signal:ac.signal});
  assert.equal(cancelled.progression.complete,false);assert.equal(cancelled.progression.everyPlayReachesEnding,'unresolved');
  const during=new AbortController(); let calls=0;
  const interrupted=await explore(createModel(story),{signal:during.signal,now:()=>{if(++calls===4)during.abort();return 0;}});
  assert.equal(interrupted.exhaustive,true);assert.equal(interrupted.progression.complete,false);assert.equal(interrupted.progression.reason,'cancelled');
  // Interrupt during graph processing, not just before exploration.
  const full=await explore(createModel(story));let checkpoints=0;
  await assert.rejects(progression(createModel(story),full.nodes,full.edges,true,async()=>{if(++checkpoints===3)throw new Error('cancelled');}),/cancelled/);
  let clock=0;
  const timed=await explore(createModel(story),{maxMilliseconds:3,now:()=>clock++});
  assert.equal(timed.progression.complete,false);assert.equal(timed.progression.reason,'time limit');
});

test('original story progression audit preserves its declared story',async t=>{
  const raw=await readFile('stories/bellwether.json','utf8');const r=await explore(createModel(JSON.parse(raw)));
  assert.equal(r.nodes.length,526);assert.equal(r.progression.counts.noRoute,0);assert.equal(r.progression.cycles.length,0);assert.equal(r.progression.everyPlayReachesEnding,'true');
  t.diagnostic(JSON.stringify({originalStoryProgression:r.progression.counts,everyPlayReachesEnding:r.progression.everyPlayReachesEnding}));
});


test('iterative component traversal handles a 20,000-state ring without recursion',async()=>{
  const count=20000;
  const nodes=Array.from({length:count},(_,i)=>({state:{scene:'start',values:[i]},parent:i===0?null:0,choice:'enter',depth:i===0?0:1}));
  const edges=Array.from({length:count},(_,i)=>({from:i,to:(i+1)%count,choice:'again'}));
  const result=await progression(createModel(tiny()),nodes,edges,true,async()=>{});
  assert.equal(result.cycles.length,1);assert.equal(result.cycles[0].cycle.length,count);
  assert.deepEqual(result.cycles[0].cycleEdges,Array.from({length:count},(_,i)=>i));
  assert.equal(result.counts.noRoute,count);assert.equal(result.everyPlayReachesEnding,'false');
});
