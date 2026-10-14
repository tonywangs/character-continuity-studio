#!/usr/bin/env node
import { readStory, build } from './export.js';
import { createModel } from './engine.js';
import { explore, witness } from './search.js';
import { decodeSave } from './saves.js';
import { LIMITS } from './limits.js';
import { constants } from 'node:fs';

const help = `Character Continuity Studio · offline authoring tools

  continuity validate STORY.json
  continuity check STORY.json [limits]
  continuity build STORY.json OUTPUT-DIRECTORY [limits]
  continuity replay STORY.json CHOICE-ID ...
  continuity load STORY.json SAVE.json

Limits: --states N --transitions N --findings N --depth N --milliseconds N
Output directories must not exist. The parent must already exist.
check exits 0 when exhaustive and clean, 2 for findings/unreachable scenes,
3 for incomplete search, 1 for errors, 130 for cancellation.
build exits 0 after a successful export, even if its report contains findings.
Use report.json.exhaustive and findings to assess an exported report.
`;
const controller = new AbortController();
let timedOut = false;
const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, LIMITS.operationMilliseconds);
deadline.unref();
process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());
async function main(args) {
  const [command, input, ...rest] = args;
  if (!command || ['--help', '-h', 'help'].includes(command)) { console.log(help); return; }
  if (!['validate', 'check', 'build', 'replay', 'load'].includes(command) || !input) throw new Error(help);
  const options = { signal: controller.signal };
  let output;
  if (command === 'build') { output = rest.shift(); if (!output || output.startsWith('--')) throw new Error('build requires an output directory'); }
  if (['validate', 'check', 'build'].includes(command)) {
    const flags = { '--states': 'maxStates', '--transitions': 'maxTransitions', '--findings': 'maxFindings', '--depth': 'maxDepth', '--milliseconds': 'maxMilliseconds' };
    for (let i = 0; i < rest.length; i += 2) {
      if (command === 'validate' || !flags[rest[i]] || !/^\d+$/.test(rest[i + 1] ?? '')) throw new Error(`Invalid option ${rest[i]}`);
      const key = flags[rest[i]];
      if (options[key] !== undefined) throw new Error(`Duplicate option ${rest[i]}`);
      options[key] = Number(rest[i + 1]);
    }
  }
  if (command === 'build') {
    const result = await build(input, output, options);
    console.log(JSON.stringify({ output, storyHash: result.hash, exhaustive: result.report.exhaustive, reasons: result.report.reasons, ...result.report.counts, sizes: result.sizes }, null, 2));
    return;
  }
  const { story, hash } = await readStory(input);
  if (command === 'validate') { console.log(`Valid format 1: ${story.title} (${story.scenes.length} scenes). SHA-256 ${hash}`); return; }
  const model = createModel(story);
  if (command === 'replay') {
    const result = model.replay(rest, { trace: true });
    console.log(JSON.stringify({ ...result, violations: model.violations(result.state) }, null, 2)); return;
  }
  if (command === 'load') {
    if (rest.length !== 1) throw new Error('load requires exactly one save filename');
    // A capped handle read avoids allocating an arbitrarily large imported save.
    const { open } = await import('node:fs/promises');
    const f = await open(rest[0], constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      if (!(await f.stat()).isFile()) throw new Error('Save must be a regular file');
      const buffer = Buffer.alloc(LIMITS.saveBytes + 1);
      let size = 0;
      while (size < buffer.length) { const r = await f.read(buffer, size, buffer.length - size, null); if (!r.bytesRead) break; size += r.bytesRead; }
      if (size > LIMITS.saveBytes) throw new Error('Save exceeds byte limit');
      console.log(JSON.stringify(await decodeSave(model, hash, new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))), null, 2));
    } finally { await f.close(); }
    return;
  }
  const report = await explore(model, options);
  // Compact console result; full findings and all witnesses live in build's report.
  const sample = report.findings.slice(0, 10).map(f => ({ ...f, choices: witness(report, f.node) }));
  console.log(JSON.stringify({ storyHash: hash, exhaustive: report.exhaustive, reasons: report.reasons, ...report.counts, unreached: report.unreached, firstFindings: sample }, null, 2));
  process.exitCode = controller.signal.aborted ? 130 : !report.exhaustive ? 3 : report.findings.length || report.unreached.length ? 2 : 0;
}
try { await main(process.argv.slice(2)); }
catch (error) { console.error(`continuity: ${timedOut ? 'Operation exceeded its 60-second deadline. ' : ''}${error.message}`); process.exitCode = controller.signal.aborted ? 130 : 1; }
finally { clearTimeout(deadline); }
