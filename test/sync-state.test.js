import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { plan, commit, localPathFor, PATHS } from '../lib/sync-state.js';
import { formatFrontmatter } from '../lib/frontmatter.js';
import { readJson, writeJsonAtomic } from '../lib/jsonfile.js';
import { readJsonl } from '../lib/jsonl.js';

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL('../scripts/sync-state.mjs', import.meta.url));
const DOC = 'application/vnd.google-apps.document';
const T1 = '2026-10-01T00:00:00.000Z';
const T2 = '2026-10-05T00:00:00.000Z';
const file = (id, modifiedTime = T1, extra = {}) => ({
  id, title: `Doc ${id}`, mimeType: DOC, modifiedTime, viewUrl: `https://docs.google.com/document/d/${id}`, ...extra,
});
const exists = (p) => access(p).then(() => true, () => false);
const newRoot = () => mkdtemp(join(tmpdir(), 'kb-sync-'));

async function writeFetched(root, target, body) {
  const full = join(root, target.localPath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, formatFrontmatter({
    source: 'google-drive', fileId: target.id, title: target.title, modifiedTime: target.modifiedTime, url: target.url,
  }) + '\n' + body + '\n');
}

// Plays the kb-sync skill: plan, write each fetched file (null body = fetch failed), commit.
async function cycle(root, listing, bodies = {}, reportedErrors = null) {
  const state = await readJson(join(root, PATHS.state), { files: {} });
  const planned = plan(listing, state);
  await writeJsonAtomic(join(root, PATHS.plan), planned);
  for (const t of [...planned.new, ...planned.changed]) {
    if (bodies[t.id] === null) continue;
    await writeFetched(root, t, bodies[t.id] ?? `Content of ${t.id}`);
  }
  if (reportedErrors) await writeJsonAtomic(join(root, PATHS.errors), reportedErrors);
  return { planned, record: await commit(root, new Date('2026-10-11T12:00:00Z')) };
}

test('first run adds everything and writes the run record', async () => {
  const root = await newRoot();
  const { planned, record } = await cycle(root, [file('a'), file('b')]);
  assert.equal(planned.new.length, 2);
  assert.deepEqual(record, { at: '2026-10-11T12:00:00.000Z', added: 2, updated: 0, removed: 0, skipped: 0, unsupported: [], errors: [] });
  assert.ok(await exists(join(root, 'context/drive/doc-a--a.md')));
  const state = await readJson(join(root, PATHS.state), null);
  assert.deepEqual(Object.keys(state.files).sort(), ['a', 'b']);
  assert.equal(state.files.a.modifiedTime, T1);
});

test('second run with nothing changed ingests nothing', async () => {
  const root = await newRoot();
  await cycle(root, [file('a'), file('b')]);
  const { planned, record } = await cycle(root, [file('a'), file('b')]);
  assert.deepEqual([planned.new.length, planned.changed.length, planned.unchanged], [0, 0, 2]);
  assert.deepEqual([record.added, record.updated, record.removed, record.skipped], [0, 0, 0, 2]);
});

test('a new modifiedTime with new content counts as updated', async () => {
  const root = await newRoot();
  await cycle(root, [file('a')]);
  const { planned, record } = await cycle(root, [file('a', T2)], { a: 'New content' });
  assert.equal(planned.changed.length, 1);
  assert.equal(record.updated, 1);
  assert.match(await readFile(join(root, 'context/drive/doc-a--a.md'), 'utf8'), /New content/);
});

test('a new modifiedTime with identical content counts as skipped', async () => {
  const root = await newRoot();
  await cycle(root, [file('a'), file('b')]);
  const { record } = await cycle(root, [file('a', T2), file('b')]);
  assert.deepEqual([record.updated, record.skipped], [0, 2]);
  const state = await readJson(join(root, PATHS.state), null);
  assert.equal(state.files.a.modifiedTime, T2);
});

test('a file gone from Drive is removed locally and from state', async () => {
  const root = await newRoot();
  await cycle(root, [file('a'), file('b')]);
  const { planned, record } = await cycle(root, [file('a')]);
  assert.deepEqual(planned.removed.map((r) => r.id), ['b']);
  assert.equal(record.removed, 1);
  assert.equal(await exists(join(root, 'context/drive/doc-b--b.md')), false);
  assert.equal((await readJson(join(root, PATHS.state), null)).files.b, undefined);
});

test('folders are ignored, duplicates collapse, unsupported types are listed', async () => {
  const root = await newRoot();
  const listing = [
    file('a'), file('a'),
    file('f', T1, { mimeType: 'application/vnd.google-apps.folder', title: 'Specs' }),
    file('p', T1, { mimeType: 'image/png', title: 'board.png' }),
  ];
  const { planned, record } = await cycle(root, listing);
  assert.equal(planned.new.length, 1);
  assert.deepEqual(planned.unsupported, [{ id: 'p', title: 'board.png', mimeType: 'image/png' }]);
  assert.deepEqual(record.unsupported, ['board.png']);
});

test('a failed fetch is reported, state is untouched and the next run retries it', async () => {
  const root = await newRoot();
  const { record } = await cycle(root, [file('a'), file('b')], { b: null }, [{ id: 'b', error: 'Drive timeout' }]);
  assert.equal(record.added, 1);
  assert.deepEqual(record.errors, [{ id: 'b', title: 'Doc b', error: 'Drive timeout' }]);
  assert.equal((await readJson(join(root, PATHS.state), null)).files.b, undefined);
  const again = await cycle(root, [file('a'), file('b')]);
  assert.deepEqual(again.planned.new.map((t) => t.id), ['b']);
  assert.equal(again.record.added, 1);
});

test('a changed file that was not re-fetched is an error and keeps its old state', async () => {
  const root = await newRoot();
  await cycle(root, [file('a')]);
  const { record } = await cycle(root, [file('a', T2)], { a: null });
  assert.equal(record.errors[0].error, 'Local file does not match this Drive version');
  assert.equal((await readJson(join(root, PATHS.state), null)).files.a.modifiedTime, T1);
});

test('title rename moves the local file', async () => {
  const root = await newRoot();
  await cycle(root, [file('a')]);
  await cycle(root, [file('a', T2, { title: 'Renamed: Plan' })], { a: 'Content of a' });
  assert.equal(await exists(join(root, 'context/drive/doc-a--a.md')), false);
  assert.ok(await exists(join(root, 'context/drive/renamed-plan--a.md')));
});

test('odd titles get safe paths and keep the real title in front matter', async () => {
  const root = await newRoot();
  await cycle(root, [file('z', T1, { title: 'خطة اللعبة / "v2": final' })]);
  const path = localPathFor({ id: 'z', title: 'خطة اللعبة / "v2": final' });
  assert.equal(path, 'context/drive/v2-final--z.md');
  assert.match(await readFile(join(root, path), 'utf8'), /title: "خطة اللعبة \/ \\"v2\\": final"/);
});

test('commit refuses to delete anything outside context/drive', async () => {
  const root = await newRoot();
  await writeFile(join(root, 'kb.config.json'), '{}');
  await writeJsonAtomic(join(root, PATHS.state), { files: { x: { title: 'X', localPath: 'kb.config.json', modifiedTime: T1 } } });
  const { record } = await cycle(root, []);
  assert.ok(await exists(join(root, 'kb.config.json')));
  assert.equal(record.removed, 0);
  assert.match(record.errors[0].error, /outside context\/drive/);
});

test('each commit appends one run line and clears the working files', async () => {
  const root = await newRoot();
  await writeJsonAtomic(join(root, PATHS.listing), [file('a')]);
  await cycle(root, [file('a')]);
  await cycle(root, [file('a')]);
  assert.equal((await readJsonl(join(root, PATHS.runs))).length, 2);
  for (const p of [PATHS.plan, PATHS.errors, PATHS.listing]) assert.equal(await exists(join(root, p)), false);
});

test('plan rejects malformed listings', () => {
  assert.throws(() => plan({}, { files: {} }), /JSON array/);
  assert.throws(() => plan([{ id: 'x' }], { files: {} }), /listing\[0\] is missing "title"/);
});

test('commit without a plan explains what to run', async () => {
  await assert.rejects(commit(await newRoot()), /Run "node scripts\/sync-state.mjs plan" first/);
});

test('CLI plan and commit work end to end', async () => {
  const root = await newRoot();
  const env = { ...process.env, KB_ROOT: root };
  await writeJsonAtomic(join(root, PATHS.listing), [file('a')]);
  const planned = JSON.parse((await exec(process.execPath, [CLI, 'plan'], { env })).stdout);
  assert.equal(planned.new[0].localPath, 'context/drive/doc-a--a.md');
  await writeFetched(root, planned.new[0], 'Body');
  const record = JSON.parse((await exec(process.execPath, [CLI, 'commit'], { env })).stdout);
  assert.equal(record.added, 1);
});

test('CLI reports a missing listing and bad usage', async () => {
  const env = { ...process.env, KB_ROOT: await newRoot() };
  await assert.rejects(exec(process.execPath, [CLI, 'plan'], { env }), (err) => err.code === 1 && /listing.json not found/.test(err.stderr));
  await assert.rejects(exec(process.execPath, [CLI, 'nope'], { env }), (err) => err.code === 2);
});
