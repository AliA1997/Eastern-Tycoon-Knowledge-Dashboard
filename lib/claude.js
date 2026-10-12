// Runs Claude Code headlessly. Never uses a shell: arguments reach claude verbatim.
import { spawn } from 'node:child_process';

export function runClaude({ cmd, args, cwd, timeoutMs, env = process.env }) {
  return new Promise((resolvePromise) => {
    const [bin, ...prefix] = cmd;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let child;
    const finish = (code, spawnError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr, timedOut, spawnError });
    };
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    try {
      child = spawn(bin, [...prefix, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      finish(null, err.message);
      return;
    }
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => finish(null, err.message));
    child.on('close', (code) => finish(code));
  });
}

function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill('SIGKILL');
  }
}

function parseJson(stdout) {
  const text = stdout.trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* try the last line */ }
  try { return JSON.parse(text.split(/\r?\n/).pop()); } catch { return null; }
}

export function interpretRun(run) {
  if (run.spawnError) {
    return {
      ok: false,
      error: 'Could not start Claude Code',
      detail: /ENOENT/.test(run.spawnError)
        ? 'The "claude" command was not found. Install Claude Code or set CLAUDE_BIN.'
        : run.spawnError,
    };
  }
  if (run.timedOut) {
    return { ok: false, error: 'Claude Code took too long and was stopped', detail: run.stderr.trim().slice(0, 2000) };
  }
  const parsed = parseJson(run.stdout);
  if (run.code !== 0 || !parsed || parsed.is_error || parsed.subtype !== 'success') {
    const detail = String(parsed?.result || run.stderr || run.stdout || `exit code ${run.code}`).trim().slice(0, 2000);
    const loggedOut = /not logged in|log in|\/login|not authenticated/i.test(detail);
    return {
      ok: false,
      error: loggedOut ? "Claude Code isn't logged in. Run `claude` in a terminal, then try again." : 'Claude Code failed',
      detail,
    };
  }
  const denied = (parsed.permission_denials ?? []).map((d) => d?.tool_name).filter(Boolean);
  return { ok: true, result: String(parsed.result ?? ''), denied };
}
