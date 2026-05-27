# Releasing

Use the local `prepare-release` skill with an explicit version:

```sh
prepare-release 0.1.0
```

Project-specific release policy:

- Release branch: `main`
- Tag format: `v<version>`
- Changelog heading: `## <version>`; keep a fresh `## Unreleased` section
- Release commit: `chore(release): v<version>`
- Checks: `pnpm check`, `pnpm test`, `npm pack --dry-run`
- Publishing: pushing `v<version>` triggers `.github/workflows/release.yml`
- npm trusted publishing environment: `npm-publish`

After review:

```sh
git push origin main
git push origin v<version>
```
