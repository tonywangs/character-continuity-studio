import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const temp = await mkdtemp(join(tmpdir(), 'continuity-installed-'));
function run(command,args,options={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{...options,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);
    child.on('close',code=>code===0?resolve(stdout):reject(new Error(`${command} ${args.join(' ')} exited ${code}\n${stderr}\n${stdout}`)));
  });
}
try {
  const packed=JSON.parse(await run('npm',['pack','--offline','--ignore-scripts','--json','--pack-destination',temp,'--cache',join(temp,'cache')]));
  const tarball=join(temp,packed[0].filename);
  const prefix=join(temp,'install');
  await run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',prefix,'--cache',join(temp,'empty-cache'),tarball],{cwd:temp});
  const installed=join(prefix,'node_modules/character-continuity-studio');
  const bin=join(prefix,'node_modules/.bin/continuity');
  const story=join(installed,'stories/bellwether.json');
  const guard=pathToFileURL(resolve('scripts/offline-guard.js')).href;
  const env={...process.env,NODE_OPTIONS:`--import=${guard}`,npm_config_offline:'true'};
  // Prove the verification guard is active, then exercise the installed binary.
  const guardCheck=await run(process.execPath,['--input-type=module','-e',`import net from 'node:net';try { net.connect(443,'example.com'); process.exit(9); } catch(e) { console.log(e.message); }`],{cwd:temp,env});
  assert.match(guardCheck,/Network access forbidden/);
  const validation=await run(bin,['validate',story],{cwd:temp,env});assert.match(validation,/Valid format 1/);
  const checked=JSON.parse(await run(bin,['check',story],{cwd:temp,env}));assert.equal(checked.exhaustive,true);assert.equal(checked.findings,0);
  const built=JSON.parse(await run(bin,['build',story,join(temp,'output')],{cwd:temp,env}));assert.equal(built.states,526);
  const loopStory=join(installed,'stories/recoverable-loop.json');
  await run(bin,['build',loopStory,join(temp,'loop-output')],{cwd:temp,env});
  const loopReport=JSON.parse(await readFile(join(temp,'loop-output/report.json'),'utf8'));
  assert.equal(loopReport.format,2);assert.equal(loopReport.progression.cycles.length,1);
  assert.equal(loopReport.progression.everyPlayReachesEnding,'false');
  const cycle=loopReport.progression.cycles[0];
  const loopReplay=JSON.parse(await run(bin,['replay',loopStory,...cycle.entryPath,...cycle.cycle,...cycle.cycle],{cwd:temp,env}));
  assert.equal(loopReplay.state.scene,'rehearsal');
  const replay=JSON.parse(await run(bin,['replay',story,'enter','listen'],{cwd:temp,env}));assert.equal(replay.state.scene,'workshop');assert.equal(replay.state.values[0],true);
  process.env.PLAYWRIGHT_BROWSERS_PATH??=resolve('.cache/browsers');const {chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-background-networking']});
  const attempts=[];const errors=[];
  try {
    const context=await browser.newContext({offline:true,acceptDownloads:true});await context.route(/^https?:/,route=>{attempts.push(route.request().url());return route.abort();});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(join(temp,'output/player.html')).href);await page.locator('[data-choice=enter]').click();await page.locator('[data-choice=listen]').click();
    assert.equal(await page.locator('#scene-title').textContent(),'A socket with no coupling');
    const waiting=page.waitForEvent('download');await page.locator('#export-save').click();const download=await waiting;const saved=await readFile(await download.path(),'utf8');
    const savePath=join(temp,'transfer.json');await writeFile(savePath,saved);
    const loaded=JSON.parse(await run(bin,['load',story,savePath],{cwd:temp,env}));assert.deepEqual(loaded.state,replay.state);
    await page.goto(pathToFileURL(join(temp,'output/report.html')).href);assert.match(await page.locator('main').textContent(),/Exhaustive/);
    assert.deepEqual(attempts,[]);assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
  const result={offlineInstall:true,emptyNpmCache:true,runtimeDependencies:0,packedFiles:packed[0].entryCount,packedBytes:packed[0].size,checks:['installed CLI validate/check/build/replay/load','Node socket and DNS guard active','installed self-contained browser player and report','browser-to-installed-CLI save transfer','installed progression report and repeated cycle witness replay'],storyStates:checked.states,artifacts:built.sizes};
  console.log(JSON.stringify(result,null,2));
  if(process.env.CONTINUITY_INSTALL_EVIDENCE)await writeFile(process.env.CONTINUITY_INSTALL_EVIDENCE,JSON.stringify(result,null,2)+'\n');
} finally {await rm(temp,{recursive:true,force:true});}
