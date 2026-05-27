# Changelog

All notable changes to this project will be documented in this file.

This project follows Conventional Commits for commit messages. Release entries should summarize user-facing changes for each published version.

## Unreleased

## 0.1.0

- Added the `papershelf` CLI with `init`, `index`, and `search --json` commands.
- Added repository-local document indexing from `.papershelf/docs/` into a generated `.papershelf/index/` store, including incremental updates and `--rebuild` support.
- Added ZeroEntropy embedding and reranking integration backed by a local libSQL vector index.
- Added project-local agent skill scaffolding and documented the JSON search/citation contract.
- Prepared the npm package for publishing, including normalized CLI bin metadata and release validation.
- Fixed generated index handling and fail-fast errors when the index is locked.
