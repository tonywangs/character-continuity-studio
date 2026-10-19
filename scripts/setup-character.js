import { mkdir, readFile, writeFile, rename, rm, access } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';

import { MODEL, RUNTIME as runtime } from '../src/character-model.js';
async function digest(path) { const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex'); }
async function obtain(url, path, expected) {
  try { if (await digest(path) === expected) { console.log(`Verified ${path}`); return; } throw Error(`Checksum mismatch: remove ${path} before retrying`); }
  catch(error) { if(error.code !== 'ENOENT')throw error; }
  const partial = `${path}.partial`;
  try {
    console.log(`Downloading ${url}`);
    const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
    if(!response.ok)throw Error(`Download HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body),createWriteStream(partial));
    if(await digest(partial)!==expected)throw Error(`Checksum mismatch for ${url}`);
    await rename(partial,path);
  } finally { await rm(partial,{force:true}); }
}
await mkdir('.cache/models',{recursive:true});await mkdir('.cache/llama',{recursive:true});
await obtain(`https://huggingface.co/${MODEL.repo}/resolve/${MODEL.revision}/${MODEL.file}`,`.cache/models/${MODEL.file}`,MODEL.sha256);
if(process.platform==='linux'&&process.arch==='x64'){
  await obtain(runtime.url,'.cache/llama/runtime.tar.gz',runtime.sha256);
  const extracted=spawnSync('tar',['-xzf','.cache/llama/runtime.tar.gz','-C','.cache/llama'],{stdio:'inherit'});
  if(extracted.error||extracted.status!==0)throw Error('Could not extract runtime with tar');
  await access('.cache/llama/llama-b11724/llama-server');
}else console.log('Use a llama.cpp b11724 build for your platform and set LLAMA_SERVER to its executable path.');
await writeFile('.cache/character-provenance.json',JSON.stringify({model:MODEL,runtime},null,2)+'\n');
console.log('Model verified. Start: npm run character');
