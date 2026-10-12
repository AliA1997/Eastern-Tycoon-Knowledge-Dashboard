// Eastern Tycoon Knowledge — local server. Serves public/ and runs Claude Code headlessly.
import http from 'node:http';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runClaude, interpretRun } from './lib/claude.js';
import { askArgs, syncArgs } from './lib/claude-args.js';
import { parseAnswer } from './lib/answer.js';
import { loadConfig } from './lib/config.js';
import { createEventHub } from './lib/events.js';
import { appendJsonl, lastJsonl, readJsonl } from './lib/jsonl.js';
import { formatFrontmatter } from './lib/frontmatter.js';
import { slugify } from './lib/slug.js';
import { PATHS } from './lib/sync-state.js';

const MAX_BODY_BYTES = 64 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const str = (v) => (typeof v === 'string' ? v : '');
const exists = (p) => access(p).then(() => true, () => false);

export function ensureUiQueueScript(html) {
  if (/<script[^>]+src=["']\/?ui-queue\.js["']/i.test(html)) return html;
  const tag = '<script src="/ui-queue.js" defer></script>';
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${tag}</body>`) : html + tag;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  let body;
  try { body = JSON.parse(text); } catch { throw new HttpError(400, 'Request body must be JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Request body must be a JSON object.');
  return body;
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

export function createApp({ root, claudeCmd, timeouts = {}, uiEditor } = {}) {
  const limits = { ask: 120_000, sync: 600_000, uiEdit: 300_000, ...timeouts };
  const publicDir = resolve(root, 'public');
  const answers = new Map();
  const hub = createEventHub();
  const feedbackLog = join(root, 'feedback/feedback.jsonl');
  let syncing = false;

  const routes = {
    'GET /api/sync/last': async () => [200, await lastJsonl(join(root, PATHS.runs))],

    'POST /api/ask': async (body) => {
      const question = str(body.question).trim();
      if (!question) throw new HttpError(400, 'Type a question first.');
      if (question.length > 2000) throw new HttpError(400, 'Questions are limited to 2,000 characters.');
      const cfg = await loadConfig(root);
      const started = Date.now();
      const run = await runClaude({ cmd: claudeCmd, args: askArgs(question, cfg), cwd: root, timeoutMs: limits.ask });
      const outcome = interpretRun(run);
      if (!outcome.ok) return [502, { error: outcome.error, detail: outcome.detail }];
      const { answer, sources, isNo } = parseAnswer(outcome.result);
      if (!answer) return [502, { error: 'Claude returned an empty answer. Try again.' }];
      const record = { id: randomUUID(), question, answer, sources, isNo, ms: Date.now() - started };
      answers.set(record.id, record);
      return [200, record];
    },

    'POST /api/sync': async () => {
      if (syncing) return [409, { error: 'A sync is already running.' }];
      syncing = true; // set before any await so two quick clicks can't both start a sync
      try {
        const cfg = await loadConfig(root);
        if (!cfg.driveFolderId) return [400, { error: 'No Drive folder is set. Add driveFolderId to kb.config.json.' }];
        const runsPath = join(root, PATHS.runs);
        const before = (await readJsonl(runsPath)).length;
        const run = await runClaude({ cmd: claudeCmd, args: syncArgs(cfg), cwd: root, timeoutMs: limits.sync });
        const outcome = interpretRun(run);
        if (!outcome.ok) return [502, { error: outcome.error, detail: outcome.detail }];
        const runs = await readJsonl(runsPath);
        if (runs.length <= before) {
          const blocked = outcome.denied.length ? `\nBlocked tools: ${[...new Set(outcome.denied)].join(', ')}` : '';
          return [502, { error: 'Sync did not finish', detail: (outcome.result + blocked).trim().slice(0, 2000) }];
        }
        return [200, runs[runs.length - 1]];
      } finally {
        syncing = false;
      }
    },

    'POST /api/feedback': async (body) => {
      const { id, rating } = body;
      if (rating !== 'up' && rating !== 'down') throw new HttpError(400, 'rating must be "up" or "down".');
      const entry = answers.get(id) ?? (typeof body.question === 'string' && typeof body.answer === 'string'
        ? { question: body.question, answer: body.answer, sources: Array.isArray(body.sources) ? body.sources.filter((s) => typeof s === 'string') : [] }
        : null);
      if (!entry) return [404, { error: 'That answer is no longer on the server. Ask the question again.' }];
      await appendJsonl(feedbackLog, {
        at: new Date().toISOString(), id: str(id) || null, question: entry.question, answer: entry.answer, sources: entry.sources ?? [], rating,
      });
      return [200, { ok: true }];
    },

    'POST /api/context': async (body) => {
      const text = str(body.text).trim();
      if (!text) throw new HttpError(400, 'Write the missing context first.');
      if (text.length > 20_000) throw new HttpError(400, 'Context notes are limited to 20,000 characters.');
      const question = answers.get(body.id)?.question ?? str(body.question);
      const dir = join(root, 'context/manual');
      await mkdir(dir, { recursive: true });
      const now = new Date();
      const base = `${now.toISOString().slice(0, 10)}-${slugify(question || text.split('\n')[0])}`;
      let name = `${base}.md`;
      for (let n = 2; await exists(join(dir, name)); n++) name = `${base}-${n}.md`;
      const content = formatFrontmatter({ source: 'manual', question, added: now.toISOString() }) + '\n' + text + '\n';
      await writeFile(join(dir, name), content, { encoding: 'utf8', flag: 'wx' });
      const path = `context/manual/${name}`;
      await appendJsonl(feedbackLog, { at: now.toISOString(), id: str(body.id) || null, type: 'context-added', path });
      return [200, { path }];
    },
  };

  async function serveStatic(pathname, res) {
    let rel;
    try { rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { rel = null; }
    const file = rel === null ? null : resolve(publicDir, rel);
    if (!file || !file.startsWith(publicDir + sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Forbidden');
    }
    let data;
    try {
      data = await readFile(file);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const body = file === join(publicDir, 'index.html') ? ensureUiQueueScript(data.toString('utf8')) : data;
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/events') return hub.handle(req, res);
      const handler = routes[`${req.method} ${url.pathname}`];
      if (handler) {
        const body = req.method === 'POST' ? await readBody(req) : {};
        const [status, data] = await handler(body);
        return sendJson(res, status, data);
      }
      if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
      return await serveStatic(url.pathname, res);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      console.error(err);
      return sendJson(res, 500, { error: 'Server error', detail: err.message });
    }
  });
  server.on('close', () => hub.close());
  server.hub = hub;
  server.routes = routes;
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const root = dirname(fileURLToPath(import.meta.url));
  const cfg = await loadConfig(root);
  if (!(await exists(cfg.repoPath))) console.warn(`Warning: repoPath not found: ${cfg.repoPath}`);
  const server = createApp({ root, claudeCmd: [process.env.CLAUDE_BIN || 'claude'] });
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${cfg.port} is already in use. Is the harness already running?` : err.message);
    process.exit(1);
  });
  server.listen(cfg.port, '127.0.0.1', () => {
    console.log(`Eastern Tycoon Knowledge is running at http://127.0.0.1:${cfg.port}`);
  });
}
