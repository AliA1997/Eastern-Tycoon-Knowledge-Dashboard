---
name: kb-answer
description: Answers a question about the Eastern Tycoon project using only local context (context/ and the Eastern Tycoon repo). Replies "No — not in the project context." when the sources don't support an answer.
---

# kb-answer

Question: $ARGUMENTS

Answer questions about Eastern Tycoon (formerly Dawaar / Desert Tycoon) using only these sources:

1. `context/drive/`: docs synced from the "Eastern Tycoon KB" Google Drive folder. Each file starts with front matter that includes its `url`.
2. `context/manual/`: notes the team added after a bad answer. Treat them as the newest and most authoritative.
3. The Eastern Tycoon repo at the `repoPath` in `kb.config.json`. Skip `node_modules/`, `.git/`, `dist/`, `build/`, `.expo/`, `Pods/`, `.gradle/` and lockfiles.

## Steps

1. Read `kb.config.json` to get `repoPath`.
2. Search `context/` first with Grep (case-insensitive), using the question's key terms and likely synonyms. Then search the repo. Use Glob to find files by name (for example `**/dice/**`).
3. Read the most relevant hits. Read enough to be sure. Never answer from a file name alone.
4. Write the answer.

## Rules

- Use only what you read in those sources. No general knowledge, no assumptions about how apps like this usually work, no invented file paths.
- If the sources don't support an answer, reply with exactly this line and nothing else:
  No — not in the project context.
- If the sources answer part of the question, answer that part and say plainly what's missing.
- When sources disagree, prefer `context/manual/`, then the newest Drive doc, then the code, and mention the disagreement.
- Lead with the direct answer, then the supporting detail. Keep it short. Use `code` formatting for file names, functions and commands.

## Output format

<the answer, in Markdown>

Sources:
- <path of each file you used: relative to the harness folder for context/ files, relative to repoPath for repo files>
- <for Drive files: context/drive/<file>.md — <url from its front matter>>

The `Sources:` block is required for every answer except the "No" reply. List only files you actually read and used. Every line in it is a file path (plus the Drive URL for Drive files), nothing else: notes such as "nothing in context/ mentioned this" belong in the answer above, not in `Sources:`. The `Sources:` block is the last thing in your reply.
