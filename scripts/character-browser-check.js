// UI integration uses an explicitly fake inference endpoint; quality is evaluated separately.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createCharacterServer } from '../src/character-server.js';

const directory=await mkdtemp(join(tmpdir(),'bellwether-browser-'));
const model=http.createServer(async(req,res)=>{for await(const chunk of req){};res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'I remember your promise. <script>window.bad=true</script>'}}],model:'explicit-test-double'}));});
await new Promise(r=>model.listen(0,'127.0.0.1',r));
const app=await createCharacterServer({directory,endpoint:`http://127.0.0.1:${model.address().port}`,port:0});
let browser;
try {
  browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${app.address().port}`);
  await page.getByLabel('Speak to Ivo').fill('I promise to ask before broadcasting your name.');
  await page.getByRole('button',{name:'Send to local model'}).click();
  await page.getByText('Reply saved to your notebook.').waitFor();
  assert.equal(await page.locator('#dialogue article').count(),2);
  assert.equal(await page.evaluate(()=>window.bad),undefined);
  await page.reload();await page.getByText('Scene ready.',{exact:true}).waitFor();
  assert.equal(await page.locator('#dialogue article').count(),2);
  await page.getByText('Inspect remembered dialogue',{exact:true}).click();
  assert.match(await page.locator('#memory').innerText(),/I promise to ask/);
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export full notebook'}).click();
  const download=await downloadPromise;assert.match(download.suggestedFilename(),/^bellwether-/);
  await page.getByLabel('Enable conversation memory').uncheck();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Start new scene'}).click();
  await page.getByText('New scene ready.',{exact:true}).waitFor();assert.equal(await page.locator('#dialogue article').count(),0);
  assert.match(await page.locator('#mode').innerText(),/Memory off/);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const evidence={passed:true,browser:browser.version(),inference:'explicit test double; not evidence of model quality',checks:['send and render','HTML rendered as text','reload persistence','inspect notebook','JSON download','new scene and memory control','mobile width'],at:new Date().toISOString()};
  if(process.env.CONTINUITY_CHARACTER_BROWSER_EVIDENCE)await writeFile(process.env.CONTINUITY_CHARACTER_BROWSER_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence,null,2));
}finally{await browser?.close();await new Promise(r=>app.close(r));await new Promise(r=>model.close(r));await rm(directory,{recursive:true,force:true});}
