import test from 'node:test';
import assert from 'node:assert/strict';
import { createModel } from '../src/engine.js';
import { encodeSave, decodeSave, digest } from '../src/saves.js';
import { LIMITS } from '../src/limits.js';
import { tiny } from './fixtures.js';

test('versioned saves reconstruct by replay and round trip deterministically', async () => {
  const model = createModel(tiny()); const hash = await digest('original bytes');
  const text = await encodeSave(model, hash, ['finish']);
  assert.equal(text, await encodeSave(model, hash, ['finish']));
  assert.deepEqual(await decodeSave(model, hash, text), { choices: ['finish'], state: model.step(model.initial(), 'finish').state });
  assert.equal((await decodeSave(model, hash, await encodeSave(model, hash, []))).state.scene, 'start');
});

test('tampered, oversized, incompatible, extra-state and invalid replay saves are rejected', async () => {
  const model = createModel(tiny()); const hash = await digest('story');
  const valid = await encodeSave(model, hash, ['finish']);
  for (const change of [s => s.version = 2, s => s.storyHash = 'other', s => s.choices = [], s => s.checksum = 'x', s => s.state = { flag: false }, s => s.choices = ['unknown'], s => s.choices = Array(2001).fill('finish'), s => s.choices = [3]]) {
    const bad = JSON.parse(valid); change(bad); await assert.rejects(decodeSave(model, hash, JSON.stringify(bad)));
  }
  await assert.rejects(decodeSave(model, hash, ' '.repeat(LIMITS.saveBytes + 1)), /byte limit/);
  await assert.rejects(decodeSave(model, hash, '{'), /JSON/);
  // A recomputed unkeyed checksum still cannot authorize an unavailable choice.
  const choices = ['finish', 'finish'];
  const save = JSON.parse(valid); save.choices = choices;
  save.checksum = await digest(JSON.stringify(['continuity-save', 1, hash, choices]));
  await assert.rejects(decodeSave(model, hash, JSON.stringify(save)), /does not exist/);
  const conditional = tiny(); conditional.scenes[0].choices[0].when = false;
  await assert.rejects(decodeSave(createModel(conditional), hash, valid), /unavailable/);
});
