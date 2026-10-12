import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runClaude, interpretRun } from '../lib/claude.js';
import { FAKE_CLAUDE } from './helpers.js';

const run = (mode, extra = {}) => runClaude({
  cmd: FAKE_CLAUDE, args: ['-p', 'hello'], cwd: process.cwd(), timeoutMs: 5000,
  env: { ...process.env, FAKE_CLAUDE_MODE: mode }, ...extra,
});

test('a successful run returns the result text', async () => {
  const outcome = interpretRun(await run('answer'));
  assert.equal(outcome.ok, true);
  assert.match(outcome.result, /^Echo: hello/);
  assert.deepEqual(outcome.denied, []);
});

test('a non-zero exit is an error carrying stderr', async () => {
  const outcome = interpretRun(await run('fail'));
  assert.deepEqual(outcome, { ok: false, error: 'Claude Code failed', detail: 'boom' });
});

test('a login problem gives login guidance', async () => {
  const outcome = interpretRun(await run('not-logged-in'));
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /isn't logged in/);
});

test('a hung run is killed at the timeout', async () => {
  const started = Date.now();
  const result = await run('hang', { timeoutMs: 300 });
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - started < 5000);
  assert.match(interpretRun(result).error, /took too long/);
});

test('a missing binary explains how to fix it', async () => {
  const result = await runClaude({ cmd: ['kb-no-such-binary-xyz'], args: [], cwd: process.cwd(), timeoutMs: 2000 });
  const outcome = interpretRun(result);
  assert.equal(outcome.ok, false);
  assert.match(outcome.detail, /was not found/);
});

test('unparseable output is an error', () => {
  assert.equal(interpretRun({ code: 0, stdout: 'not json', stderr: '', timedOut: false }).ok, false);
});

test('blocked tools are reported', async () => {
  const outcome = interpretRun(await run('sync-noop'));
  assert.deepEqual(outcome.denied, ['mcp__claude_ai_Google_Drive__search_files']);
});
