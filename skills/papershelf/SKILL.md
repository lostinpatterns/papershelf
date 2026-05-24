---
name: papershelf
description: Search this repository's `.papershelf/docs/` research corpus with the `papershelf` CLI. Use before answering questions grounded in local research documents, when a coding/design decision may be informed by papers, books, specs, reports, or notes in the corpus, or when the user asks for corpus-backed evidence. Cite relevant passages from `papershelf search` results and state when results are weak or inconclusive.
---

# papershelf

This repo has a research corpus at `.papershelf/docs/`.

Before answering questions grounded in the corpus, or making substantive decisions the corpus may inform, run:

```sh
papershelf search "<specific question>"
```

If your final answer relies on papershelf evidence, include an `Evidence used` section with the query, source path, and a short exact quote from the retrieved passage.

When you expect to cite a result, prefer JSON output so the citation source is unambiguous:

```sh
pnpm papershelf search "<specific question>" --json
```

Quote from the returned result's `text` or `snippet`. A later direct read of the source file may be useful for context, but it does not replace citing the retrieved search result.

Use focused queries. If the returned passages are weak, irrelevant, or inconclusive, say so; do not claim the corpus supports a conclusion unless the retrieved passages actually do. If you add documents to `.papershelf/docs/`, run `papershelf index` first.
