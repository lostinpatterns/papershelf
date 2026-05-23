# papershelf

papershelf is a CLI for adding semantic search over a repository-local `.papershelf/` research corpus. It is intended for AI coding agents and maintainers who want coding and design work to cite relevant local research material.

> Status: early implementation. The package currently exposes the CLI entrypoint and command surface while the indexing and search implementation is being built.

## Planned workflow

1. Add papers or text research material to `.papershelf/`.
2. Run `papershelf index` to extract, chunk, embed, and store searchable passages.
3. Run `papershelf search "<question>"` to retrieve relevant passages, with optional JSON output for agent tooling.

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

## Configuration

The intended ZeroEntropy integration uses:

- `ZEROENTROPY_API_KEY`
- embedding model `zembed-1`
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
