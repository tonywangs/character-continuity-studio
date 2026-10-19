import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';

export const SETTINGS = Object.freeze({ temperature: 0.7, top_p: 0.8, top_k: 20,
  min_p: 0, presence_penalty: 1.5, max_tokens: 160, cache_prompt: false,
  chat_template_kwargs: { enable_thinking: false } });
export const MAX_TURNS = 12;
export const hash = text => createHash('sha256').update(text).digest('hex');
export const dossierPath = new URL('../characters/ivo.md', import.meta.url);
export async function loadDossier() { return readFile(dossierPath, 'utf8'); }
export function newSession(dossier, seed = 17, memory = true) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) throw Error('Seed must be an integer from 0 to 2147483647');
  if (typeof memory !== 'boolean') throw Error('Memory must be boolean');
  return { format: 1, id: randomUUID(), character: 'ivo', dossierHash: hash(dossier), seed, memory, turns: [] };
}
export function validateSession(session, dossier) {
  if (!session || session.format !== 1 || session.character !== 'ivo' || session.dossierHash !== hash(dossier)
    || !Number.isInteger(session.seed) || session.seed < 0 || session.seed > 2147483647
    || typeof session.memory !== 'boolean' || !Array.isArray(session.turns) || session.turns.length > MAX_TURNS) {
    throw Error('Incompatible session or changed dossier; start a new session');
  }
  for (const turn of session.turns) {
    if (!turn || typeof turn.user !== 'string' || typeof turn.assistant !== 'string'
      || turn.user.length > 1200 || turn.assistant.length > 8000) throw Error('Invalid session turn');
  }
  return session;
}
export function makeRequest(session, dossier, user) {
  validateSession(session, dossier);
  if (typeof user !== 'string' || !user.trim() || user.length > 1200) throw Error('Enter 1–1200 characters');
  if (session.turns.length >= MAX_TURNS) throw Error('This bounded scene has reached 12 turns. Export it and start a new scene.');
  const messages = [{ role: 'system', content: dossier }];
  if (session.memory) for (const turn of session.turns) {
    messages.push({ role: 'user', content: turn.user }, { role: 'assistant', content: turn.assistant });
  }
  messages.push({ role: 'user', content: user.trim() });
  return { ...SETTINGS, seed: session.seed + session.turns.length, messages };
}
export function localEndpoint(value = 'http://127.0.0.1:8091') {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Inference endpoint must be an HTTP loopback origin');
  return url.origin;
}
// Native HTTP honors the supplied total timeout without fetch's independent
// five-minute response-header deadline. CPU prompt processing can exceed it.
export function inferenceFetch(url, { method, headers, body, signal }) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method, headers, signal }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { response.destroy(Error('Local model response exceeds 2 MiB')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode,
          text: async () => text, json: async () => JSON.parse(text) });
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}
export async function generateTurn(session, dossier, user, endpoint, fetcher = inferenceFetch) {
  const request = makeRequest(session, dossier, user);
  const started = performance.now();
  const response = await fetcher(`${localEndpoint(endpoint)}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request), signal: AbortSignal.timeout(900_000), redirect: 'error'
  });
  if (!response.ok) throw Error(`Local model returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const raw = await response.json();
  const choice = raw.choices?.[0];
  if (typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) throw Error('Local model returned no dialogue');
  if (choice.message.content.length > 8000) throw Error('Local model exceeded response limit');
  const turn = { index: session.turns.length, user: user.trim(), assistant: choice.message.content,
    request, response: raw, elapsedMs: Math.round(performance.now() - started),
    truncated: choice.finish_reason !== 'stop' };
  return { ...session, turns: [...session.turns, turn] };
}
export async function saveSession(directory, session) {
  await mkdir(directory, { recursive: true });
  const path = `${directory}/session.json`;
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, path);
}
