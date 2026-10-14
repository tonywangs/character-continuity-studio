import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { build, readStory } from '../src/export.js';
import { createModel } from '../src/engine.js';
import { encodeSave } from '../src/saves.js';
import { witness } from '../src/search.js';
import { LIMITS } from '../src/limits.js';
import { tiny, counter } from '../test/fixtures.js';

// The browser is provisioned once. The checks themselves never install anything.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.cache/browsers');
const { chromium } = await import('playwright');
const start = performance.now();
const temporary = await mkdtemp(join(tmpdir(), 'continuity-browser-'));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
const evidence = { browser: browser.version(), networking: 'Browser contexts offline; all HTTP(S) requests aborted and counted', requests: [], pageErrors: [], checks: [], domCounts: {} };
async function context(options = {}) {
  const c = await browser.newContext({ viewport: { width: 1200, height: 850 }, acceptDownloads: true, offline: true, ...options });
  await c.route(/^https?:/, route => { evidence.requests.push(route.request().url()); return route.abort(); });
  c.on('page', p => p.on('pageerror', e => evidence.pageErrors.push(e.message)));
  return c;
}
const file = path => pathToFileURL(path).href;
async function scene(page) { return page.locator('#scene-title').textContent(); }
async function click(page, id) {
  await page.locator(`[data-choice="${id}"]`).click();
  // Each choice persists asynchronously; wait until the transaction unlocks.
  await page.waitForFunction(() => !document.querySelector('#export-save').disabled);
}
async function exportSave(page, selector = '#export-save') {
  const waiting = page.waitForEvent('download'); await page.locator(selector).click();
  const download = await waiting; const path = await download.path(); return await readFile(path, 'utf8');
}
async function importSave(page, text) {
  await page.locator('#import-save').setInputFiles({ name: 'transfer.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await page.waitForFunction(() => !document.querySelector('#import-save').disabled && document.querySelector('#import-save').value === '');
}
async function narrow(page) {
  await page.setViewportSize({ width: 360, height: 780 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow at 360px');
}
try {
  const exported = await build('stories/bellwether.json', join(temporary, 'story'));
  const { story } = await readStory('stories/bellwether.json');
  const model = createModel(story); const report = exported.report;
  let transfer;
  for (const ending of story.scenes.filter(s => s.ending)) {
    const c = await context(); const page = await c.newPage();
    await page.goto(file(join(temporary,'story/player.html')));
    await page.waitForSelector('#scene-title');
    assert.match(await page.locator('main').textContent(), /Before you begin/);
    const node = report.nodes.findIndex(n => n.state.scene === ending.id);
    for (const id of witness(report,node)) await click(page,id);
    assert.equal(await scene(page), ending.title);
    const saved = await exportSave(page);
    assert.deepEqual(JSON.parse(saved).choices,witness(report,node));
    evidence.domCounts[`ending_${ending.id}`] = await page.locator('*').count();
    await narrow(page);
    if (ending.id === 'commons') transfer = saved;
    await page.reload(); await page.waitForSelector('#scene-title'); assert.equal(await scene(page),ending.title);
    await c.close(); evidence.checks.push(`played and restored ending ${ending.id}`);
  }
  {
    const c = await context();const page=await c.newPage();await page.goto(file(join(temporary,'story/player.html')));await page.waitForSelector('#scene-title');
    await importSave(page,transfer); assert.match(await scene(page),/record in common/);
    const retained=await exportSave(page);
    const bad=JSON.parse(transfer);bad.choices=[];
    for (const [label,text] of [
      ['tampered',JSON.stringify(bad)],['oversized',' '.repeat(LIMITS.saveBytes+1)],
      ['incompatible',JSON.stringify({...JSON.parse(transfer),storyHash:'wrong'})],
      ['unknown version',JSON.stringify({...JSON.parse(transfer),version:88})],
      ['extra state',JSON.stringify({...JSON.parse(transfer),state:{named:false}})],
      ['malformed','{'],
    ]) {
      await importSave(page,text);assert.match(await page.locator('[role=status]').textContent(),/Could not complete/);
      assert.equal(await exportSave(page),retained,`${label} must not replace progress`);
    }
    await page.locator('#undo').click();await page.waitForFunction(()=>!document.querySelector('#export-save').disabled);assert.match(await scene(page),/A name/);
    await page.locator('#restart').click();await page.waitForFunction(()=>!document.querySelector('#export-save').disabled);assert.match(await scene(page),/A light before/);
    // Use actual tab traversal and Enter, not a programmatic click.
    await page.reload();await page.waitForSelector('#scene-title');
    let found=false;
    for(let i=0;i<30;i++) {await page.keyboard.press('Tab');if(await page.evaluate(()=>document.activeElement?.dataset.choice==='enter')){found=true;break;}}
    assert.ok(found,'first choice reachable by keyboard');
    const focus=await page.evaluate(()=>({width:getComputedStyle(document.activeElement).outlineWidth,style:getComputedStyle(document.activeElement).outlineStyle}));
    assert.equal(focus.style,'solid');assert.ok(parseFloat(focus.width)>=3);
    await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('#scene-title')?.textContent==='What Ivo remembers');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'scene-title');
    await narrow(page);evidence.domCounts.player=await page.locator('*').count();
    if(process.env.CONTINUITY_SCREENSHOTS) await page.screenshot({path:join(process.env.CONTINUITY_SCREENSHOTS,'player-mobile.png'),fullPage:true});
    await c.close();evidence.checks.push('portable save transfer; atomic rejection of six invalid saves; undo/restart; keyboard traversal, activation and visible focus; narrow viewport');
  }
  {
    const c=await context();const page=await c.newPage();await page.goto(file(join(temporary,'story/player.html')));await page.waitForSelector('#scene-title');
    for(const id of ['enter','hurry','skip_loft','open_archive','read_ledger','straight_pump','isolate','promise'])await click(page,id);
    assert.ok(await page.locator('[data-choice=ask_consent]').isDisabled());
    assert.match(await page.locator('#reason-ask_consent').textContent(),/not met/);
    for(const id of ['gather','choose_record'])await click(page,id);
    assert.ok(await page.locator('[data-choice=publish_named_promised]').isDisabled());
    assert.ok(await page.locator('[data-choice=publish_unnamed_promised]').isEnabled());
    await click(page,'publish_unnamed_promised');assert.match(await page.locator('main').textContent(),/kept the promise/);
    await page.locator('#restart').click();await page.waitForFunction(()=>!document.querySelector('#export-save').disabled);
    for(const id of ['enter','listen','search_loft','take_coupling','open_archive','read_ledger','check_roof','remember_tide','repair','promise','ask_consent','record_consent','choose_record','publish_named_promised'])await click(page,id);
    assert.match(await scene(page),/record in common/);assert.ok(!await page.locator('.warning').count());
    await c.close();evidence.checks.push('remembered rescue enables consent; privacy promise blocks naming without permission; both kept-promise outcomes played');
  }
  {
    const c=await context();await c.addInitScript(()=>{
      Storage.prototype.getItem=function(){throw new DOMException('Blocked','SecurityError');};
      Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};
    });
    const page=await c.newPage();await page.goto(file(join(temporary,'story/player.html')));await page.waitForSelector('#scene-title');
    assert.match(await page.locator('#storage-status').textContent(),/could not be restored/);
    await click(page,'enter');assert.match(await page.locator('#storage-status').textContent(),/in memory only/);
    assert.deepEqual(JSON.parse(await exportSave(page)).choices,['enter']);
    await c.close();evidence.checks.push('blocked browser storage preserves in-memory play and portable export');
  }
  {
    const c=await context();await c.addInitScript(()=>{
      Storage.prototype.getItem=function(){return '{broken';};
      window.storageWrites=0;Storage.prototype.setItem=function(){window.storageWrites++;};
    });
    const page=await c.newPage();await page.goto(file(join(temporary,'story/player.html')));await page.waitForSelector('#scene-title');
    assert.match(await page.locator('#storage-status').textContent(),/without overwriting/);
    assert.equal(await page.evaluate(()=>window.storageWrites),0);
    await c.close();evidence.checks.push('corrupt stored progress is reported and left untouched on startup');
  }
  {
    await build('stories/broken-promise.json',join(temporary,'broken'));
    const c=await context();const page=await c.newPage();await page.goto(file(join(temporary,'broken/report.html')));
    await page.locator('[data-entry="0"]').click();
    await page.locator('#replay-next').click();assert.match(await page.locator('#inspector').textContent(),/false → true/);
    await page.locator('#replay-next').click();assert.match(await page.locator('#inspector').textContent(),/Continuity warning/);
    const saved=await exportSave(page,'#export-witness');assert.deepEqual(JSON.parse(saved).choices,['pledge','publish']);
    const player=await c.newPage();await player.goto(file(join(temporary,'broken/player.html')));await player.waitForSelector('#scene-title');await importSave(player,saved);
    assert.equal(await scene(player),'Contradiction');assert.match(await player.locator('main').textContent(),/Continuity warning/);
    await page.locator('#replay-previous').click();assert.equal(await scene(page),'The publication');
    await narrow(page);evidence.domCounts.counterexample=await page.locator('*').count();
    await c.close();evidence.checks.push('shortest counterexample stepped, state changes inspected, witness save transferred into player');
  }
  {
    const story=counter(10);const input=join(temporary,'many.json');await writeFile(input,JSON.stringify(story));
    const built=await build(input,join(temporary,'many'));
    assert.equal(built.report.findings.length,1025); // 1,024 false invariants plus the final nonterminal dead end.
    const c=await context();const page=await c.newPage();await page.goto(file(join(temporary,'many/report.html')));
    let rendered=0,maxDom=0;
    // Visit every finding page: no finding is silently truncated from the report.
    do {
      rendered+=await page.locator('#report-rows button').count();
      maxDom=Math.max(maxDom,await page.locator('*').count());
      if(await page.locator('#next-page').isDisabled()) break;
      await page.locator('#next-page').click();
    } while(true);
    assert.equal(rendered,1025);assert.ok(maxDom<250,`report DOM should stay bounded, saw ${maxDom}`);
    await page.locator('#report-rows button').last().click();await page.locator('#replay-end').click();
    assert.match(await page.locator('#inspector').textContent(),/Step 10 of 10/);
    evidence.domCounts.reportPagesMaximum=maxDom;evidence.domCounts.reportWithInspector=await page.locator('*').count();
    await page.locator('#report-view').selectOption('states');await page.locator('#report-page').fill('52');await page.locator('#go-page').click();
    assert.match(await page.locator('#list-status').textContent(),/page 52 of 52/);
    await page.locator('#report-view').selectOption('scenes');assert.equal(await page.locator('#report-rows button').count(),1);
    await narrow(page);
    if(process.env.CONTINUITY_SCREENSHOTS) await page.screenshot({path:join(process.env.CONTINUITY_SCREENSHOTS,'report-mobile.png'),fullPage:true});
    await c.close();evidence.checks.push('all 1,025 findings reachable across 52 bounded pages; direct page navigation; state/scene browsers');
    evidence.artifactSizes1024=built.sizes;
    await build(input,join(temporary,'incomplete'),{maxStates:1});
    const cc=await context();const pp=await cc.newPage();await pp.goto(file(join(temporary,'incomplete/report.html')));
    assert.match(await pp.locator('main').textContent(),/Incomplete search: state limit/);await cc.close();
  }
  {
    const hostile='</script><script>globalThis.pwned=1</script><img src="https://hostile.invalid/x" onerror="globalThis.pwned=2"> & </title> \u2028';
    const story=tiny();story.title=hostile;story.scenes[0].text=hostile;story.scenes[0].choices[0].text=hostile;story.invariants[0].assert=false;story.invariants[0].message=hostile;
    const input=join(temporary,'hostile.json');await writeFile(input,JSON.stringify(story));await build(input,join(temporary,'hostile'));
    const c=await context();const page=await c.newPage();await page.goto(file(join(temporary,'hostile/player.html')));await page.waitForSelector('#scene-title');
    assert.equal(await page.locator('h1').textContent(),hostile);assert.equal(await page.locator('main img').count(),0);assert.equal(await page.evaluate(()=>globalThis.pwned),undefined);
    await narrow(page);await click(page,'finish');assert.match(await page.locator('main').textContent(),/globalThis.pwned/);assert.equal(await page.evaluate(()=>globalThis.pwned),undefined);
    await page.goto(file(join(temporary,'hostile/report.html')));await page.locator('[data-entry="0"]').click();await page.locator('#replay-end').click();
    assert.equal(await page.evaluate(()=>globalThis.pwned),undefined);assert.equal(await page.locator('img').count(),0);await narrow(page);
    await c.close();evidence.checks.push('hostile imported text remains literal in title, prose, choices and findings with networking blocked');
  }
  {
    const multiline=tiny();multiline.scenes[0].text='A\n\n'.repeat(3000);multiline.scenes[0].lines=Array.from({length:16},()=>({when:true,text:'B\n\n'.repeat(3000)}));
    const input=join(temporary,'multiline.json');await writeFile(input,JSON.stringify(multiline));await build(input,join(temporary,'multiline'));
    const c=await context();const page=await c.newPage();await page.goto(file(join(temporary,'multiline/report.html')));
    await page.locator('#report-view').selectOption('states');await page.locator('[data-entry="0"]').click();
    const count=await page.locator('*').count();assert.ok(count<200,`embedded blank lines must not expand the DOM: ${count}`);
    evidence.domCounts.multilineProse=count;await c.close();evidence.checks.push('51,000 prose lines render with a bounded number of text elements');
  }
  {
    const loop=tiny();loop.scenes=[loop.scenes[0]];loop.scenes[0].choices=[{id:'again',text:'Again',to:'start',effects:[]}];loop.invariants=[];
    const input=join(temporary,'loop.json');await writeFile(input,JSON.stringify(loop));const built=await build(input,join(temporary,'loop'));
    const saved=await encodeSave(createModel(loop),built.hash,Array(LIMITS.history).fill('again'));
    const c=await context();const page=await c.newPage();await page.goto(file(join(temporary,'loop/player.html')));await page.waitForSelector('#scene-title');await importSave(page,saved);
    assert.ok(await page.locator('[data-choice=again]').isDisabled());assert.match(await page.locator('main').textContent(),/History limit reached/);
    assert.equal(JSON.parse(await exportSave(page)).choices.length,LIMITS.history);
    await page.locator('#undo').click();await page.waitForFunction(()=>!document.querySelector('[data-choice=again]').disabled);
    evidence.domCounts.maximumHistory=await page.locator('*').count();await c.close();evidence.checks.push('2,000-choice history boundary blocks further play, retains export and undo, without rendering history nodes');
  }
  assert.deepEqual(evidence.requests,[],'no external requests attempted');assert.deepEqual(evidence.pageErrors,[],'no browser exceptions');
  evidence.wallMilliseconds=Math.round((performance.now()-start)*100)/100;
  console.log(JSON.stringify(evidence,null,2));
  if(process.env.CONTINUITY_BROWSER_EVIDENCE) await writeFile(process.env.CONTINUITY_BROWSER_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
} finally { await browser.close();await rm(temporary,{recursive:true,force:true}); }
