// The exporter embeds this trusted program and the shared engine. Imported story
// strings only reach textContent. No HTML, JavaScript, URLs, or CSS are imported.
const data = JSON.parse(document.getElementById('story-data').textContent);
const model = createModel(data.story);
const root = document.getElementById('app');
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function button(text, action, className) {
  const b = el('button', text, className); b.type = 'button'; b.addEventListener('click', action); return b;
}
function paragraphs(parent, text, className) {
  // CSS preserves blank lines. One element per field also bounds the DOM when
  // hostile text contains thousands of paragraph separators.
  parent.append(el('p', text, className));
}
function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = el('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const shell = el('div', undefined, 'shell'); root.append(shell);
const header = el('header', undefined, 'masthead');
header.append(el('p', data.mode === 'report' ? 'Character Continuity Studio / Author report' : 'Character Continuity Studio / An offline story', 'eyebrow'), el('h1', model.story.title));
header.append(el('p', data.mode === 'report' ? 'Inspect declared properties. Replay the choices that led here.' : model.story.objective, 'subtitle'));
shell.append(header);
const status = el('p', '', 'status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
function message(text, error = false) { status.textContent = text; status.className = error ? 'status error' : 'status'; }
function showState(parent, state) {
  const list = el('ul', undefined, 'state-list');
  for (let i = 0; i < model.story.variables.length; i++) {
    const v = model.story.variables[i];
    const owner = model.story.characters.find(c => c.id === v.owner);
    const row = el('li'); row.append(el('strong', v.label), el('span', `${state.values[i]}${owner ? ` · ${owner.name}` : ''}${v.kind ? ` · ${v.kind}` : ''}`)); list.append(row);
  }
  if (!model.story.variables.length) list.append(el('li', 'No state variables declared.'));
  parent.append(list);
}
function showScene(parent, state, { onChoice, limited = false } = {}) {
  const scene = model.scenes.get(state.scene);
  parent.append(el('p', scene.ending ? 'The end' : 'The story continues', 'eyebrow'));
  const title = el('h2', scene.title); title.id = 'scene-title'; title.tabIndex = -1; parent.append(title);
  paragraphs(parent, scene.text, 'prose');
  for (const line of scene.lines ?? []) if (model.evaluate(line.when, state)) paragraphs(parent, line.text, 'prose');
  if (scene.ending) parent.append(el('p', 'This is one possible ending. Export a save to keep it, or start over to explore another path.', 'small'));
  const choices = model.choices(state);
  if (!scene.ending && !choices.some(c => c.available)) parent.append(el('p', 'No available choices. This is a nonterminal dead end; the author report can help diagnose it.', 'warning'));
  if (limited) parent.append(el('p', `History limit reached (${LIMITS.history} choices). Export a save, undo, or start over.`, 'warning'));
  for (const c of choices) {
    const b = button(c.text, () => onChoice?.(c.id), 'choice');
    b.disabled = !c.available || !onChoice || limited;
    b.dataset.choice = c.id;
    const reason = el('span', `${c.available ? 'Available' : 'Unavailable'} — ${c.reason}`, 'reason');
    reason.id = `reason-${c.id}`; b.setAttribute('aria-describedby', reason.id);
    parent.append(b, reason);
  }
  for (const violation of model.violations(state)) parent.append(el('p', `Continuity warning: ${violation.message} ${violation.reason}`, 'warning'));
}
function showChanges(parent, changes) {
  if (!changes.length) { parent.append(el('p', 'No state variables changed.', 'small')); return; }
  const list = el('ul', undefined, 'trace');
  for (const change of changes) {
    const v = model.story.variables.find(v => v.id === change.variable);
    list.append(el('li', `${v.label}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`));
  }
  parent.append(list);
}

async function startPlayer() {
  let history = [];
  let state = model.initial();
  let busy = false;
  const storageKey = `continuity:v1:${data.hash}`;
  let storageAvailable = true;
  const layout = el('main', undefined, 'layout'); layout.id = 'main';
  const column = el('div', undefined, 'story');
  const intro = el('details', undefined, 'card intro'); intro.open = true;
  intro.append(el('summary', 'Before you begin'));
  paragraphs(intro, model.story.introduction);
  const stage = el('section'); stage.setAttribute('aria-labelledby', 'scene-title');
  const controls = el('div', undefined, 'controls');
  const back = button('Undo last choice', () => transact(async () => {
    if (!history.length) return;
    history = history.slice(0, -1); state = model.replay(history).state;
    await persist(); render(true);
  })); back.id = 'undo';
  const restart = button('Start over', () => transact(async () => {
    history = []; state = model.initial(); intro.open = true;
    await persist(); render(true);
  })); restart.id = 'restart';
  const save = button('Export save', () => transact(async () => {
    download(await encodeSave(model, data.hash, history), `${model.story.id}.save.json`);
    message('Save exported. It contains a validated choice history, not an editable state snapshot.');
  })); save.id = 'export-save';
  controls.append(back, restart, save);
  const importLabel = el('label', 'Import a save (.json)', 'file-label'); importLabel.htmlFor = 'import-save';
  const input = el('input', undefined, 'file-input'); input.type = 'file'; input.accept = '.json,application/json'; input.id = 'import-save';
  input.addEventListener('change', () => transact(async () => {
    const file = input.files[0]; if (!file) return;
    try {
      if (file.size > LIMITS.saveBytes) throw new Error('Save exceeds byte limit');
      const candidate = await decodeSave(model, data.hash, await file.text());
      // Nothing has changed before both checksum verification and replay succeed.
      history = candidate.choices; state = candidate.state; intro.open = history.length === 0;
      await persist(); render(true); message(`Save imported.${storageAvailable ? '' : ' Browser storage is unavailable; keep an exported copy.'}`);
    } finally { input.value = ''; }
  }));
  const storageStatus = el('p', '', 'small'); storageStatus.id = 'storage-status';
  const changes = el('details', undefined, 'card'); changes.append(el('summary', 'What changed with the last choice?'));
  const changeBody = el('div'); changes.append(changeBody);
  column.append(intro, stage, controls, importLabel, input, status, storageStatus, changes);
  const aside = el('aside');
  const cast = el('section', undefined, 'card'); cast.append(el('h3', 'The people in this story'));
  for (const c of model.story.characters) cast.append(el('p', c.name, 'cast-name'), el('p', c.description, 'cast-description'));
  const notebook = el('details', undefined, 'card'); notebook.open = true; notebook.append(el('summary', 'Memories, commitments & facts'));
  const stateBody = el('div'); notebook.append(stateBody); aside.append(cast, notebook); layout.append(column, aside); shell.append(layout);
  function lock(value) {
    busy = value;
    for (const b of controls.querySelectorAll('button')) b.disabled = value;
    input.disabled = value;
    for (const b of stage.querySelectorAll('button')) b.disabled = value || !model.choices(state).find(c => c.id === b.dataset.choice).available || history.length >= LIMITS.history;
    back.disabled = value || history.length === 0;
  }
  async function transact(fn) {
    if (busy) return;
    lock(true);
    try { await fn(); } catch (e) { message(`Could not complete action: ${e.message}. Current progress is retained.`, true); }
    finally { lock(false); }
  }
  async function persist() {
    try {
      localStorage.setItem(storageKey, await encodeSave(model, data.hash, history)); storageAvailable = true;
      storageStatus.textContent = 'Saved in this browser. Export a file to transfer or keep a durable copy.';
    } catch {
      storageAvailable = false;
      storageStatus.textContent = 'Browser storage is unavailable or full. Progress is in memory only; export a save before closing.';
    }
  }
  async function choose(id) {
    await transact(async () => {
      if (history.length >= LIMITS.history) throw new Error('History limit reached');
      const next = model.step(state, id);
      history = [...history, id]; state = next.state; intro.open = false;
      await persist(); render(true); message(`Choice ${history.length} recorded.`);
    });
  }
  function render(focus = false) {
    stage.replaceChildren(); showScene(stage, state, { onChoice: choose, limited: history.length >= LIMITS.history });
    stateBody.replaceChildren(); showState(stateBody, state);
    changeBody.replaceChildren();
    if (history.length) {
      const previous = model.replay(history.slice(0, -1)).state;
      const next = model.step(previous, history.at(-1));
      changeBody.append(el('p', `${previous.scene} → ${state.scene} · ${history.at(-1)}`, 'mono')); showChanges(changeBody, next.changes);
    } else changeBody.append(el('p', 'The story begins with the declared initial state.', 'small'));
    back.disabled = history.length === 0;
    if (focus) document.getElementById('scene-title').focus();
  }
  try {
    const text = localStorage.getItem(storageKey);
    if (text !== null) {
      const loaded = await decodeSave(model, data.hash, text); history = loaded.choices; state = loaded.state; intro.open = history.length === 0;
      message('Restored a validated save from this browser.');
    }
    storageStatus.textContent = 'Browser storage can be read. Progress will be saved after your first action; export files for durable copies.';
  } catch (e) {
    storageAvailable = false;
    storageStatus.textContent = `Stored progress could not be restored: ${e.message}. Started fresh without overwriting it. Export files to keep progress.`;
  }
  render();
}

function startReport() {
  const report = data.report;
  const main = el('main'); main.id = 'main'; shell.append(main);
  main.append(el('p', report.exhaustive ? 'Exhaustive within the declared finite model.' : `Incomplete search: ${report.reasons.join(', ')}. Absence of a finding is not proof.`, report.exhaustive ? 'badge' : 'warning'));
  main.append(el('p', `${report.counts.states} states discovered · ${report.counts.processed} checked · ${report.counts.transitions} transitions tried · ${report.findings.length} findings · ${report.unreached.length} ${report.exhaustive ? 'unreachable' : 'unobserved'} scenes`, 'subtitle'));
  main.append(el('p', 'Findings refer to declared conditions only. They do not measure literary quality, psychological realism, or character intelligence.', 'small'));
  const grid = el('div', undefined, 'report-grid');
  const listColumn = el('section', undefined, 'card');
  const filterLabel = el('label', 'Browse report '); filterLabel.htmlFor = 'report-view';
  const filter = el('select'); filter.id = 'report-view';
  for (const [value, label] of [['findings','Findings & unreached scenes'],['scenes','All scenes'],['states','Discovered states']]) { const o = el('option', label); o.value = value; filter.append(o); }
  listColumn.append(filterLabel, filter);
  const listStatus = el('p', '', 'small'); listStatus.id = 'list-status'; listStatus.setAttribute('aria-live', 'polite');
  const rows = el('div'); rows.id = 'report-rows';
  const pager = el('div', undefined, 'pager');
  const prev = button('Previous page', () => { page--; renderRows(); }); prev.id = 'previous-page';
  const pageLabel = el('label', 'Page'); pageLabel.htmlFor = 'report-page';
  const pageInput = el('input'); pageInput.id = 'report-page'; pageInput.type = 'number'; pageInput.min = '1';
  const go = button('Go', () => { page = Number(pageInput.value) - 1; renderRows(); }); go.id = 'go-page';
  const next = button('Next page', () => { page++; renderRows(); }); next.id = 'next-page';
  pager.append(prev, pageLabel, pageInput, go, next); listColumn.append(listStatus, rows, pager);
  const inspector = el('section', undefined, 'card'); inspector.id = 'inspector';
  grid.append(listColumn, inspector); main.append(grid, status);
  let view = 'findings'; let page = 0; let path = []; let position = 0; let selection = '';
  const sceneNodes = new Map();
  report.nodes.forEach((n, i) => { if (!sceneNodes.has(n.state.scene)) sceneNodes.set(n.state.scene, i); });
  const findingRows = [...report.findings, ...report.unreached.map(s => ({ kind: s.status, scene: s.scene, message: `${s.ending ? 'Ending' : 'Scene'} ${s.scene} was ${s.status === 'unreachable' ? 'not reachable after exhaustive exploration' : 'not observed in this incomplete search'}.` }))];
  function entries() {
    if (view === 'findings') return findingRows;
    if (view === 'scenes') return model.story.scenes.map(s => ({ kind: s.ending ? 'ending' : 'scene', node: sceneNodes.get(s.id), scene: s.id, message: s.title }));
    return report.nodes;
  }
  function pathTo(index) {
    const ids = [];
    while (report.nodes[index].parent !== null) { ids.push(report.nodes[index].choice); index = report.nodes[index].parent; }
    return ids.reverse();
  }
  function renderRows() {
    const all = entries(); const pages = Math.max(1, Math.ceil(all.length / LIMITS.pageSize));
    page = Number.isFinite(page) ? Math.max(0, Math.min(pages - 1, Math.floor(page))) : 0;
    pageInput.value = String(page + 1); pageInput.max = String(pages); prev.disabled = page === 0; next.disabled = page === pages - 1;
    listStatus.textContent = `${all.length} entries · page ${page + 1} of ${pages} · at most ${LIMITS.pageSize} entries rendered`;
    rows.replaceChildren();
    if (!all.length) rows.append(el('p', report.exhaustive ? 'No findings. Every scene was reached.' : 'No findings observed yet. This search is incomplete.'));
    all.slice(page * LIMITS.pageSize, (page + 1) * LIMITS.pageSize).forEach((row, offset) => {
      const index = page * LIMITS.pageSize + offset;
      const nodeIndex = view === 'states' ? index : row.node;
      const title = view === 'states' ? `State ${index} · ${row.state.scene} · ${row.depth} choices` : `${row.kind}${row.invariant ? ` · ${row.invariant}` : ''}`;
      const b = button('', () => {
        if (nodeIndex === undefined) {
          inspector.replaceChildren(el('h2', row.scene), el('p', row.message), el('p', 'There is no observed replay for this scene. Incomplete searches cannot establish unreachability.', 'small'));
          return;
        }
        path = pathTo(nodeIndex); position = 0; selection = `${title}${row.message ? ': ' + row.message : ''}`; renderInspector(true);
      }, 'finding');
      b.dataset.entry = String(index); b.append(el('strong', `${index + 1}. ${title}`));
      if (row.message) b.append(el('span', row.message, 'small')); rows.append(b);
    });
  }
  function renderInspector(focus = false) {
    inspector.replaceChildren();
    const heading = el('h2', 'Replay inspector'); heading.tabIndex = -1; inspector.append(heading, el('p', selection, 'small'));
    inspector.append(el('p', `Step ${position} of ${path.length}. Witnesses use the fewest choices; ties follow story order.`, 'small'));
    const nav = el('div', undefined, 'controls');
    const first = button('Reset replay', () => { position = 0; renderInspector(); }); first.id = 'replay-reset'; first.disabled = position === 0;
    const previous = button('Previous step', () => { position--; renderInspector(); }); previous.id = 'replay-previous'; previous.disabled = position === 0;
    const advance = button('Next step', () => { position++; renderInspector(); }); advance.id = 'replay-next'; advance.disabled = position === path.length;
    const end = button('Go to outcome', () => { position = path.length; renderInspector(); }); end.id = 'replay-end'; end.disabled = position === path.length;
    const exportButton = button('Export witness save', async () => {
      try { download(await encodeSave(model, data.hash, path), `${model.story.id}.witness.save.json`); message('Full witness exported. Import it in player.html to reach this outcome.'); }
      catch (e) { message(e.message, true); }
    }); exportButton.id = 'export-witness'; nav.append(first, previous, advance, end, exportButton); inspector.append(nav);
    const state = model.replay(path.slice(0, position)).state;
    const info = el('details'); info.open = true; info.append(el('summary', position ? `Choice: ${path[position - 1]}` : 'Initial state'));
    if (position) {
      const before = model.replay(path.slice(0, position - 1)).state;
      const choice = model.choices(before).find(c => c.id === path[position - 1]);
      info.append(el('p', choice.reason, 'small'), el('p', `${before.scene} → ${state.scene}`, 'mono'));
      showChanges(info, model.step(before, path[position - 1]).changes);
    }
    inspector.append(info);
    const stage = el('div'); showScene(stage, state); inspector.append(stage);
    const stateDetails = el('details'); stateDetails.append(el('summary', 'All state values')); showState(stateDetails, state); inspector.append(stateDetails);
    // A single step is rendered, regardless of witness length.
    if (focus) heading.focus();
  }
  filter.addEventListener('change', () => { view = filter.value; page = 0; renderRows(); });
  pageInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); page = Number(pageInput.value) - 1; renderRows(); } });
  inspector.append(el('h2', 'Follow a choice to its consequence'), el('p', 'Select a finding, scene, or discovered state. Step through its shortest witness and inspect the exact changes.'));
  renderRows();
}
if (data.mode === 'report') startReport();
else startPlayer().catch(e => message(`Unable to start: ${e.message}`, true));
const footer = el('footer'); footer.append(el('p', 'Offline by design · No external requests or model inference · Story format 1'), el('p', `Story SHA-256: ${data.hash}`, 'mono')); shell.append(footer);
