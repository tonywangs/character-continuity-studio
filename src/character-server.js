import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { loadDossier, newSession, validateSession, generateTurn, saveSession, localEndpoint, MAX_TURNS } from './character.js';

export async function createCharacterServer({ directory = '.cache/character-session', endpoint, port = 8787 } = {}) {
  endpoint = localEndpoint(endpoint);
  const dossier = await loadDossier();
  let session;
  try { session = validateSession(JSON.parse(await readFile(`${directory}/session.json`, 'utf8')), dossier); }
  catch (error) { if (error.code !== 'ENOENT') throw error; session = newSession(dossier); }
  let busy = false;
  const page = await readFile(new URL('../web/character.html', import.meta.url));
  const server = http.createServer(async (req, res) => {
    const reply = (status, value, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
      res.end(type === 'application/json' ? JSON.stringify(value) : value);
    };
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return reply(403, { error: 'Open this app at its 127.0.0.1 address' });
      if (req.method === 'GET' && req.url === '/') return reply(200, page, 'text/html; charset=utf-8');
      if (req.method === 'GET' && req.url === '/api/session') return reply(200, { session, busy, maxTurns: MAX_TURNS });
      if (req.method === 'GET' && req.url === '/api/dossier') return reply(200, { dossier });
      if (req.method !== 'POST' || !['/api/turn', '/api/new'].includes(req.url)) return reply(404, { error: 'Not found' });
      if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, { error: 'Expected application/json' });
      if (busy) return reply(409, { error: 'A reply is still being generated' });
      busy = true;
      try {
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 8192) throw Error('Request too large'); }
        const input = JSON.parse(body);
        const next = req.url === '/api/new' ? newSession(dossier, input.seed ?? 17, input.memory ?? true)
          : await generateTurn(session, dossier, input.text, endpoint);
        await saveSession(directory, next);
        session = next;
        reply(200, { session, busy: false, maxTurns: MAX_TURNS });
      } finally { busy = false; }
    } catch (error) { reply(400, { error: error.message }); }
  });
  server.requestTimeout = 960_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
