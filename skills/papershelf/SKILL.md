# papershelf

This repo has a research corpus at `.papershelf/docs/`.

Before answering questions grounded in the corpus, or making substantive decisions the corpus may inform, run:

```sh
papershelf search "<specific question>"
```

Cite relevant passages from the search results when using corpus evidence.

Use focused queries. If the returned passages are weak, irrelevant, or inconclusive, say so; do not claim the corpus supports a conclusion unless the retrieved passages actually do. If you add documents to `.papershelf/docs/`, run `papershelf index` first.
