# papershelf

papershelf is a CLI for adding semantic search over a repository-local `.papershelf/` research corpus. It uses ZeroEntropy standalone embedding/reranking models and stores the searchable index locally with PGlite + pgvector. It is intended for AI coding agents and maintainers who want coding and design work to cite relevant local research documents.

> Status: early implementation. The package currently exposes the CLI entrypoint and command surface while the indexing and search implementation is being built.

## Intended use

papershelf is useful when repository work should be informed by a local research corpus — typically papers or preprints, but also books, specs, reports, or notes. Add source documents to `.papershelf/docs/` and index them; then agents can run `papershelf search "<specific question>"` to retrieve citeable passages before making substantive decisions.

Search results should be treated as supporting evidence, not automatic ground truth. If returned passages are weak, irrelevant, or inconclusive, do not treat them as support for a conclusion.

## Working with agents

`papershelf init` is designed to make the corpus discoverable to AI coding agents by installing a project-local skill at `.agents/skills/papershelf/SKILL.md`.

That skill tells agents to search the corpus before answering questions grounded in the corpus or making substantive decisions the corpus may inform. Agents should use focused queries, cite relevant passages, and avoid treating weak or irrelevant results as support for a conclusion.

Agents can use plain text output for human-readable results or `papershelf search "<question>" --json` for structured results.

## Planned workflow

1. Run `papershelf init` in a repo to create `.papershelf/docs/` and install the project-local agent skill.
2. Add research documents, such as papers, books, specs, reports, or text notes, to `.papershelf/docs/`.
3. Run `papershelf index` to extract, chunk, embed, and store searchable passages in `.papershelf/index/`.
4. Run `papershelf search "<question>"` to retrieve relevant passages, with optional JSON output for agent tooling. Search results include the source document, chunk index, snippet, and page, section, or heading metadata when available.

## Installation

After publication, install the CLI from npm:

```sh
pnpm add -D papershelf
```

## CLI

```sh
papershelf init
papershelf index
papershelf search "<question>" [--json]
```

## Index storage

papershelf keeps the source corpus and generated search index inside the repo:

- `.papershelf/docs/` — user-added research documents, such as papers, books, specs, reports, or text notes.
- `.papershelf/index/` — generated local PGlite database; safe to rebuild with `papershelf index`.

The index uses bundled pgvector with an HNSW cosine index and fixed 1280-dimensional embeddings.

## Configuration

The intended ZeroEntropy integration uses standalone model endpoints only, not managed zsearch document storage:

- `ZEROENTROPY_API_KEY`
- embedding model `zembed-1`
- embedding dimension `1280`
- reranker model `zerank-2`

## Development

```sh
pnpm install
pnpm build
pnpm test
pnpm check
```

## License

MIT
