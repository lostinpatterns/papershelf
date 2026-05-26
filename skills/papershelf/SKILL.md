---
name: papershelf
description: Search this repository's `.papershelf/docs/` research corpus with the `papershelf` CLI. Use before answering questions grounded in local research documents, when a coding/design decision may be informed by papers, books, specs, reports, or notes in the corpus, or when the user asks for corpus-backed evidence. Prefer `papershelf search ... --json`, cite relevant returned passages, and state when results are weak or inconclusive.
---

# papershelf

This repo has a research corpus at `.papershelf/docs/`.

Before answering questions grounded in the corpus, or making substantive decisions the corpus may inform, run a focused JSON search:

```sh
papershelf search "<specific question>" --json
```

Use the globally installed `papershelf` binary from the repository root.

If your final answer relies on papershelf evidence, include an `Evidence used` section with:

- the exact query passed to `papershelf search`
- the returned `docId` as the source path
- the returned `chunkIndex`
- source lines from `metadata.startLine` and `metadata.endLine` when available
- a short exact quote copied from the returned `text` or `snippet`

Quote from the returned result's `text` or `snippet`. A later direct read of the source file may be useful for context, especially using returned line metadata for a targeted read, but it does not replace citing the retrieved search result.

Use focused queries. If the returned passages are weak, irrelevant, empty, or inconclusive, say so; do not claim the corpus supports a conclusion unless the retrieved passages actually do. If you add documents to `.papershelf/docs/`, run `papershelf index` first.
