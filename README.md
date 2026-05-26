# papershelf

papershelf is a repo-local semantic retrieval layer for AI coding agents. It indexes research, specs, notes, docs, and other reference material from `.papershelf/docs/` into a local libSQL vector database, then exposes focused search through a CLI and installed agent skill.

With papershelf, you can:

- **Index repo-local reference material** — add papers, specs, design docs, notes, reports, or Markdown books under `.papershelf/docs/`.
- **Retrieve task-specific evidence** — find the passages agents need before refactoring, implementing, or making design decisions.
- **Use a narrow protocol** — run `papershelf search "<question>" --json` and inspect structured chunks, scores, and source metadata.
- **Keep citations reproducible** — store the corpus and generated index in `.papershelf/`, cite document IDs, chunks, and locations, and refresh with `papershelf index`.

## Problem

Coding agents already have `read`, `rg`, and `find`, and those remain best for exact strings, filenames, identifiers, error messages, citations, known terms, and expanded lexical queries. They still break down when reference material is long, prose-heavy, distributed, or described in vocabulary the agent's expansions miss. Reading whole papers or specs can also flood context when only a few passages matter.

papershelf targets that retrieval gap: maintainers keep a repo-local Markdown/plain-text corpus, papershelf chunks and indexes it semantically, and agents retrieve the passages most likely to matter before coding or design decisions. It complements `rg` and `read` by producing candidate evidence with source paths, chunk numbers, line ranges, and quotes agents can cite.

## Why papershelf

- **Agents need project evidence, not just model memory** — papershelf makes local research and reference material discoverable at the moment an agent needs it.
- **Research and reference material should stay repository-scoped** — documents and generated search data live with the project instead of in a separate managed document store.
- **Search output should be auditable** — agents can cite the exact query, source path, chunk, line range, and quote they used.
- **Maintainers own the corpus** — humans decide what belongs in `.papershelf/docs/`; agents consume it through a narrow, explicit protocol.

## Table of Contents

- [Problem](#problem)
- [Why papershelf](#why-papershelf)
- [Quickstart](#quickstart)
  - [1. Install](#1-install)
  - [2. Initialize a repo](#2-initialize-a-repo)
  - [3. Add documents](#3-add-documents)
  - [4. Index the corpus](#4-index-the-corpus)
  - [5. Try a search](#5-try-a-search)
- [How it works](#how-it-works)
- [CLI reference](#cli-reference)
- [Index storage](#index-storage)
- [Configuration](#configuration)
- [Agent interface](#agent-interface)
  - [Working with agents](#working-with-agents)
  - [Agent protocol](#agent-protocol)
  - [Search JSON contract](#search-json-contract)
  - [Citation contract](#citation-contract)
- [Development and evals](#development-and-evals)
- [License](#license)

## Quickstart

### 1. Install

Install the CLI globally from npm:

```sh
npm install -g papershelf
```

### 2. Initialize a repo

```sh
papershelf init
```

This creates `.papershelf/docs/` for the source corpus and installs the project-local agent skill at `.agents/skills/papershelf/SKILL.md`.

### 3. Add documents

Add research or reference documents to `.papershelf/docs/`, such as papers, books, specs, design docs, reports, notes, or Markdown reference material.

### 4. Index the corpus

```sh
papershelf index
```

This extracts, chunks, embeds, and stores searchable passages in `.papershelf/index/`.

### 5. Try a search

```sh
papershelf search "How should this design handle retries?" --json
```

## How it works

papershelf keeps retrieval infrastructure close to the codebase. Source documents live in `.papershelf/docs/`; generated index data lives in `.papershelf/index/` and can be rebuilt.

`papershelf index` fingerprints source files, skips unchanged documents, removes stale index rows, chunks changed documents, embeds those chunks, and stores them in a local libSQL vector index. The index is derived state, not the source of truth.

`papershelf search "<question>" --json` runs a two-stage retrieval path: it embeds the question, uses the local vector index to find nearby chunks, reranks those candidates against the original question, and returns the selected passages with document IDs, chunk numbers, scores, and source metadata.

The main tradeoff is intentional scope. papershelf favors repository-local, agent-first retrieval over a central document service or human-facing knowledge app. That keeps setup simple, makes citations reproducible, and gives coding agents a narrow JSON contract, but it also means maintainers own corpus quality and need to re-index after document changes.

## CLI reference

```sh
papershelf init
papershelf index [--rebuild]
papershelf search "<question>" --json
```

Run these commands from the repository root after installing the global CLI.

## Index storage

papershelf keeps the source corpus and generated search index inside the repo:

- `.papershelf/docs/` — user-added research or reference documents, such as papers, books, specs, design docs, reports, notes, or Markdown reference material.
- `.papershelf/index/` — generated local libSQL database; safe to rebuild with `papershelf index --rebuild`.

The index uses libSQL native `F32_BLOB` vectors with a DiskANN cosine index and fixed 1280-dimensional embeddings. If a future CLI version cannot use an existing generated index schema, run `papershelf index --rebuild` or delete `.papershelf/index/` and run `papershelf index`.

## Configuration

The intended ZeroEntropy integration uses standalone model endpoints only, not managed zsearch document storage:

- `ZEROENTROPY_API_KEY`
- Optional `ZEROENTROPY_BASE_URL` for compatible/local test endpoints; defaults to `https://api.zeroentropy.dev/v1`
- embedding model `zembed-1`
- embedding dimension `1280`
- reranker model `zerank-2`

## Agent interface

This section is the normative interface for agents. Human maintainers set up the corpus and keep it indexed; agents consume it through the installed skill and structured search output.

### Working with agents

The primary integration point is the project-local agent skill installed by `papershelf init` at `.agents/skills/papershelf/SKILL.md`.

That skill tells agents to search the corpus before answering questions grounded in the corpus or making substantive decisions the corpus may inform. Agents should use focused queries, cite relevant passages, and avoid treating weak or irrelevant results as support for a conclusion.

### Agent protocol

papershelf is useful when repository work should be informed by a local research and reference corpus — papers or preprints, but also books, specs, design docs, reports, notes, or Markdown references.

Canonical agent command:

```sh
papershelf search "<specific question>" --json
```

Protocol:

1. Read the installed skill at `.agents/skills/papershelf/SKILL.md`.
2. Run a focused semantic search before answering questions grounded in the corpus or making substantive coding/design decisions the corpus may inform.
3. Inspect the returned passages; treat them as supporting evidence, not automatic ground truth.
4. If a result is relevant, cite the query, returned `docId`, chunk, source lines when available, and a short exact quote from `text` or `snippet`.
5. If `metadata.startLine` and `metadata.endLine` are present, use them to read only the relevant source range when more context is needed.
6. If results are weak, irrelevant, empty, or inconclusive, say so instead of treating them as support.
7. If documents were added or changed, run `papershelf index` before searching when that is within scope; otherwise ask the maintainer to re-index.

### Search JSON contract

Agents should prefer structured output:

```sh
papershelf search "How should this design handle retries?" --json
```

Output shape:

```json
{
  "results": [
    {
      "docId": ".papershelf/docs/example.md",
      "chunkIndex": 3,
      "text": "Full retrieved chunk text...",
      "snippet": "Short normalized preview...",
      "distance": 0.1234,
      "relevanceScore": 0.98,
      "metadata": {
        "heading": "Retry strategy",
        "section": "Architecture > Retry strategy",
        "page": 12,
        "startLine": 40,
        "endLine": 58
      }
    }
  ]
}
```

Fields:

- `docId` — repo-relative source path.
- `chunkIndex` — chunk number within the source document.
- `text` — full retrieved passage; cite from this when possible.
- `snippet` — shortened normalized preview.
- `distance` — vector distance; lower is closer.
- `relevanceScore` — reranker score when available; higher is better.
- `metadata.heading`, `metadata.section`, `metadata.page` — source location hints when detectable.
- `metadata.startLine`, `metadata.endLine` — source line range for targeted reads.

### Citation contract

When an answer relies on papershelf evidence, include an `Evidence used` section:

```md
Evidence used

- query: "exact query string"
- source path: .papershelf/docs/example.md
- chunk: 3
- lines: 40-58
- quote: "short exact quote copied from the returned text or snippet"
```

Rules:

- Quote only text returned by `papershelf search ... --json`.
- A later direct read of the source file may provide context, but it does not replace citing the retrieved search result.
- Do not cite weak or irrelevant passages as evidence.
- If the corpus does not support the answer, say so.

## Development and evals

papershelf uses ordinary integration tests plus harness-backed evals for retrieval and agent behavior:

```sh
pnpm test:unit
pnpm test:integration
pnpm evals
pnpm evals:record
```

`pnpm test:integration` runs the CLI lifecycle in temporary repos against a mock ZeroEntropy server. It verifies `init`, incremental `index`, `search --json`, source paths, headings, exact quotes, query embeddings, and reranking behavior.

`pnpm evals` runs `vitest-evals` suites. The core retrieval eval builds a temporary `.papershelf/docs/` corpus, indexes it, runs real search code, and asserts retrieval quality across paraphrased queries, including mean reciprocal rank and expected snippets from multi-chunk documents.

The eval harnesses return normalized runs: app-facing `output`, traceable `session` data, provider/tool calls, `usage`, `artifacts`, and serialized `errors`. That lets tests assert both the answer and the process, for example that the reranker ran or that an agent used the right search command before citing evidence.

Provider calls for the core evals are recorded under `.vitest-evals/recordings/`, and the eval config runs in strict replay mode by default. Use `pnpm evals:record` with `ZEROENTROPY_API_KEY` when intentionally refreshing recordings.

The optional agent compliance eval is gated by `PAPERSHELF_RUN_AGENT_EVALS=1`. It runs a Pi agent against the installed papershelf skill and asserts trace-level behavior: the agent must call `papershelf search ... --json`, cite an exact returned query/source/quote, and use returned line metadata for targeted reads in long documents.

## License

MIT
