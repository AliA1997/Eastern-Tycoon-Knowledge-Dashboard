import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeRoot, startApp } from './helpers.js';
import { readJsonl } from '../lib/jsonl.js';

let root;
let app;
beforeEach(async () => {
  process.env.FAKE_CLAUDE_MODE = 'answer';
  delete process.env.FAKE_DELAY_MS;
  root = await makeRoot();
  app = await startApp(root);
});
afterEach(async () => { await app.close(); });

test('GET / injects the ui-queue script when missing and is never cached', async () => {
  await writeFile(join(root, 'public', 'index.html'), '<html><body><p>hi</p></body></html>');
  const res = await fetch(app.base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(await res.text(), '<html><body><p>hi</p><script src="/ui-queue.js" defer></script></body></html>');
});

test('GET / leaves a page that already loads ui-queue.js alone', async () => {
  const html = '<html><body><script src="/ui-queue.js" defer></script></body></html>';
  await writeFile(join(root, 'public', 'index.html'), html);
  assert.equal(await (await fetch(app.base + '/')).text(), html);
});

test('static files cannot escape public/', async () => {
  const res = await fetch(app.base + '/..%2fkb.config.json');
  assert.equal(res.status, 403);
  assert.equal((await fetch(app.base + '/nope.css')).status, 404);
});

test('ask returns the answer with parsed sources', async () => {
  const res = await app.post('/api/ask', { question: 'How do dice work?' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.answer, 'Echo: /kb-answer How do dice work?');
  assert.deepEqual(body.sources, ['artifacts/api-server/src/domains/dice/index.ts', 'RUNNING_LOCALLY.md']);
  assert.equal(body.isNo, false);
  assert.equal(typeof body.id, 'string');
});

test('ask passes shell metacharacters through verbatim', async () => {
  const question = `it's "quoted" && echo $(whoami) | rm -rf ~\nsecond line`;
  const body = await (await app.post('/api/ask', { question })).json();
  assert.equal(body.answer, `Echo: /kb-answer ${question}`);
});

test('ask flags the No reply', async () => {
  process.env.FAKE_CLAUDE_MODE = 'no';
  const body = await (await app.post('/api/ask', { question: 'Capital of France?' })).json();
  assert.equal(body.isNo, true);
  assert.deepEqual(body.sources, []);
});

test('ask rejects an empty or oversized question', async () => {
  assert.equal((await app.post('/api/ask', { question: '   ' })).status, 400);
  assert.equal((await app.post('/api/ask', { question: 'x'.repeat(2001) })).status, 400);
  assert.equal((await app.post('/api/ask', 'not json')).status, 400);
});

test('a Claude failure is a 502 error, never a No', async () => {
  process.env.FAKE_CLAUDE_MODE = 'fail';
  const res = await app.post('/api/ask', { question: 'q' });
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, 'Claude Code failed');
  assert.equal('answer' in body, false);
});

test('an empty answer is a 502', async () => {
  process.env.FAKE_CLAUDE_MODE = 'empty';
  assert.equal((await app.post('/api/ask', { question: 'q' })).status, 502);
});

test('a timed-out ask is a 502', async () => {
  await app.close();
  app = await startApp(root, { timeouts: { ask: 300 } });
  process.env.FAKE_CLAUDE_MODE = 'hang';
  const res = await app.post('/api/ask', { question: 'q' });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /took too long/);
});

test('feedback is appended with the question and answer', async () => {
  const asked = await (await app.post('/api/ask', { question: 'How do dice work?' })).json();
  assert.equal((await app.post('/api/feedback', { id: asked.id, rating: 'up' })).status, 200);
  const [entry] = await readJsonl(join(root, 'feedback/feedback.jsonl'));
  assert.equal(entry.rating, 'up');
  assert.equal(entry.question, 'How do dice work?');
  assert.equal(entry.answer, asked.answer);
  assert.deepEqual(entry.sources, asked.sources);
});

test('feedback for an unknown id falls back to the posted question and answer', async () => {
  const ok = await app.post('/api/feedback', { id: 'gone', rating: 'down', question: 'Q', answer: 'A', sources: ['x.md'] });
  assert.equal(ok.status, 200);
  const [entry] = await readJsonl(join(root, 'feedback/feedback.jsonl'));
  assert.deepEqual([entry.question, entry.answer, entry.sources], ['Q', 'A', ['x.md']]);
  assert.equal((await app.post('/api/feedback', { id: 'gone', rating: 'down' })).status, 404);
  assert.equal((await app.post('/api/feedback', { id: 'gone', rating: 'meh' })).status, 400);
});

test('context is saved as a sanitized markdown file and logged', async () => {
  const asked = await (await app.post('/api/ask', { question: '../../Secret: plans?' })).json();
  const { path } = await (await app.post('/api/context', { id: asked.id, text: 'The plan is X.' })).json();
  assert.match(path, /^context\/manual\/\d{4}-\d{2}-\d{2}-secret-plans\.md$/);
  const text = await readFile(join(root, path), 'utf8');
  assert.match(text, /^---\nsource: "manual"\nquestion: "\.\.\/\.\.\/Secret: plans\?"/);
  assert.match(text, /The plan is X\.\n$/);
  const log = await readJsonl(join(root, 'feedback/feedback.jsonl'));
  assert.deepEqual([log.at(-1).type, log.at(-1).path], ['context-added', path]);
  const second = await (await app.post('/api/context', { id: asked.id, text: 'More.' })).json();
  assert.match(second.path, /-secret-plans-2\.md$/);
});

test('context requires text', async () => {
  assert.equal((await app.post('/api/context', { id: 'x', text: '  ' })).status, 400);
});

test('sync returns the new run record; last-sync reports it', async () => {
  assert.equal(await (await fetch(app.base + '/api/sync/last')).json(), null);
  process.env.FAKE_CLAUDE_MODE = 'sync';
  const res = await app.post('/api/sync', {});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).added, 1);
  assert.equal((await (await fetch(app.base + '/api/sync/last')).json()).added, 1);
});

test('a sync that never commits is a 502 naming blocked tools', async () => {
  process.env.FAKE_CLAUDE_MODE = 'sync-noop';
  const res = await app.post('/api/sync', {});
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.match(body.error, /did not finish/);
  assert.match(body.detail, /Blocked tools: mcp__claude_ai_Google_Drive__search_files/);
});

test('an overlapping sync is a 409', async () => {
  process.env.FAKE_CLAUDE_MODE = 'sync';
  process.env.FAKE_DELAY_MS = '800';
  const first = app.post('/api/sync', {});
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await app.post('/api/sync', {})).status, 409);
  assert.equal((await first).status, 200);
});

test('sync without a Drive folder is a 400', async () => {
  await writeFile(join(root, 'kb.config.json'), JSON.stringify({ driveFolderId: '', repoPath: root }));
  const res = await app.post('/api/sync', {});
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /No Drive folder/);
});

test('unknown API routes are 404', async () => {
  assert.equal((await fetch(app.base + '/api/nope')).status, 404);
});
