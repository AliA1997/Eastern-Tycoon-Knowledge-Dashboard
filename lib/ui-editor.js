// Applies one queued UI change with kb-ui-edit. Restores the page on failure,
// refuses changes to ui-queue.js, and commits each successful change.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runClaude, interpretRun } from './claude.js';
import { uiEditArgs, UI_EDITABLE, UI_GUARDED } from './claude-args.js';
import { loadConfig } from './config.js';

const exec = promisify(execFile);
const lastLine = (text) => (String(text).trim().split(/\r?\n/).filter(Boolean).pop() ?? '').slice(0, 200);

export function createUiEditor({ root, claudeCmd, timeoutMs = 300_000 }) {
  const files = [...UI_EDITABLE, UI_GUARDED];
  const snapshot = async () => {
    const copy = {};
    for (const rel of files) copy[rel] = await readFile(join(root, rel), 'utf8');
    return copy;
  };
  const restore = async (copy) => {
    for (const [rel, text] of Object.entries(copy)) await writeFile(join(root, rel), text, 'utf8');
  };

  return async function editUi(item) {
    const cfg = await loadConfig(root);
    const before = await snapshot();
    const request = { prompt: item.prompt, selector: item.selector ?? '', text: item.text ?? '', html: item.html ?? '' };
    const run = await runClaude({ cmd: claudeCmd, args: uiEditArgs(request, cfg), cwd: root, timeoutMs });
    const after = await snapshot();

    if (after[UI_GUARDED] !== before[UI_GUARDED]) {
      await restore(before);
      throw new Error('The change tried to edit ui-queue.js, so it was undone.');
    }
    const outcome = interpretRun(run);
    if (!outcome.ok) {
      await restore(before);
      throw new Error(`${outcome.error}: ${outcome.detail}`.slice(0, 500));
    }
    const changed = UI_EDITABLE.filter((rel) => after[rel] !== before[rel]);
    if (!changed.length) throw new Error(`No change made: ${lastLine(outcome.result)}`);

    let summary = lastLine(outcome.result);
    try {
      await exec('git', ['add', '--', ...changed], { cwd: root });
      await exec('git', ['commit', '-q', '-m', `ui: ${item.prompt.slice(0, 60)}`, '--', ...changed], { cwd: root });
    } catch (err) {
      summary += ` (applied, but not committed: ${String(err.stderr || err.message).trim().slice(0, 120)})`;
    }
    return { summary, files: changed };
  };
}
