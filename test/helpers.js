import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.js';

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

export async function startApp(root, opts = {}) {
  const server = createApp({
    root,
    claudeCmd: FAKE_CLAUDE,
    ...opts,
    timeouts: { ask: 5000, sync: 5000, uiEdit: 5000, ...opts.timeouts },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
    base,
    post: (path, body) => fetch(base + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}
