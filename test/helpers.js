import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FAKE_CLAUDE = [process.execPath, fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url))];

// A throwaway harness root with config and the four public files.
export async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'kb-root-'));
  await writeFile(join(root, 'kb.config.json'), JSON.stringify({ driveFolderId: 'folder123', repoPath: root, port: 0 }));
  await mkdir(join(root, 'public'));
  for (const name of ['index.html', 'styles.css', 'app.js', 'ui-queue.js']) {
    await writeFile(join(root, 'public', name), `/* ${name} */\n`);
  }
  return root;
}
