// Explicit opt-in: makes one actual inference call to the already running model.
// Run after the paired experiment, without concurrent chat/evaluation requests.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createCharacterServer } from '../src/character-server.js';
import { localEndpoint } from '../src/character.js';

const output = process.argv[2];
if (!output) throw Error('Usage: node scripts/character-real-check.js NEW_EVIDENCE_FILE');
const handle = await import('node:fs/promises').then(fs => fs.open(output, 'wx'));
const directory = await mkdtemp(join(tmpdir(), 'bellwether-real-'));
const options = { directory, endpoint: localEndpoint(process.env.CONTINUITY_MODEL_URL), port: 0 };
let app, browser;
try {
  app = await createCharacterServer(options);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:${app.address().port}`);
  const user = 'Ivo, I have time to listen. Why did you open the flood gate last winter?';
  await page.getByLabel('Speak to Ivo').fill(user);
  await page.getByRole('button', { name: 'Send to local model' }).click();
  await page.getByText('Reply saved to your notebook.', { exact: true }).waitFor({ timeout: 950_000 });
  const session = JSON.parse(await readFile(join(directory, 'session.json'), 'utf8'));
  assert.equal(session.turns.length, 1);
  assert.equal(session.turns[0].user, user);
  assert.ok(session.turns[0].response.system_fingerprint);
  assert.equal(await page.locator('#dialogue article').count(), 2);
  await new Promise(resolve => app.close(resolve));
  app = await createCharacterServer(options);
  await page.goto(`http://127.0.0.1:${app.address().port}`);
  await page.getByText('Scene ready.', { exact: true }).waitFor();
  assert.equal(await page.locator('#dialogue article').count(), 2);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export full notebook' }).click();
  const download = await downloadPromise;
  assert.deepEqual(JSON.parse(await readFile(await download.path(), 'utf8')), session);
  await handle.writeFile(JSON.stringify({ passed: true, at: new Date().toISOString(), browser: browser.version(),
    inference: 'real local model', checks: ['browser send and generated reply', 'disk persistence across app restart', 'download equals persisted notebook'], session }, null, 2) + '\n');
  console.log(`Real model browser check passed: ${output}`);
} catch (error) {
  await handle.writeFile(JSON.stringify({ passed: false, at: new Date().toISOString(), error: error.message }, null, 2) + '\n');
  throw error;
} finally {
  await handle.close(); await browser?.close();
  if (app) await new Promise(resolve => app.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
