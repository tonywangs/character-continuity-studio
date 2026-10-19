import { spawn } from 'node:child_process';
import { access, mkdir, open } from 'node:fs/promises';
import { createCharacterServer } from '../src/character-server.js';
import { localEndpoint } from '../src/character.js';
import { MODEL } from '../src/character-model.js';

const endpoint = localEndpoint(process.env.CONTINUITY_MODEL_URL);
let child, app, log;
async function close() { if (app) app.close(); if (child) child.kill('SIGTERM'); await log?.close(); }
process.once('SIGINT', () => { close().finally(() => process.exit(0)); });
process.once('SIGTERM', () => { close().finally(() => process.exit(0)); });
try {
  if (!process.env.CONTINUITY_MODEL_URL) {
    const binary = process.env.LLAMA_SERVER || '.cache/llama/llama-b11724/llama-server';
    const model = process.env.CONTINUITY_MODEL || `.cache/models/${MODEL.file}`;
    await access(binary); await access(model); await mkdir('.cache/llama', { recursive: true });
    log = await open('.cache/llama/play-server.log', 'w');
    child = spawn(binary, ['-m', model, '--host', '127.0.0.1', '--port', '8091', '-ngl', '0', '-t', '1', '-c', '8192', '--parallel', '1', '--jinja', '--no-webui', '--no-context-shift'], { stdio: ['ignore', log.fd, log.fd] });
    let launchError;
    child.on('error', error => { launchError = error; });
    console.log('Loading the local CPU model…');
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (launchError || child.exitCode !== null) throw launchError || Error('Model server exited; inspect .cache/llama/play-server.log');
      try { const r = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(1000) }); if (r.ok) { ready = true; break; } } catch {}
    }
    if (!ready) throw Error('Model did not become ready in 120 seconds');
  }
  app = await createCharacterServer({ endpoint, directory: process.env.CONTINUITY_SESSION_DIR || '.cache/character-session', port: Number(process.env.CONTINUITY_PORT || 8787) });
  console.log(`Speak with Ivo: http://127.0.0.1:${app.address().port}`);
  console.log('Ctrl+C stops this app. Your scene remains saved locally.');
} catch (error) { console.error(`${error.message}\nSetup: node scripts/setup-character.js`); await close(); process.exitCode = 1; }
