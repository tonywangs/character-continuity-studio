import { readFile, mkdir, writeFile, rename, rm, open } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { LIMITS } from './limits.js';
import { parseStory } from './validate.js';
import { createModel } from './engine.js';
import { explore } from './search.js';

const sha256 = text => createHash('sha256').update(text).digest('hex');
const cspHash = text => createHash('sha256').update(text).digest('base64');
export async function readStory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Story input must be a regular file');
    // A capped read also handles a file that grows after stat().
    const bytes = Buffer.alloc(LIMITS.inputBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > LIMITS.inputBytes) throw new Error(`Story exceeds ${LIMITS.inputBytes} bytes`);
    const raw = bytes.subarray(0, length);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { throw new Error('Story must be valid UTF-8'); }
    return { story: parseStory(text), hash: sha256(raw) };
  } finally { await handle.close(); }
}
function json(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
function safeTitle(text) { return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

export async function renderArtifacts(story, hash, report, { serialize = JSON.stringify } = {}) {
  const base = new URL('../', import.meta.url);
  const modules = ['src/limits.js', 'src/validate.js', 'src/engine.js', 'src/saves.js', 'web/app.js'];
  const sources = await Promise.all(modules.map(async p => (await readFile(new URL(p, base), 'utf8')).replace(/\r\n?/g, '\n')));
  const script = `'use strict';\n(() => {\n${sources.map(s => s.replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '')).join('\n')}\n})();`;
  const style = (await readFile(new URL('web/style.css', base), 'utf8')).replace(/\r\n?/g, '\n');
  const html = mode => {
    const data = json({ story, hash, mode, report: mode === 'report' ? report : null });
    return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${cspHash(script)}'; style-src 'sha256-${cspHash(style)}'; connect-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>${safeTitle(story.title)} · ${mode === 'report' ? 'Author report' : 'Story'}</title><style>${style}</style></head><body><a class="skip" href="#main">Skip to main content</a><div id="app"></div><noscript>This offline story needs JavaScript enabled. No external requests are made.</noscript><script id="story-data" type="application/json">${data}</script><script>${script}</script></body></html>\n`;
  };
  const reportText = serialize({ storyHash: hash, ...report }, null, 2);
  if (typeof reportText !== 'string') throw new Error('Report serialization did not return text');
  const files = { 'player.html': html('player'), 'report.html': html('report'), 'report.json': reportText + '\n' };
  let total = 0;
  for (const [name, text] of Object.entries(files)) {
    const bytes = Buffer.byteLength(text);
    if (bytes > LIMITS.fileBytes) throw new Error(`${name} exceeds ${LIMITS.fileBytes} byte output limit; lower search limits`);
    total += bytes;
  }
  if (total > LIMITS.outputBytes) throw new Error('Combined output exceeds byte limit; lower search limits');
  return files;
}

/** Create-only export. Nothing is overwritten, including an existing empty folder.
 * Ownership begins with exclusive mkdir; failures remove only that owned folder. */
export async function writeArtifacts(directory, files, { signal, write = writeFile } = {}) {
  const target = resolve(directory);
  let owned = false;
  const check = () => { if (signal?.aborted) throw new Error('Export cancelled'); };
  try {
    check();
    await mkdir(target); owned = true;
    const staging = join(target, '.staging');
    await mkdir(staging);
    for (const [name, text] of Object.entries(files)) {
      check();
      if (basename(name) !== name || name.startsWith('.')) throw new Error('Invalid artifact filename');
      await write(join(staging, name), text, { encoding: 'utf8', flag: 'wx' });
    }
    check();
    for (const name of Object.keys(files)) { check(); await rename(join(staging, name), join(target, name)); }
    await rm(staging, { recursive: true });
    check();
  } catch (error) {
    if (owned) await rm(target, { recursive: true, force: true });
    if (error.code === 'EEXIST' && !owned) throw new Error(`Output already exists: ${target}. Choose a new directory.`);
    if (error.code === 'ENOENT' && !owned) throw new Error(`Output parent does not exist: ${dirname(target)}`);
    throw error;
  }
}

export async function build(input, output, options = {}) {
  const { story, hash } = await readStory(input);
  const report = await explore(createModel(story), options);
  if (options.signal?.aborted) throw new Error('Export cancelled');
  const files = await renderArtifacts(story, hash, report, options);
  if (options.signal?.aborted) throw new Error('Export cancelled');
  // Re-read the source before writing anything; do not export a silently changed input.
  if ((await readStory(input)).hash !== hash) throw new Error('Input changed during export');
  await writeArtifacts(output, files, options);
  return { hash, report, sizes: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, Buffer.byteLength(text)])) };
}
