import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadDossier, newSession, generateTurn, hash, localEndpoint } from '../src/character.js';
import { modelProvenance } from '../src/character-provenance.js';

const output = process.argv[2];
if (!output) throw Error('Usage: node scripts/evaluate-character.js NEW_OUTPUT_DIRECTORY');
const endpoint = localEndpoint(process.env.CONTINUITY_MODEL_URL);
const dossier = await loadDossier();
const protocol = JSON.parse(await readFile(new URL('../characters/evaluation.json', import.meta.url)));
await mkdir(output); // Never silently overwrite an experiment.
const manifest = { format: 1, started: new Date().toISOString(), dossierHash: hash(dossier),
  protocolHash: hash(JSON.stringify(protocol)), endpoint, runs: [], status: 'running' };
const checkpoint = () => writeFile(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
await checkpoint();
try {
await writeFile(`${output}/protocol.json`, JSON.stringify(protocol, null, 2) + '\n');
await writeFile(`${output}/dossier.md`, dossier);
for (const [route, filename] of [['/props', 'server-properties.json'], ['/v1/models', 'server-models.json']]) {
  const response = await fetch(`${endpoint}${route}`, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!response.ok) throw Error(`Cannot archive model identity: HTTP ${response.status}`);
  await writeFile(`${output}/${filename}`, JSON.stringify(await response.json(), null, 2) + '\n');
}
const properties = JSON.parse(await readFile(`${output}/server-properties.json`, 'utf8'));
await writeFile(`${output}/provenance.json`, JSON.stringify(await modelProvenance(properties, process.env.CONTINUITY_MODEL), null, 2) + '\n');
  for (const scenario of protocol.scenarios) for (const seed of protocol.seeds) for (const memory of [true, false]) {
    let session = newSession(dossier, seed, memory);
    const filename = `${scenario.id}-${seed}-${memory ? 'memory' : 'control'}.json`;
    const run = { scenario: scenario.id, seed, memory, filename, completedTurns: 0 };
    manifest.runs.push(run);
    await checkpoint();
    for (const prompt of scenario.turns) {
      session = await generateTurn(session, dossier, prompt, endpoint);
      await writeFile(`${output}/${filename}`, JSON.stringify(session, null, 2) + '\n');
      run.completedTurns = session.turns.length;
      await checkpoint();
      console.log(`${filename}: ${run.completedTurns}/${scenario.turns.length} (${session.turns.at(-1).elapsedMs} ms)`);
    }
  }
  manifest.status = 'complete';
} catch (error) {
  manifest.status = 'failed'; manifest.error = error.message; throw error;
} finally { manifest.finished = new Date().toISOString(); await checkpoint(); }
