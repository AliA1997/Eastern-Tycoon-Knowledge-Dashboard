import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askArgs, syncArgs, uiEditArgs, DRIVE_READ_TOOLS, DRIVE_BLOCKED_TOOLS } from '../lib/claude-args.js';

const cfg = { repoPath: 'C:/repo', model: 'sonnet', driveFolderId: 'f1', excludeMcpServers: ['claude_ai_Figma'] };
const after = (args, flag) => args[args.indexOf(flag) + 1];
const common = (args) => {
  assert.equal(args[0], '-p');
  assert.equal(after(args, '--output-format'), 'json');
  assert.equal(after(args, '--permission-mode'), 'dontAsk');
  assert.equal(after(args, '--setting-sources'), 'project,local');
  assert.equal(after(args, '--model'), 'sonnet');
  assert.ok(args.includes('--no-session-persistence'));
};

test('ask: read-only tools, no MCP, repo added', () => {
  const args = askArgs('How do dice work?', cfg);
  common(args);
  assert.equal(args[1], '/kb-answer How do dice work?');
  assert.equal(after(args, '--tools'), 'Read,Grep,Glob');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(after(args, '--add-dir'), 'C:/repo');
  assert.ok(!args.some((a) => /Bash|Write|Edit|mcp__/.test(a)));
});

test('sync: Drive read tools allowed, Drive write tools blocked, writes scoped', () => {
  const args = syncArgs(cfg);
  common(args);
  assert.equal(args[1], '/kb-sync');
  const disallowed = args.indexOf('--disallowedTools');
  const allowed = args.indexOf('--allowedTools');
  for (const t of DRIVE_READ_TOOLS) assert.ok(args.indexOf(t) > allowed);
  for (const t of DRIVE_BLOCKED_TOOLS) {
    assert.ok(args.indexOf(t) > disallowed && args.indexOf(t) < allowed, t);
  }
  assert.ok(args.includes('mcp__claude_ai_Figma'));
  for (const rule of ['Write(context/drive/**)', 'Edit(context/drive/**)', 'Write(sync/listing.json)',
    'Write(sync/errors.json)', 'Bash(node scripts/sync-state.mjs plan)', 'Bash(node scripts/sync-state.mjs commit)']) {
    assert.ok(args.includes(rule), rule);
  }
  assert.ok(!args.includes('Write') && !args.includes('Bash') && !args.includes('Edit'));
});

test('ui edit: three files editable, ui-queue.js denied, no Write or Bash', () => {
  const args = uiEditArgs({ prompt: 'x', selector: '#a', text: '', html: '' }, cfg);
  common(args);
  assert.equal(args[1], '/kb-ui-edit {"prompt":"x","selector":"#a","text":"","html":""}');
  assert.equal(after(args, '--tools'), 'Read,Edit,Glob,Grep');
  assert.ok(args.includes('--strict-mcp-config'));
  for (const f of ['index.html', 'styles.css', 'app.js']) assert.ok(args.includes(`Edit(public/${f})`));
  assert.equal(after(args, '--disallowedTools'), 'Edit(public/ui-queue.js)');
  assert.equal(args.filter((a) => a === 'Edit(public/ui-queue.js)').length, 1);
});

test('model flag is omitted when not configured', () => {
  assert.ok(!askArgs('q', { repoPath: 'r' }).includes('--model'));
});
