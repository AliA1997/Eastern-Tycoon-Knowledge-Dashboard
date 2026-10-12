import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULTS = { driveFolderId: '', repoPath: '', port: 4317, model: 'sonnet', excludeMcpServers: [] };

// Read on every request so edits to kb.config.json apply without a restart.
export async function loadConfig(root) {
  let text;
  try {
    text = await readFile(join(root, 'kb.config.json'), 'utf8');
  } catch {
    throw new Error('kb.config.json is missing from the harness folder.');
  }
  return { ...DEFAULTS, ...JSON.parse(text) };
}
