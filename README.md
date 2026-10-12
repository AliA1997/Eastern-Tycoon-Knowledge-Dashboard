# Eastern Tycoon Knowledge

A local page for asking questions about Eastern Tycoon. Answers come only from the project's Google Drive docs, its code, and notes you add. Anything else gets a plain "No".

## Run it

```bash
npm start
```

Open http://127.0.0.1:4317. It needs Node 24+ and Claude Code logged in (`claude` in a terminal).

## Use it

- **Send**: ask a question. Each answer lists the files it used.
- **Sync Drive**: pull new and changed docs from the "Eastern Tycoon KB" Drive folder. Drive is never modified. Each run is logged in `sync/runs.jsonl`, and unchanged docs are skipped.
- **👍 / 👎**: rate an answer (saved to `feedback/feedback.jsonl`). After 👎, **Add the missing context** saves a note to `context/manual/` that future answers use.
- **Double-click (or double-tap) anything**: describe a change to that part of the page. Claude applies it, commits it (`ui: …`), and the page reloads with your conversation intact. To undo a change, queue another one or use `git revert`.

## Settings (`kb.config.json`)

| Key | Meaning |
|---|---|
| `driveFolderId` | ID of the "Eastern Tycoon KB" folder (from its Drive link) |
| `repoPath` | Path to the Eastern Tycoon repo |
| `port` | Local port (4317) |
| `model` | Model used for every Claude run (`sonnet`) |
| `excludeMcpServers` | Connectors hidden during sync so only Google Drive loads |

## Develop

```bash
npm test
```

Troubleshooting: if answers fail with "isn't logged in", run `claude` in a terminal and log in. If sync fails with "Blocked tools", the Google Drive connector isn't connected (`claude mcp list`).
