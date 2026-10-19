// Structural/evidence checks, not an automatic judge of character quality.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hash, makeRequest, newSession } from '../src/character.js';
const directory=process.argv[2]||'results/character-evaluation';
const json=async name=>JSON.parse(await readFile(join(directory,name),'utf8'));
const manifest=await json('manifest.json');const protocol=await json('protocol.json');
const dossier=await readFile(join(directory,'dossier.md'),'utf8');
const server=await json('server-properties.json');const provenance=await json('provenance.json');
assert.equal(manifest.status,'complete');assert.equal(hash(dossier),manifest.dossierHash);
assert.equal(hash(JSON.stringify(protocol)),manifest.protocolHash);
assert.ok(server.build_info.includes(provenance.runtime.commit));
assert.ok(server.model_path.endsWith(provenance.model.file));
assert.match(provenance.model.sha256,/^[a-f0-9]{64}$/);
const expected=protocol.scenarios.length*protocol.seeds.length*2;
assert.equal(manifest.runs.length,expected);const seen=new Set();let turns=0;
const sessions=new Map();
for(const run of manifest.runs){
  const scenario=protocol.scenarios.find(s=>s.id===run.scenario);assert.ok(scenario);
  assert.ok(protocol.seeds.includes(run.seed));assert.equal(typeof run.memory,'boolean');
  const key=`${run.scenario}-${run.seed}-${run.memory}`;assert.ok(!seen.has(key));seen.add(key);
  assert.equal(run.filename,`${run.scenario}-${run.seed}-${run.memory?'memory':'control'}.json`);
  const session=await json(run.filename);sessions.set(run.filename,session);
  assert.equal(session.memory,run.memory);assert.equal(session.seed,run.seed);
  assert.equal(session.dossierHash,manifest.dossierHash);
  assert.equal(run.completedTurns,scenario.turns.length);assert.equal(session.turns.length,scenario.turns.length);
  let prefix=newSession(dossier,run.seed,run.memory);
  for(const [i,turn]of session.turns.entries()){
    assert.equal(turn.index,i);assert.equal(turn.user,scenario.turns[i]);
    assert.deepEqual(turn.request,makeRequest(prefix,dossier,turn.user));
    assert.equal(turn.assistant,turn.response.choices[0].message.content);
    assert.equal(turn.truncated,turn.response.choices[0].finish_reason!=='stop');
    assert.equal(turn.response.system_fingerprint,server.build_info);
    assert.ok(turn.elapsedMs>0);prefix.turns.push(turn);turns++;
  }
}
const assessments=await json('assessments.json');let probes=0;
assert.equal(assessments.runs.length,expected);const assessed=new Set();
for(const assessment of assessments.runs){
  assert.ok(!assessed.has(assessment.filename));assessed.add(assessment.filename);
  const session=sessions.get(assessment.filename);assert.ok(session);
  const run=manifest.runs.find(r=>r.filename===assessment.filename);
  const scenario=protocol.scenarios.find(s=>s.id===run.scenario);
  assert.equal(assessment.probes.length,scenario.probes.length);
  assert.deepEqual(assessment.probes.map(p=>p.id).sort(),scenario.probes.map(p=>p.id).sort());
  for(const probe of assessment.probes){
    const rubric=scenario.probes.find(p=>p.id===probe.id);assert.equal(probe.turn,rubric.turn);
    assert.ok(['pass','fail','unclear'].includes(probe.verdict));
    assert.ok(probe.evidence.length>0&&session.turns[probe.turn].assistant.includes(probe.evidence));
    assert.ok(probe.reason.length>10);probes++;
  }
  for(const issue of assessment.contradictions){assert.ok(session.turns[issue.turn].assistant.includes(issue.evidence));assert.ok(issue.reason.length>10);}
}
console.log(JSON.stringify({passed:true,runs:expected,turns,assessedProbes:probes,scope:'Archive integrity and coverage only; assessment judgments require reading the text.'},null,2));
