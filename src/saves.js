import { LIMITS } from './limits.js';

export async function digest(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}
function payload(hash, choices) { return JSON.stringify(['continuity-save', 1, hash, choices]); }
export async function encodeSave(model, storyHash, choices) {
  model.replay(choices);
  const checksum = await digest(payload(storyHash, choices));
  const text = JSON.stringify({ format: 'continuity-save', version: 1, storyHash, choices, checksum }, null, 2);
  if (new TextEncoder().encode(text).byteLength > LIMITS.saveBytes) throw new Error('Save exceeds byte limit');
  return text;
}
export async function decodeSave(model, storyHash, text) {
  if (typeof text !== 'string' || text.length > LIMITS.saveBytes || new TextEncoder().encode(text).byteLength > LIMITS.saveBytes) throw new Error('Save exceeds byte limit');
  let save;
  try { save = JSON.parse(text); } catch { throw new Error('Save is not valid JSON'); }
  if (!save || typeof save !== 'object' || Array.isArray(save) || Object.keys(save).sort().join(',') !== 'checksum,choices,format,storyHash,version') throw new Error('Invalid save fields');
  if (save.format !== 'continuity-save' || save.version !== 1) throw new Error('Unsupported save version');
  if (save.storyHash !== storyHash) throw new Error('Save belongs to different story content');
  if (!Array.isArray(save.choices) || save.choices.length > LIMITS.history || save.choices.some(c => typeof c !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/.test(c))) throw new Error('Invalid save history');
  if (typeof save.checksum !== 'string' || save.checksum !== await digest(payload(storyHash, save.choices))) throw new Error('Save checksum mismatch');
  const { state } = model.replay(save.choices);
  return { choices: [...save.choices], state };
}
