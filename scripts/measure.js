import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { build } from '../src/export.js';
import { counter } from '../test/fixtures.js';
const dir=await mkdtemp(join(tmpdir(),'continuity-measure-'));
const name=process.argv[2]??'story';
try {
  let input='stories/bellwether.json';
  const options={};
  if(name!=='story') {input=join(dir,'counter.json');await writeFile(input,JSON.stringify(counter(name==='counter-1024'?10:14)));if(name==='bounded-2048')options.maxStates=2048;}
  const start=performance.now();const result=await build(input,join(dir,'output'),options);const wallMilliseconds=performance.now()-start;
  console.log(JSON.stringify({workload:name,node:process.version,platform:process.platform,architecture:process.arch,wallMilliseconds:Math.round(wallMilliseconds*100)/100,peakProcessRssKiB:process.resourceUsage().maxRSS,exhaustive:result.report.exhaustive,reasons:result.report.reasons,...result.report.counts,artifacts:result.sizes}));
} finally {await rm(dir,{recursive:true,force:true});}
