import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { build, readStory, renderArtifacts, writeArtifacts } from '../src/export.js';
import { createModel } from '../src/engine.js';
import { explore } from '../src/search.js';
import { LIMITS } from '../src/limits.js';
import { tiny, counter } from './fixtures.js';

async function temp(t) { const path = await mkdtemp(join(tmpdir(), 'continuity-test-')); t.after(() => rm(path, { recursive:true, force:true })); return path; }
async function fixture(t, story = tiny()) { const dir = await temp(t); const input = join(dir, 'input.json'); await writeFile(input, JSON.stringify(story)); return {dir, input}; }
function run(args) { return new Promise(resolve => { const child=spawn(process.execPath, ['src/cli.js', ...args]); let stdout='',stderr=''; child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('close', code=>resolve({code,stdout,stderr})); }); }

test('deterministic exports leave the input hash unchanged and contain no external assets', async t => {
  const {dir,input} = await fixture(t); const before = await readFile(input);
  const first = await build(input, join(dir,'first')); const second = await build(input, join(dir,'second'));
  assert.equal(first.hash, second.hash); assert.deepEqual(await readFile(input), before);
  for (const name of ['player.html','report.html','report.json']) assert.deepEqual(await readFile(join(dir,'first',name)),await readFile(join(dir,'second',name)));
  const html = await readFile(join(dir,'first/player.html'),'utf8');
  assert.match(html, /Content-Security-Policy/); assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
  assert.equal(JSON.parse(await readFile(join(dir,'first/report.json'),'utf8')).storyHash, first.hash);
});

test('output collisions include files, directories, symlinks and input paths', async t => {
  const {dir,input} = await fixture(t);
  const existing = join(dir,'existing'); await mkdir(existing); await writeFile(join(existing,'keep'), 'untouched');
  for (const path of [input,existing]) await assert.rejects(build(input,path),/already exists/);
  assert.equal(await readFile(join(existing,'keep'),'utf8'),'untouched');
  const empty = join(dir,'empty'); await mkdir(empty); await assert.rejects(build(input,empty),/already exists/); assert.deepEqual(await readdir(empty),[]);
  const link = join(dir,'link'); await symlink(existing,link); await assert.rejects(build(input,link),/already exists/);
  await assert.rejects(build(input,join(dir,'missing/child')),/parent does not exist/);
});

test('serialization failures and oversized output create nothing', async t => {
  const {dir,input} = await fixture(t); const target=join(dir,'output');
  await assert.rejects(build(input,target,{serialize(){throw new Error('simulated serialization failure');}}),/simulated serialization/);
  assert.deepEqual((await readdir(dir)).sort(),['input.json']);
  await assert.rejects(build(input,target,{serialize(){return undefined;}}),/serialization/);
  await assert.rejects(build(input,target,{serialize(){return 'x'.repeat(LIMITS.fileBytes);}}),/output limit/);
  assert.deepEqual((await readdir(dir)).sort(),['input.json']);
});

test('write failures and cancellation clean only the owned output directory', async t => {
  const {dir,input} = await fixture(t); const output=join(dir,'output'); let count=0;
  await assert.rejects(build(input,output,{write:async(...args)=>{if (++count===2) throw new Error('simulated disk failure');await writeFile(...args);}}),/simulated disk/);
  assert.deepEqual(await readdir(dir),['input.json']);
  const controller=new AbortController();
  await assert.rejects(build(input,output,{signal:controller.signal,write:async(...args)=>{await writeFile(...args);controller.abort();}}),/cancelled/);
  assert.deepEqual(await readdir(dir),['input.json']);
  await assert.rejects(build(input,output,{signal:controller.signal}),/cancelled/);
  assert.deepEqual(await readdir(dir),['input.json']);
  await assert.rejects(writeArtifacts(output, {'../escape':'bad'}),/filename/);
  assert.deepEqual(await readdir(dir),['input.json']);
});

test('hostile story text is data, including closing script/style/title delimiters', async () => {
  const story=tiny(); const hostile='</script><script>globalThis.pwned=1</script><img src="https://invalid.example/x" onerror="globalThis.pwned=2"> & \u2028 </style></title>';
  story.title=hostile;story.scenes[0].text=hostile;
  const model=createModel(story);const files=await renderArtifacts(story,'a'.repeat(64),await explore(model));
  assert.ok(files['player.html'].includes('\\u003c/script\\u003e'));
  assert.ok(!files['player.html'].includes('<script>globalThis.pwned=1</script>'));
});

test('input UTF-8 and input limits are enforced before parsing', async t => {
  const dir=await temp(t);const input=join(dir,'input.json');
  await writeFile(input,Buffer.from([0xff]));await assert.rejects(readStory(input),/UTF-8/);
  await writeFile(input,' '.repeat(LIMITS.inputBytes+1));await assert.rejects(readStory(input),/exceeds/);
  await assert.rejects(readStory(dir),/regular file/);
});

test('CLI exit statuses and limit parsing expose incomplete checks honestly', async t => {
  const {input}=await fixture(t);
  assert.equal((await run(['validate',input])).code,0);
  assert.equal((await run(['check',input])).code,0);
  assert.equal((await run(['check',input,'--states','1'])).code,3);
  assert.equal((await run(['check',input,'--states','no'])).code,1);
  assert.equal((await run(['check',input,'--states','2','--states','3'])).code,1);
  assert.equal((await run(['replay',input,'finish'])).code,0);
  assert.equal((await run(['replay',input,'invalid'])).code,1);
  assert.equal((await run(['check','stories/broken-promise.json'])).code,2);
});

test('a real SIGINT interrupts an in-progress CLI search without producing an output', async t => {
  const {dir,input}=await fixture(t,counter(14));
  const child=spawn(process.execPath,['src/cli.js','build',input,join(dir,'output')],{stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',b=>stderr+=b);
  const timer=setTimeout(()=>child.kill('SIGINT'),150);
  const result=await new Promise(resolve=>child.on('close',(code,signal)=>resolve({code,signal})));
  clearTimeout(timer);
  assert.equal(result.code,130,`signal=${result.signal}, stderr=${stderr}`);
  assert.match(stderr,/cancelled/);assert.deepEqual(await readdir(dir),['input.json']);
});

test('a source changed during serialization aborts before output creation', async t => {
  const {dir,input}=await fixture(t);const {writeFileSync}=await import('node:fs');
  await assert.rejects(build(input,join(dir,'output'),{serialize(value,...rest){const changed=tiny();changed.title='Changed during export';writeFileSync(input,JSON.stringify(changed));return JSON.stringify(value,...rest);}}),/Input changed/);
  assert.deepEqual(await readdir(dir),['input.json']);
});

test('concurrent exports have one winner and cannot remove each other’s files', async t => {
  const {dir,input}=await fixture(t);const output=join(dir,'output');
  const results=await Promise.allSettled([build(input,output),build(input,output)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.deepEqual((await readdir(output)).sort(),['player.html','report.html','report.json']);
  assert.equal(JSON.parse(await readFile(join(output,'report.json'),'utf8')).exhaustive,true);
});

test('named pipes are rejected without waiting for a writer', {skip:process.platform==='win32'}, async t => {
  const {execFileSync}=await import('node:child_process');const dir=await temp(t);const pipe=join(dir,'pipe');execFileSync('mkfifo',[pipe]);
  await assert.rejects(readStory(pipe),/regular file/);
});
