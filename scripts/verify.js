// One command for semantic tests, installed offline use, browser checks, and
// measured bounded workloads. It does not download packages or browser binaries.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readdir, stat, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
const start=performance.now();
await mkdir('results',{recursive:true});
for (const name of ['browser.json', 'installed.json', 'measurements.json']) await rm(join('results', name), { force: true });
await writeFile('results/verification.json', JSON.stringify({ passed: false, running: true }) + '\n');
await writeFile('results/tests.log', '');
const log=[];
async function run(args,extraEnv={}) {
  const label=`node ${args.join(' ')}`;console.log(`\n${label}`);log.push(`$ ${label}\n`);
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,args,{env:{...process.env,...extraEnv},stdio:['ignore','pipe','pipe']});let stdout='';
    child.stdout.on('data',b=>{stdout+=b;process.stdout.write(b);log.push(b.toString());});
    child.stderr.on('data',b=>{process.stderr.write(b);log.push(b.toString());});child.on('error',reject);
    child.on('close',code=>code===0?resolve(stdout):reject(new Error(`${label} exited ${code}`)));
  });
}
try {
  const tests=(await readdir('test')).filter(f=>f.endsWith('.test.js')).sort().map(f=>join('test',f));
  const testOutput = await run(['--test',...tests]);
  const progressionExperiment = JSON.parse(testOutput.match(/\{"progressionSeeds":250[^\n]+\}/)[0]);
  const experiment = JSON.parse(testOutput.match(/\{"seeds":250[^\n]+\}/)[0]);
  await run(['scripts/installed-check.js'],{CONTINUITY_INSTALL_EVIDENCE:'results/installed.json'});
  await run(['scripts/browser-check.js'],{CONTINUITY_BROWSER_EVIDENCE:'results/browser.json'});
  const workloads=[];
  for(const name of ['story','counter-1024','bounded-2048','cycles-1024']) workloads.push(JSON.parse(await run(['scripts/measure.js',name])));
  await writeFile('results/measurements.json',JSON.stringify({measurement:'Single process per workload; wall time covers read, validate, explore, render and write. maxRSS is the Node process peak from resourceUsage, in KiB; browser RSS is not included.',workloads},null,2)+'\n');
  // Check publishable paths, rather than ignored browser/tool installations.
  const allowed=['src','web','stories','test','scripts','docs','results'];let bytes=0,files=0;
  async function audit(path) {
    const info=await stat(path);
    if(info.isDirectory()) {for(const entry of await readdir(path))await audit(join(path,entry));return;}
    assert.ok(info.size<=10*1024*1024,`${path} exceeds per-file limit`);
    assert.ok(!path.endsWith('.log')||path==='results/tests.log',`unexpected publication log ${path}`);
    files++;bytes+=info.size;
  }
  for(const path of [...allowed,'README.md','LICENSE','package.json','package-lock.json','.gitignore'])await audit(path);
  assert.ok(bytes<=32*1024*1024);assert.ok(files<=1000);
  const summary={passed:true,wallMilliseconds:Math.round((performance.now()-start)*100)/100,publishableFiles:files,publishableBytes:bytes,progressionExperiment:{...progressionExperiment,reference:'test/progression-reference.js',reproduce:'node --test test/progression.test.js'},semanticExperiment:{...experiment,reference:'test/reference.js',generator:'test/fixtures.js',reproduce:'node --test test/model.test.js'},checks:['Node unit and independent reference tests','isolated installed CLI with offline npm and denied Node networking','Chromium with offline contexts and blocked external routes','four measured bounded build workloads','publication file/size limits']};
  await writeFile('results/verification.json',JSON.stringify(summary,null,2)+'\n');
  console.log('\nVerification passed. Evidence: results/*.json and results/tests.log');
  log.push('\nVerification passed.\n');
} catch(error) {log.push(`\nFAILED: ${error.stack}\n`);console.error(error);process.exitCode=1;await writeFile('results/verification.json',JSON.stringify({passed:false,error:error.message},null,2)+'\n');}
finally {await writeFile('results/tests.log',log.join(''));}
