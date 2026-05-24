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

Cite relevant passages from the search results when using corpus evidence.

Use focused queries. If the returned passages are weak, irrelevant, or inconclusive, say so; do not claim the corpus supports a conclusion unless the retrieved passages actually do. If you add documents to `.papershelf/docs/`, run `papershelf index` first.
