// The exact Claude Code flags for each job. Tool limits here are what enforce
// "answer from local context only", "never write to Drive" and "only edit the page".
const COMMON = [
  '--output-format', 'json',
  '--no-session-persistence',
  '--setting-sources', 'project,local',
  '--permission-mode', 'dontAsk',
];
const DRIVE = 'mcp__claude_ai_Google_Drive__';

export const DRIVE_READ_TOOLS = ['search_files', 'get_file_metadata', 'read_file_content'].map((t) => DRIVE + t);
export const DRIVE_BLOCKED_TOOLS = ['copy_file', 'create_file', 'share_file', 'trash_file', 'update_file'].map((t) => DRIVE + t);
export const UI_EDITABLE = ['public/index.html', 'public/styles.css', 'public/app.js'];
export const UI_GUARDED = 'public/ui-queue.js';

const modelArgs = (cfg) => (cfg.model ? ['--model', cfg.model] : []);

export function askArgs(question, cfg) {
  return [
    '-p', `/kb-answer ${question}`, ...COMMON, ...modelArgs(cfg),
    '--strict-mcp-config',
    '--tools', 'Read,Grep,Glob',
    '--add-dir', cfg.repoPath,
  ];
}

export function syncArgs(cfg) {
  return [
    '-p', '/kb-sync', ...COMMON, ...modelArgs(cfg),
    '--tools', 'Read,Write,Edit,Glob,Bash',
    '--disallowedTools', ...DRIVE_BLOCKED_TOOLS, ...(cfg.excludeMcpServers ?? []).map((s) => `mcp__${s}`),
    '--allowedTools', ...DRIVE_READ_TOOLS, 'Read', 'Glob',
    'Write(context/drive/**)', 'Edit(context/drive/**)',
    'Write(sync/listing.json)', 'Write(sync/errors.json)',
    'Bash(node scripts/sync-state.mjs plan)', 'Bash(node scripts/sync-state.mjs commit)',
  ];
}

export function uiEditArgs(request, cfg) {
  return [
    '-p', `/kb-ui-edit ${JSON.stringify(request)}`, ...COMMON, ...modelArgs(cfg),
    '--strict-mcp-config',
    '--tools', 'Read,Edit,Glob,Grep',
    '--disallowedTools', `Edit(${UI_GUARDED})`,
    '--allowedTools', 'Read', 'Glob', 'Grep', ...UI_EDITABLE.map((f) => `Edit(${f})`),
  ];
}
