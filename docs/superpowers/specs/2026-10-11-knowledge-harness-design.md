# Eastern Tycoon Knowledge Harness — Design

Date: 2026-10-11
Status: Draft for review

## 1. Purpose

A local, single-user knowledge harness for the **Eastern Tycoon** project (formerly Dawaar / Desert Tycoon). You ask questions in a local web page; Claude Code on this machine answers **only** from project sources. If the sources do not support an answer, the answer is "No".

### Goal

A working UI that serves as the internal knowledge harness for Eastern Tycoon:

- **Responsive** on mobile, tablet and desktop.
- **Sync brings in the latest Google Drive documents.** Every press pulls new and changed docs from the Drive folder into `context/drive/` (one-way: Drive → local; Drive is never modified).
- **Answers reference internal knowledge only** (§3, §4).
- **Easy to use and understand.** Every control is labeled in plain words, and the page explains itself without instructions.

### Success criteria

- A question about the code or docs returns an answer with the file paths it came from.
- A question the sources do not cover returns exactly `No — not in the project context.`
- Editing a doc in the Drive folder and pressing Sync updates its local copy (`~1`), and the next answer uses the new content.
- Pressing Sync twice in a row: the second run adds, updates and removes nothing (`+0 ~0 −0`).
- After a 👎, adding the missing context and asking again produces an answer that uses it.
- The page is usable with no horizontal scrolling at 360 px (phone), 768 px (tablet) and 1280 px (desktop) wide.
- Double-clicking an element and queuing a change updates the page without a manual reload and without losing the conversation.

### Decisions made during brainstorming

| Decision | Choice |
|---|---|
| Knowledge sources | Google Drive folder + the Eastern Tycoon repo, code included |
| Drive scope | One dedicated folder, "Eastern Tycoon KB", including subfolders |
| Drive account | novigo.ali@gmail.com, through the claude.ai Google Drive connector |
| Runtime | Standard-library Node server that runs `claude -p` (Approach A) |
| Repo handling | Read live and read-only, not copied into `context/` |
| Hooks / subagents | None. Tool restrictions on the command line enforce the rules |

## 2. Layout

```
Eastern-Tycoon-Knowledge-Dashboard/
  CLAUDE.md                  # harness rules: answer only from sources, otherwise "No"
  kb.config.json             # driveFolderId, repoPath, port
  .claude/skills/
    kb-answer/SKILL.md
    kb-sync/SKILL.md
    kb-ui-edit/SKILL.md
  context/
    drive/                   # one .md per Drive file: <title-slug>--<fileId>.md
    manual/                  # notes added after a thumbs-down
  sync/
    state.json               # fileId → { modifiedTime, contentHash, localPath, title }
    listing.json             # latest Drive listing (overwritten each run)
    runs.jsonl               # one line per sync run
  feedback/feedback.jsonl    # one line per rating or added context
  feedback/ui-changes.jsonl  # one line per queued UI change and its outcome
  scripts/sync-state.mjs     # deterministic plan/commit for sync
  server.js                  # Node standard library only, 127.0.0.1:4317
  public/
    index.html               # single page markup, no build step
    styles.css
    app.js                   # ask, sync, feedback (plain JS)
    ui-queue.js              # double-click change queue; NOT editable by kb-ui-edit
  test/                      # node --test suites + stub claude binary
```

`kb.config.json`:

```json
{
  "driveFolderId": "",
  "repoPath": "C:/Users/devmt/mobile-projects/Eastern-Tycoon",
  "port": 4317
}
```

### Git

`context/drive/`, `sync/` and `feedback/` contain pulled or personal data and are git-ignored. `context/manual/` **is** committed, because it is knowledge you wrote yourself.

## 3. Allowed sources

`kb-answer` may read only:

1. `context/drive/` and `context/manual/`
2. The repo at `repoPath`, read-only, excluding `node_modules/`, `.git/`, `dist/`, `build/`, `.expo/`, `Pods/`, `.gradle/` and lockfiles.

General knowledge, the web and MCP tools are not sources.

## 4. CLAUDE.md (grounding rules)

`CLAUDE.md` loads for every `claude -p` run in this folder, so its rules are scoped: the grounding rules below apply whenever answering a question about Eastern Tycoon. `kb-sync` and `kb-ui-edit` follow their own skill instructions.

- Answer only from the allowed sources in §3.
- Every answer ends with a `Sources:` list of the file paths read. Drive-derived files also show their Drive URL.
- If no source supports the answer, reply exactly `No — not in the project context.` with no sources.
- A partial answer is allowed when sources cover part of the question. It must say what is missing.
- Do not guess, generalize from outside knowledge or invent file paths.

## 5. kb-sync

### One-time connection (walked through during the build)

1. You create the Drive folder **"Eastern Tycoon KB"** in the novigo.ali@gmail.com Drive and add the project docs.
2. You paste the folder link. The folder ID is saved to `kb.config.json`.
3. Verification: a headless `claude -p` run lists that folder through `mcp__claude_ai_Google_Drive__search_files`. This shows the server's sync path works.

### Run flow

1. **List.** Walk the folder recursively with `search_files` (`parentId = '<id>'`; subfolders are walked the same way). Write `sync/listing.json` as an array of `{id, title, mimeType, modifiedTime, viewUrl, path}`.
2. **Plan.** `node scripts/sync-state.mjs plan` reads the listing and `state.json`, and prints JSON `{new: [...], changed: [...], removed: [...], unchanged: n, unsupported: [...]}`.
3. **Fetch.** For each `new` and `changed` file only, call `read_file_content` and write `context/drive/<title-slug>--<fileId>.md` with front matter:
   ```
   ---
   source: google-drive
   fileId: ...
   title: ...
   modifiedTime: ...
   url: ...
   ---
   ```
4. **Commit.** `node scripts/sync-state.mjs commit` hashes each fetched file and updates `state.json`. If a changed file's content hash equals the stored hash, it counts as `skipped`, not `updated`. It deletes local files for `removed` entries and appends a run record to `sync/runs.jsonl`:
   ```json
   {"at":"...","added":3,"updated":1,"removed":0,"skipped":12,"unsupported":["x.png"],"errors":[]}
   ```
   A file that fails to fetch goes into `errors`, and its `state.json` entry is left untouched so the next run retries it.

### Supported types

Google Docs, Sheets and Slides, plus PDF, .docx, .md and .txt. Anything else is listed under `unsupported` and skipped.

### Guardrails

- Allowed tools: the Drive read tools (`search_files`, `get_file_metadata`, `read_file_content`), `Write`/`Edit` under `context/drive/` and `sync/listing.json`, and `Bash(node scripts/sync-state.mjs *)`.
- Drive `trash_file`, `share_file`, `update_file`, `create_file` and `copy_file` are not allowed. A sync cannot change Drive.
- Only one sync runs at a time, enforced by the server.

## 6. kb-answer

Invocation (cwd = harness folder, `spawn` with no shell, question passed as an argument):

```
claude -p "/kb-answer <question>" --output-format json
  --allowedTools Read Grep Glob
  --add-dir <repoPath>
```

No Bash, Write, web or MCP tools are allowed.

Skill steps:

1. Search `context/` first, then the repo, using Grep and Glob, then Read the hits.
2. Answer only from what was read, following the §4 rules.
3. Output format: the answer in markdown, then a final `Sources:` block with one path per line. The server parses that block into `sources[]`. If the block is missing, `sources` is empty and the answer is still shown.

## 7. Server API (`server.js`)

Binds to `127.0.0.1:4317` only. The `claude` binary path comes from env `CLAUDE_BIN` (default `claude`) so tests can substitute a stub.

| Endpoint | Behavior |
|---|---|
| `GET /` | Serves `public/index.html` |
| `POST /api/ask` `{question}` | Runs kb-answer. Returns `{id, question, answer, sources, ms}`. Keeps the answer in memory by `id` |
| `POST /api/sync` | Runs kb-sync. Returns the last line of `runs.jsonl`. Returns `409` if a sync is already running |
| `GET /api/sync/last` | Returns the last run record, or `null` |
| `POST /api/feedback` `{id, rating: "up"|"down"}` | Appends `{at, id, question, answer, sources, rating}` to `feedback.jsonl` |
| `POST /api/context` `{id, text}` | Writes `context/manual/<YYYY-MM-DD>-<question-slug>.md` (front matter: original question, date) and appends `{at, id, type: "context-added", path}` to `feedback.jsonl` |
| `POST /api/ui-change` `{prompt, selector, text, html}` | Adds a UI change request to the queue (§8a). Returns `{id, status: "queued"}` |
| `GET /api/ui-queue` | Current queue items with status |
| `GET /api/events` | Server-sent events: `ui-queue` status updates and `reload` |

### Errors

- A non-zero exit, a timeout (2 minutes for ask, 10 minutes for sync) or unparseable output gives HTTP 502 `{error, detail}`. The page shows it as a red error. A failure is never shown as "No".
- An empty question gives 400. Manual context file names are slugged to `[a-z0-9-]`, capped at 60 characters, and never contain path separators.

## 8. Page (`public/`)

- Header with the title, a **Sync** button and the last-sync summary (`Oct 11 14:02 · +3 ~1 −0`). The button is disabled while a sync runs.
- A conversation list: each item shows Q, A and its sources, with 👍/👎 below. The chosen rating stays highlighted.
- 👎 opens a text box with a **Save to context** button. After saving: "Saved — ask again to use it", plus a **Re-ask** button.
- Input with a **Send** button at the bottom. Enter sends. A "Thinking…" state shows while waiting.
- Light and dark mode follow the system setting. The conversation is kept in `sessionStorage`, so it survives reloads in the same tab (including the automatic reloads in §8a). No chat memory is sent to Claude.

### Responsive layout

- **Phone (< 600 px):** a single column. The header wraps the Sync button and last-sync summary under the title. The input bar is pinned to the bottom, and buttons are at least 44 px tall for touch.
- **Tablet (600–1024 px):** a single column with wider margins. The header stays on one line.
- **Desktop (> 1024 px):** the conversation column is centered with a maximum width of about 760 px for readable line length.
- No horizontal scrolling at any width. Long file paths in `Sources` wrap.
- On touch devices, double-tap acts as double-click for §8a.

### Ease of use

- The empty state shows three example questions you can tap, and a single line explaining what the harness answers from.
- Buttons use words, not just icons: "Sync Drive", "Send", "Add missing context". 👍/👎 have text labels for screen readers.
- Errors say what happened and what to do next ("Claude Code isn't logged in. Run `claude` in a terminal, then try again.").

## 8a. Double-click UI change queue

Changes apply automatically. There is no Undo button; a bad change is fixed by queuing another prompt.

### Page

- Double-clicking (double-tapping on touch) any element outlines it and opens a small prompt box next to it with **Queue change**. Double-clicks inside text inputs keep their normal behavior.
- A collapsible **UI changes** panel in the corner lists each request as *queued → working → done / failed*, with a one-line summary from Claude.
- When a change is done, the page saves the conversation to `sessionStorage` and reloads itself.

### Server

- `POST /api/ui-change` puts `{prompt, selector, text, html (max 2 KB)}` in an in-memory queue.
- One worker handles the queue in order and broadcasts status over `GET /api/events`:
  ```
  claude -p "/kb-ui-edit <json request>" --output-format json
    --allowedTools "Read(public/**)" "Edit(public/**)" "Write(public/**)"
  ```
- After a successful run the worker checks that `public/ui-queue.js` is unchanged. If it changed, the worker restores it with `git checkout -- public/ui-queue.js` and marks the item *failed*.
- On success the worker commits `public/` with the message `ui: <prompt, first 60 chars>` and sends `reload`. Each outcome is appended to `feedback/ui-changes.jsonl`.
- A failed item does not block the next one.

### kb-ui-edit skill

Make the smallest change to `index.html`, `styles.css` or `app.js` that does what was asked for the target element. Keep the layout responsive (§8). Never edit `ui-queue.js`. End with a one-line summary of what changed.

### Guardrail

`public/ui-queue.js` holds the double-click and queue code and cannot be edited by `kb-ui-edit`. A change that breaks the rest of the page cannot remove your ability to queue a fix.

## 9. Testing

1. `test/sync-state.test.mjs` (`node --test`):
   - the first plan marks everything new
   - planning again after commit reports nothing new
   - a new `modifiedTime` counts as changed
   - a changed file with the same hash counts as skipped
   - a file missing from the listing counts as removed and its local file is deleted
   - unsupported MIME types are listed
   - a fetch error leaves state untouched
   - `runs.jsonl` gets one line per commit
2. `test/server.test.mjs` with a stub `claude` (`CLAUDE_BIN`) covers:
   - ask returns the answer and parsed sources
   - a non-zero exit gives 502, not "No"
   - an overlapping sync gives 409
   - feedback and context requests append to `feedback.jsonl`
   - manual context file names are sanitized
   - UI queue runs items in order, a failed item does not block the next, and a change to `ui-queue.js` is reverted and marked failed
3. Responsive check: Playwright screenshots at 360, 768 and 1280 px wide confirm no horizontal scrolling and readable layout.
4. Manual end-to-end checks (done together): the success criteria in §1.

## 10. Out of scope

- Multiple users, login, remote access
- Chat memory across questions
- Sources other than the one Drive folder and the local repo
- Embeddings or a vector index (Grep/Glob over local files is enough at this size)
