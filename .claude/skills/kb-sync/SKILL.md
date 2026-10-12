---
name: kb-sync
description: Pulls new and changed docs from the "Eastern Tycoon KB" Google Drive folder into context/drive/, using scripts/sync-state.mjs so nothing is ingested twice. Read-only on Drive.
---

# kb-sync

Bring `context/drive/` up to date with the Google Drive folder. Drive is read-only: never create, update, copy, share or trash anything in Drive.

Run the two shell commands below exactly as written: no `cd`, no extra flags, nothing chained. Only those exact commands are permitted.

## 1. List the folder

1. Read `kb.config.json` and take `driveFolderId`.
2. Call `mcp__claude_ai_Google_Drive__search_files` with query `parentId = '<driveFolderId>'`, `excludeContentSnippets: true` and `pageSize: 100`. Follow `nextPageToken` until there are no more pages.
3. For each result whose `mimeType` is `application/vnd.google-apps.folder`, list it the same way (recursively) and keep track of its folder path.
4. Write every result (folders included) to `sync/listing.json` as one JSON array. If `sync/listing.json` already exists, Read it first (the Write tool requires this):
   [{"id": "...", "title": "...", "mimeType": "...", "modifiedTime": "...", "viewUrl": "...", "path": "Subfolder/Name"}]
   Copy `id`, `title`, `mimeType`, `modifiedTime` and `viewUrl` exactly as Drive returned them.

## 2. Plan

Run: `node scripts/sync-state.mjs plan`

It prints JSON with `new`, `changed`, `removed`, `unchanged` and `unsupported`. Fetch only the `new` and `changed` entries. Nothing else.

## 3. Fetch

For each entry in `new` and `changed`:

1. Call `mcp__claude_ai_Google_Drive__read_file_content` with its `id`.
2. Write it to the entry's `localPath`, exactly as given. If that file already exists, Read it first with `limit: 5` (the Write tool requires this). The file is this front matter followed by the content as Markdown:

   ---
   source: "google-drive"
   fileId: "<id>"
   title: "<title, JSON-escaped>"
   modifiedTime: "<modifiedTime from the plan entry>"
   url: "<url>"
   ---

   <document content>

   Keep the content faithful. Convert it to Markdown (headings, lists, tables), but don't summarize, shorten or add commentary. Spreadsheets become one Markdown table per sheet. Slides get one `##` heading per slide.
3. If a fetch fails, don't write that file. After all fetches, if any failed, write `sync/errors.json` once: `[{"id": "...", "error": "short reason"}]`.

## 4. Commit

Run: `node scripts/sync-state.mjs commit`

This updates `sync/state.json`, deletes local copies of removed files and appends the run to `sync/runs.jsonl`. Then reply with one line built from its output:
`Sync complete: <added> new, <updated> updated, <removed> removed, <skipped> unchanged, <errors.length> failed.`

If something stops you before the commit step (for example, Drive can't be reached), stop and reply with the reason. Never write `sync/state.json` or `sync/runs.jsonl` yourself.
