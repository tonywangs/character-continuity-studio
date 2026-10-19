import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { newSession, makeRequest, generateTurn, saveSession, validateSession, localEndpoint, MAX_TURNS } from '../src/character.js';
import { createCharacterServer } from '../src/character-server.js';
import { modelProvenance } from '../src/character-provenance.js';
import { hash, inferenceFetch } from '../src/character.js';

const dossier = 'You are Ivo. Keep your promises.';
const prior = { user: 'The signal is lantern.', assistant: 'I will remember lantern.' };
test('inference transport observes cancellation while waiting for headers', async () => {
  const server = http.createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(inferenceFetch(`http://127.0.0.1:${server.address().port}`, {
      method: 'POST', headers: {}, body: '{}', signal: AbortSignal.timeout(100)
    }), error => error.name === 'AbortError');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('evaluation provenance hashes selected weights and refuses an unrelated server path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'continuity-provenance-'));
  const file = join(dir, 'explicit-test-fixture.gguf');
  try {
    await writeFile(file, 'labelled fake weights for provenance test');
    const properties = { model_path: file, build_info: 'b11724-99db719bd' };
    const provenance = await modelProvenance(properties, file);
    assert.equal(provenance.model.sha256, hash('labelled fake weights for provenance test'));
    assert.equal(provenance.model.revision, null);
    assert.equal(provenance.runtime.commit, '99db719bd');
    await assert.rejects(modelProvenance({ ...properties, model_path: '/unrelated/private/file' }, file), /differs from selected/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('memory condition includes prior dialogue; control has identical dossier and current turn only', () => {
  const enabled = { ...newSession(dossier, 17), turns: [prior] };
  const memory = makeRequest(enabled, dossier, 'What was the signal?');
  const control = makeRequest({ ...enabled, memory: false }, dossier, 'What was the signal?');
  assert.deepEqual(memory.messages.slice(1, 3), [{ role: 'user', content: prior.user }, { role: 'assistant', content: prior.assistant }]);
  assert.deepEqual(control.messages, [memory.messages[0], memory.messages.at(-1)]);
  assert.equal(memory.seed, 18); assert.equal(control.seed, 18);
  assert.equal(memory.cache_prompt, false);
});
test('failed inference never mutates the existing notebook; truncation is visible', async () => {
  const session = newSession(dossier);
  await assert.rejects(generateTurn(session, dossier, 'Hello', undefined, async () => ({ ok:false, status:503, text:async()=> 'not ready' })), /503/);
  assert.deepEqual(session.turns, []);
  await assert.rejects(generateTurn(session, dossier, 'Hello', undefined, async () => ({ok:true,json:async()=>({choices:[]})})), /no dialogue/);
  const updated = await generateTurn(session,dossier,'Hello',undefined,async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'An unfinished'}}]})}));
  assert.equal(updated.turns[0].truncated,true);assert.equal(session.turns.length,0);
});
test('session survives disk reload, pins dossier, and bounds context instead of silently dropping memory', async () => {
  const dir=await mkdtemp(join(tmpdir(),'continuity-character-'));
  try {
    const session={...newSession(dossier),turns:[prior]};await saveSession(dir,session);
    const loaded=validateSession(JSON.parse(await readFile(join(dir,'session.json'),'utf8')),dossier);
    assert.deepEqual(loaded,session);
    assert.throws(()=>validateSession(loaded,'changed'),/changed dossier/);
    assert.throws(()=>makeRequest({...session,turns:Array(MAX_TURNS).fill(prior)},dossier,'hello'),/12 turns/);
    assert.throws(()=>makeRequest(session,dossier,'x'.repeat(1201)),/1200/);
    assert.throws(()=>newSession(dossier,-1),/Seed/);
    assert.throws(()=>localEndpoint('https://example.com'),/loopback/);
    assert.throws(()=>localEndpoint('http://127.0.0.1:8091/other'),/loopback/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('web app saves successful turns, resumes on restart, rejects cross-origin writes, and keeps notebook on model failure', async () => {
  const dir=await mkdtemp(join(tmpdir(),'continuity-http-'));
  let failure=false; const requests=[];
  const model=http.createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;requests.push(JSON.parse(text));res.writeHead(failure?503:200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'The signal is lantern.'}}]}));});
  await new Promise(r=>model.listen(0,'127.0.0.1',r));
  let app;
  try {
    const options={directory:dir,port:0,endpoint:`http://127.0.0.1:${model.address().port}`};
    app=await createCharacterServer(options);let url=`http://127.0.0.1:${app.address().port}`;
    const post=(body,origin)=>fetch(`${url}/api/turn`,{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
    assert.equal((await post({text:'hello'},'https://example.com')).status,403);
    const reply=await post({text:'The signal is lantern.'});assert.equal(reply.status,200);
    assert.equal((await reply.json()).session.turns.length,1);
    await new Promise(r=>app.close(r));app=await createCharacterServer(options);url=`http://127.0.0.1:${app.address().port}`;
    await post({text:'What was the signal?'});assert.equal(requests.at(-1).messages.length,4);
    failure=true;assert.equal((await post({text:'Try again'})).status,400);
    const session=(await(await fetch(`${url}/api/session`)).json()).session;assert.equal(session.turns.length,2);
    const hostStatus=await new Promise((resolve,reject)=>{const req=http.get(url,{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
    assert.equal(hostStatus,403);
  } finally {if(app)await new Promise(r=>app.close(r));await new Promise(r=>model.close(r));await rm(dir,{recursive:true,force:true});}
});
