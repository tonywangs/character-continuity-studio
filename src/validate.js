import { LIMITS } from './limits.js';

export class StoryError extends Error {
  constructor(path, message) { super(`${path}: ${message}`); this.name = 'StoryError'; }
}
const fail = (p, m) => { throw new StoryError(p, m); };
function object(v, p, required, optional = []) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(p, 'expected an object');
  for (const k of required) if (!Object.hasOwn(v, k)) fail(p, `missing ${k}`);
  for (const k of Object.keys(v)) if (![...required, ...optional].includes(k)) fail(p, `unknown field ${k}`);
}
function string(v, p, max = LIMITS.text) {
  if (typeof v !== 'string' || !v.trim() || v.length > max) fail(p, `expected nonempty text, at most ${max} characters`);
}
function identifier(v, p) {
  if (typeof v !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/.test(v)) fail(p, 'expected a stable lowercase identifier (1–48 characters)');
}
function list(v, p, max, min = 0) {
  if (!Array.isArray(v) || v.length < min || v.length > max) fail(p, `expected ${min}–${max} entries`);
}
function unique(entries, p) {
  const seen = new Set();
  entries.forEach((v, i) => {
    identifier(v.id, `${p}[${i}].id`);
    if (seen.has(v.id)) fail(p, `duplicate id ${v.id}`);
    seen.add(v.id);
  });
  return seen;
}
export function inDomain(def, v) {
  if (def.type === 'boolean') return typeof v === 'boolean';
  if (def.type === 'integer') return Number.isSafeInteger(v) && v >= def.min && v <= def.max;
  return typeof v === 'string' && def.values.includes(v);
}

/** Strict, finite, declarative JSON. No expressions are evaluated as source code. */
export function validateStory(story) {
  object(story, '$', ['format', 'id', 'title', 'introduction', 'objective', 'characters', 'variables', 'start', 'scenes', 'invariants']);
  if (story.format !== 1) fail('$.format', 'only format 1 is supported');
  identifier(story.id, '$.id');
  for (const k of ['title', 'introduction', 'objective']) string(story[k], `$.${k}`, k === 'title' ? 200 : LIMITS.text);
  list(story.characters, '$.characters', LIMITS.characters, 1);
  story.characters.forEach((c, i) => {
    object(c, `$.characters[${i}]`, ['id', 'name', 'description']);
    string(c.name, `$.characters[${i}].name`, 100);
    string(c.description, `$.characters[${i}].description`, 2000);
  });
  const characters = unique(story.characters, '$.characters');
  list(story.variables, '$.variables', LIMITS.variables);
  story.variables.forEach((v, i) => {
    const p = `$.variables[${i}]`;
    object(v, p, ['id', 'label', 'type', 'initial'], ['min', 'max', 'values', 'kind', 'owner']);
    string(v.label, `${p}.label`, 200);
    if (!['boolean', 'integer', 'enum'].includes(v.type)) fail(p, 'type must be boolean, integer, or enum');
    if (v.type === 'integer') {
      if (!Number.isSafeInteger(v.min) || !Number.isSafeInteger(v.max) || v.min > v.max || v.max - v.min >= LIMITS.domain) fail(p, `integer domain must contain 1–${LIMITS.domain} safe integers`);
      if (v.values !== undefined) fail(p, 'integer cannot have values');
    } else if (v.type === 'enum') {
      list(v.values, `${p}.values`, LIMITS.domain, 1);
      v.values.forEach(x => string(x, `${p}.values`, 80));
      if (new Set(v.values).size !== v.values.length) fail(p, 'duplicate enum values');
      if (v.min !== undefined || v.max !== undefined) fail(p, 'enum cannot have min/max');
    } else if (['min', 'max', 'values'].some(k => v[k] !== undefined)) fail(p, 'boolean cannot have min/max/values');
    if (!inDomain(v, v.initial)) fail(`${p}.initial`, 'value is outside the declared domain');
    if (v.kind !== undefined && !['fact', 'memory', 'commitment'].includes(v.kind)) fail(p, 'unknown variable kind');
    if (v.owner !== undefined && !characters.has(v.owner)) fail(p, 'unknown character owner');
    if (['memory', 'commitment'].includes(v.kind) && !v.owner) fail(p, 'memories and commitments require an owner');
    if (v.kind === 'memory' && v.type !== 'boolean') fail(p, 'memories must be boolean');
    if (v.kind === 'commitment' && (v.type !== 'enum' || JSON.stringify(v.values) !== JSON.stringify(['unmade', 'promised', 'kept', 'broken']))) fail(p, 'commitments use enum [unmade, promised, kept, broken]');
  });
  unique(story.variables, '$.variables');
  const variables = new Map(story.variables.map(v => [v.id, v]));
  list(story.scenes, '$.scenes', LIMITS.scenes, 1);
  story.scenes.forEach((s, i) => object(s, `$.scenes[${i}]`, ['id', 'title', 'text', 'choices'], ['ending', 'lines']));
  const scenes = unique(story.scenes, '$.scenes');
  if (!scenes.has(story.start)) fail('$.start', 'unknown scene');

  function expression(expr, p) {
    let count = 0;
    function visit(e, path, depth) {
      if (++count > LIMITS.expressionNodes || depth > LIMITS.expressionDepth) fail(path, 'condition exceeds complexity limit');
      if (typeof e === 'boolean') return;
      if (!e || typeof e !== 'object' || Array.isArray(e)) fail(path, 'expected boolean or condition object');
      if (Object.hasOwn(e, 'all') || Object.hasOwn(e, 'any')) {
        const k = Object.hasOwn(e, 'all') ? 'all' : 'any';
        object(e, path, [k]); list(e[k], path, 16, 1);
        e[k].forEach((x, i) => visit(x, `${path}.${k}[${i}]`, depth + 1));
      } else if (Object.hasOwn(e, 'not')) {
        object(e, path, ['not']); visit(e.not, `${path}.not`, depth + 1);
      } else if (Object.hasOwn(e, 'scene')) {
        object(e, path, ['scene']);
        if (!scenes.has(e.scene)) fail(path, 'unknown scene');
      } else {
        object(e, path, ['var', 'op', 'value']);
        const def = variables.get(e.var);
        if (!def) fail(path, `unknown variable ${e.var}`);
        if (!['eq', 'ne', 'lt', 'le', 'gt', 'ge'].includes(e.op)) fail(path, 'unknown comparison');
        if (!['eq', 'ne'].includes(e.op) && def.type !== 'integer') fail(path, 'ordering requires an integer variable');
        if (!inDomain(def, e.value)) fail(path, 'comparison value is outside the variable domain');
      }
    }
    visit(expr, p, 1);
  }
  const choiceIds = new Set();
  story.scenes.forEach((s, i) => {
    const p = `$.scenes[${i}]`;
    string(s.title, `${p}.title`, 200); string(s.text, `${p}.text`);
    if (s.ending !== undefined && typeof s.ending !== 'boolean') fail(p, 'ending must be boolean');
    list(s.choices, `${p}.choices`, LIMITS.choicesPerScene);
    if (s.ending && s.choices.length) fail(p, 'ending scenes cannot have choices');
    if (s.lines !== undefined) {
      list(s.lines, `${p}.lines`, 16);
      s.lines.forEach((line, j) => {
        object(line, `${p}.lines[${j}]`, ['when', 'text']); string(line.text, p); expression(line.when, `${p}.lines[${j}].when`);
      });
    }
    s.choices.forEach((c, j) => {
      const cp = `${p}.choices[${j}]`;
      object(c, cp, ['id', 'text', 'to', 'effects'], ['when']);
      identifier(c.id, `${cp}.id`);
      if (choiceIds.has(c.id)) fail(cp, `choice id ${c.id} must be globally unique`);
      choiceIds.add(c.id); string(c.text, `${cp}.text`, 1000);
      if (!scenes.has(c.to)) fail(`${cp}.to`, `unknown scene ${c.to}`);
      if (c.when !== undefined) expression(c.when, `${cp}.when`);
      list(c.effects, `${cp}.effects`, LIMITS.variables);
      const assigned = new Set();
      c.effects.forEach((e, k) => {
        const ep = `${cp}.effects[${k}]`;
        object(e, ep, ['var', 'value']);
        const def = variables.get(e.var);
        if (!def) fail(ep, `unknown variable ${e.var}`);
        if (!inDomain(def, e.value)) fail(ep, 'effect value is outside the declared domain');
        if (assigned.has(e.var)) fail(ep, 'a choice may assign each variable only once');
        assigned.add(e.var);
      });
    });
  });
  list(story.invariants, '$.invariants', LIMITS.invariants);
  story.invariants.forEach((inv, i) => {
    const p = `$.invariants[${i}]`;
    object(inv, p, ['id', 'message', 'assert'], ['when']);
    string(inv.message, `${p}.message`, 2000);
    expression(inv.assert, `${p}.assert`);
    if (inv.when !== undefined) expression(inv.when, `${p}.when`);
  });
  unique(story.invariants, '$.invariants');
  return story;
}

export function parseStory(text) {
  if (typeof text !== 'string') fail('$', 'expected JSON text');
  if (text.length > LIMITS.inputBytes || new TextEncoder().encode(text).byteLength > LIMITS.inputBytes) fail('$', `input exceeds ${LIMITS.inputBytes} bytes`);
  let value;
  try { value = JSON.parse(text); } catch { fail('$', 'invalid JSON'); }
  return validateStory(value);
}
