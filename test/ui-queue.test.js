import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createUiQueue } from '../lib/ui-queue.js';

test('runs items in order, one at a time', async () => {
  const seen = [];
  let active = 0;
  let maxActive = 0;
  const queue = createUiQueue({
    runEdit: async (item) => {
      active++; maxActive = Math.max(maxActive, active);
      await delay(20);
      seen.push(item.prompt);
      active--;
      return { summary: `did ${item.prompt}`, files: [] };
    },
  });
  for (const prompt of ['a', 'b', 'c']) queue.add({ prompt });
  await queue.whenIdle();
  assert.deepEqual(seen, ['a', 'b', 'c']);
  assert.equal(maxActive, 1);
  assert.deepEqual(queue.list().map((i) => [i.status, i.summary]), [['done', 'did a'], ['done', 'did b'], ['done', 'did c']]);
});

test('a failed item does not block the next', async () => {
  const queue = createUiQueue({
    runEdit: async (item) => { if (item.prompt === 'bad') throw new Error('nope'); return { summary: 'ok', files: [] }; },
  });
  queue.add({ prompt: 'bad' });
  queue.add({ prompt: 'good' });
  await queue.whenIdle();
  assert.deepEqual(queue.list().map((i) => [i.status, i.error]), [['failed', 'nope'], ['done', null]]);
});

test('reports queued → working → done and settles each item once', async () => {
  const statuses = [];
  const settled = [];
  const queue = createUiQueue({
    runEdit: async () => ({ summary: 'ok', files: [] }),
    onChange: (items) => statuses.push(items[0].status),
    onSettled: async (item) => { await delay(10); settled.push(item.status); },
  });
  queue.add({ prompt: 'x' });
  await queue.whenIdle();
  assert.deepEqual(statuses, ['queued', 'working', 'done']);
  assert.deepEqual(settled, ['done']);
});

test('list() exposes only public fields and caps finished history', async () => {
  const queue = createUiQueue({ runEdit: async () => ({ summary: 'ok', files: [] }), maxItems: 2 });
  for (const prompt of ['1', '2', '3']) queue.add({ prompt, html: '<b>secret markup</b>', selector: '#x' });
  await queue.whenIdle();
  const items = queue.list();
  assert.deepEqual(items.map((i) => i.prompt), ['2', '3']);
  assert.deepEqual(Object.keys(items[0]).sort(), ['at', 'error', 'id', 'prompt', 'status', 'summary']);
});
