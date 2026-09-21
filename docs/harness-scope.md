# Harness package rescope

English | [中文](harness-scope.zh.md)

Every repository-owned npm package moved from the `@deepseek-ai` scope to the `@mutantcat` scope: the harness publishes as `@mutantcat/dsh-<name>`, and the vendored Cordis layer publishes as `@mutantcat/cordis` and `@mutantcat/cordis-plugin-*`. The vendored-framework mapping is [docs/rescope.md](rescope.md); this page is the compatibility contract for code and plugins that still name the old scope.

## Scope mapping

| Kind | Before | After |
|---|---|---|
| Repository packages | `@deepseek-ai/dsh-<name>` | `@mutantcat/dsh-<name>` |
| Vendored framework | `@deepseek-ai/cordis` | `@mutantcat/cordis` |
| External LibreOffice engine | `@deepseek-ai/libreoffice-kit*` | unchanged; the package stays on its registry scope |

## Compatibility for old-scope consumers

- Source-plane aliases: `scripts/gen-tsconfig-paths.ts` emits every alias twice, once under `@mutantcat` and once under `@deepseek-ai`, so a plugin published against the old scope resolves the same sources without editing its imports.
- Runtime plugin loading: `vendor/loader/src/config/tree.ts` rewrites a legacy plugin specifier to its current `@mutantcat` name before importing it, so a `cordis.yml` written before the rename keeps working.
- External engine: the LibreOffice kit and its platform packages come from the registry rather than this repository, so neither the alias generator nor the Loader rewrites them.
- Types and session data: the rename changes package identity only; public APIs, the session format, and plugin protocols are unchanged.

## Applying and reverting

[`scripts/rescope-harness.ts`](../scripts/rescope-harness.ts) owns the mapping above and performs the rename, so no reference is renamed by hand:

```sh
pnpm run rescope-harness            # report what would change
pnpm run rescope-harness --apply    # rewrite every reference
pnpm run rescope-harness:check      # assert the post-state
pnpm run rescope-harness --apply --reverse   # return to the legacy names
```

Follow an apply with `pnpm install`, `pnpm run gen-tsconfig-paths`, the catalog generators, and `pnpm run verify-translation-pairing --write --all` for the bilingual pairs it touched.
