# Eastern Tycoon Knowledge Harness

A local knowledge harness for the Eastern Tycoon project (formerly Dawaar / Desert Tycoon). `server.js` runs Claude Code headlessly with three skills:

- `kb-answer`: answers questions from local context only
- `kb-sync`: pulls the "Eastern Tycoon KB" Google Drive folder into `context/drive/` (read-only on Drive)
- `kb-ui-edit`: applies one queued UI change to `public/`

## Grounding rules (whenever answering a question about Eastern Tycoon)

- Answer only from `context/drive/`, `context/manual/` and the Eastern Tycoon repo at the `repoPath` in `kb.config.json`.
- If those sources don't support an answer, reply exactly: `No — not in the project context.`
- Never use general knowledge, guesses or invented file paths. End every answer with a `Sources:` list.

## Working on the harness itself

- Node 24, ES modules, standard library only. No npm dependencies.
- `npm test` runs the suite. `npm start` serves http://127.0.0.1:4317
- `public/ui-queue.js` is the double-click change queue. `kb-ui-edit` must never edit it.
- Never modify Google Drive. Sync is one-way: Drive → `context/drive/`.
- Spec: `docs/superpowers/specs/2026-10-11-knowledge-harness-design.md`
