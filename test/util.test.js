import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slugify } from '../lib/slug.js';
import { parseFrontmatter, formatFrontmatter } from '../lib/frontmatter.js';
import { appendJsonl, readJsonl, lastJsonl } from '../lib/jsonl.js';
import { readJson, writeJsonAtomic } from '../lib/jsonfile.js';

test('slugify lowercases, strips accents and symbols, caps length', () => {
  assert.equal(slugify('Café Rules: Round #2!'), 'cafe-rules-round-2');
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
  assert.equal(slugify('   '), 'untitled');
  assert.equal(slugify('خطة اللعبة'), 'untitled');
  assert.equal(slugify('a'.repeat(100)).length, 60);
  assert.equal(slugify('x'.repeat(59) + ' yz'), 'x'.repeat(59));
});

test('frontmatter round-trips quoted values containing colons and quotes', () => {
  const text = formatFrontmatter({ title: 'Plan: Q3 "launch"', fileId: 'abc' }) + '\nBody line\n';
  const { data, body } = parseFrontmatter(text);
  assert.equal(data.title, 'Plan: Q3 "launch"');
  assert.equal(data.fileId, 'abc');
  assert.equal(body.trim(), 'Body line');
});

test('frontmatter accepts unquoted values and CRLF line endings', () => {
  const { data, body } = parseFrontmatter('---\r\nfileId: abc\r\nmodifiedTime: 2026-10-01T10:00:00.000Z\r\n---\r\nHello');
  assert.equal(data.fileId, 'abc');
  assert.equal(data.modifiedTime, '2026-10-01T10:00:00.000Z');
  assert.equal(body, 'Hello');
});

test('text without frontmatter is all body', () => {
  assert.deepEqual(parseFrontmatter('just text'), { data: {}, body: 'just text' });
});

test('jsonl appends, reads, skips corrupt lines and returns the last record', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kb-util-'));
  const path = join(dir, 'nested', 'log.jsonl');
  assert.deepEqual(await readJsonl(path), []);
  assert.equal(await lastJsonl(path), null);
  await appendJsonl(path, { n: 1 });
  await writeFile(path, (await readFile(path, 'utf8')) + 'not json\n');
  await appendJsonl(path, { n: 2 });
  assert.deepEqual(await readJsonl(path), [{ n: 1 }, { n: 2 }]);
  assert.deepEqual(await lastJsonl(path), { n: 2 });
});

test('readJson falls back when missing; writeJsonAtomic creates dirs and overwrites', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kb-util-'));
  const path = join(dir, 'a', 'state.json');
  assert.deepEqual(await readJson(path, { files: {} }), { files: {} });
  await writeJsonAtomic(path, { v: 1 });
  await writeJsonAtomic(path, { v: 2 });
  assert.deepEqual(await readJson(path, null), { v: 2 });
});
