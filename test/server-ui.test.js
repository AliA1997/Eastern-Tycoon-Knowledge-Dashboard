import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { makeRoot, startApp } from './helpers.js';
import { readJsonl } from '../lib/jsonl.js';

let root;
let app;
beforeEach(async () => {
  root = await makeRoot();
  app = await startApp(root, {
    uiEditor: async (item) => {
      if (item.prompt === 'break') throw new Error('Claude Code failed: crashed');
      return { summary: `Done: ${item.prompt}`, files: ['public/styles.css'] };
    },
  });
});
afterEach(async () => { await app.close(); });

test('a UI change is queued, applied, listed and logged', async () => {
  const res = await app.post('/api/ui-change', { prompt: 'Bigger title', selector: 'h1', text: 'Eastern', html: '<h1>' + 'x'.repeat(5000) });
  assert.equal(res.status, 202);
  assert.equal((await res.json()).status, 'queued');
  await app.server.queue.whenIdle();
  const [item] = await (await fetch(app.base + '/api/ui-queue')).json();
  assert.deepEqual([item.status, item.summary], ['done', 'Done: Bigger title']);
  const [logged] = await readJsonl(join(root, 'feedback/ui-changes.jsonl'));
  assert.deepEqual([logged.status, logged.selector, logged.prompt], ['done', 'h1', 'Bigger title']);
});

test('a failed change is listed with its error', async () => {
  await app.post('/api/ui-change', { prompt: 'break' });
  await app.server.queue.whenIdle();
  const [item] = await (await fetch(app.base + '/api/ui-queue')).json();
  assert.deepEqual([item.status, item.error], ['failed', 'Claude Code failed: crashed']);
});

test('an empty prompt is a 400', async () => {
  assert.equal((await app.post('/api/ui-change', { prompt: ' ' })).status, 400);
});

test('the event stream sends queue updates and a reload after a change is done', async () => {
  const controller = new AbortController();
  const res = await fetch(app.base + '/api/events', { signal: controller.signal });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  await app.post('/api/ui-change', { prompt: 'x' });
  const deadline = Date.now() + 3000;
  while (!text.includes('event: reload') && Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ value: undefined }), 500))]);
    if (chunk.done) break;
    if (chunk.value) text += decoder.decode(chunk.value);
  }
  controller.abort();
  assert.match(text, /event: ui-queue/);
  assert.match(text, /event: reload/);
});
