// Deterministic Drive sync bookkeeping. The model fetches documents; this module alone
// decides what is new, changed or removed, and records every run.
import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { slugify } from './slug.js';
import { parseFrontmatter } from './frontmatter.js';
import { readJson, writeJsonAtomic } from './jsonfile.js';
import { appendJsonl } from './jsonl.js';

export const PATHS = {
  listing: 'sync/listing.json',
  state: 'sync/state.json',
  plan: 'sync/plan.json',
  errors: 'sync/errors.json',
  runs: 'sync/runs.jsonl',
};

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SUPPORTED_MIME = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/x-markdown',
  'text/plain',
]);

export function localPathFor(file) {
  return `context/drive/${slugify(file.title)}--${file.id}.md`;
}

function validateListing(listing) {
  if (!Array.isArray(listing)) throw new Error('listing.json must be a JSON array');
  listing.forEach((f, i) => {
    for (const key of ['id', 'title', 'mimeType', 'modifiedTime']) {
      if (typeof f?.[key] !== 'string' || !f[key]) throw new Error(`listing[${i}] is missing "${key}"`);
    }
  });
}

export function plan(listing, state) {
  validateListing(listing);
  const known = state?.files ?? {};
  const result = { new: [], changed: [], removed: [], unchanged: 0, unsupported: [] };
  const seen = new Set();
  for (const f of listing) {
    if (f.mimeType === FOLDER_MIME || seen.has(f.id)) continue;
    seen.add(f.id);
    if (!SUPPORTED_MIME.has(f.mimeType)) {
      result.unsupported.push({ id: f.id, title: f.title, mimeType: f.mimeType });
      continue;
    }
    const target = {
      id: f.id, title: f.title, mimeType: f.mimeType, modifiedTime: f.modifiedTime,
      url: f.viewUrl ?? '', localPath: localPathFor(f),
    };
    const prev = known[f.id];
    if (!prev) result.new.push(target);
    else if (prev.modifiedTime !== f.modifiedTime) result.changed.push(target);
    else result.unchanged += 1;
  }
  const supportedIds = new Set(listing.filter((f) => SUPPORTED_MIME.has(f.mimeType)).map((f) => f.id));
  for (const [id, prev] of Object.entries(known)) {
    if (!supportedIds.has(id)) result.removed.push({ id, title: prev.title, localPath: prev.localPath });
  }
  return result;
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

async function removeQuietly(path) {
  try { await unlink(path); } catch (err) { if (err.code !== 'ENOENT') throw err; }
}

export async function commit(root, now = new Date()) {
  const at = (rel) => join(root, rel);
  const driveDir = resolve(root, 'context/drive');
  const insideDrive = (rel) => typeof rel === 'string' && resolve(root, rel).startsWith(driveDir + sep);

  const planned = await readJson(at(PATHS.plan), null);
  if (!planned) throw new Error('No sync/plan.json found. Run "node scripts/sync-state.mjs plan" first.');
  const state = await readJson(at(PATHS.state), { files: {} });
  state.files ??= {};
  const reported = await readJson(at(PATHS.errors), []);
  const reportedById = new Map((Array.isArray(reported) ? reported : []).map((e) => [e?.id, String(e?.error ?? '')]));

  const record = {
    at: now.toISOString(), added: 0, updated: 0, removed: 0,
    skipped: planned.unchanged, unsupported: planned.unsupported.map((u) => u.title), errors: [],
  };
  const fail = (t, fallback) => record.errors.push({ id: t.id, title: t.title, error: reportedById.get(t.id) || fallback });

  for (const [kind, targets] of [['new', planned.new], ['changed', planned.changed]]) {
    for (const t of targets) {
      let text;
      try { text = await readFile(at(t.localPath), 'utf8'); } catch { fail(t, 'File was not written'); continue; }
      const { data, body } = parseFrontmatter(text);
      if (data.fileId !== t.id || data.modifiedTime !== t.modifiedTime) {
        fail(t, 'Local file does not match this Drive version');
        continue;
      }
      const contentHash = sha256(body.trim());
      const prev = state.files[t.id];
      if (kind === 'new') record.added += 1;
      else if (prev?.contentHash === contentHash) record.skipped += 1;
      else record.updated += 1;
      if (prev?.localPath && prev.localPath !== t.localPath && insideDrive(prev.localPath)) {
        await removeQuietly(at(prev.localPath));
      }
      state.files[t.id] = { title: t.title, modifiedTime: t.modifiedTime, contentHash, localPath: t.localPath, url: t.url };
    }
  }

  for (const r of planned.removed) {
    if (!insideDrive(r.localPath)) {
      record.errors.push({ id: r.id, title: r.title, error: 'Refused to delete a file outside context/drive' });
      continue;
    }
    await removeQuietly(at(r.localPath));
    delete state.files[r.id];
    record.removed += 1;
  }

  await writeJsonAtomic(at(PATHS.state), state);
  await appendJsonl(at(PATHS.runs), record);
  for (const p of [PATHS.plan, PATHS.errors, PATHS.listing]) await removeQuietly(at(p));
  return record;
}
