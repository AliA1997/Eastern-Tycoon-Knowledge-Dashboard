#!/usr/bin/env node
// Used by the kb-sync skill:  node scripts/sync-state.mjs plan | commit
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commit, plan, PATHS } from '../lib/sync-state.js';
import { readJson, writeJsonAtomic } from '../lib/jsonfile.js';

const root = process.env.KB_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2];

try {
  if (command === 'plan') {
    const listing = await readJson(join(root, PATHS.listing), null);
    if (listing === null) throw new Error('sync/listing.json not found. Write the Drive listing first.');
    const state = await readJson(join(root, PATHS.state), { files: {} });
    const result = plan(listing, state);
    await writeJsonAtomic(join(root, PATHS.plan), result);
    console.log(JSON.stringify(result, null, 2));
  } else if (command === 'commit') {
    console.log(JSON.stringify(await commit(root), null, 2));
  } else {
    console.error('Usage: node scripts/sync-state.mjs <plan|commit>');
    process.exit(2);
  }
} catch (err) {
  console.error(`sync-state: ${err.message}`);
  process.exit(1);
}
