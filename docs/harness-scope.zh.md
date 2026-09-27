# Harness 包改名

[English](harness-scope.md) | 中文

仓库内每个 npm 包都从 `@deepseek-ai` scope 改到 `@mutantcat` scope：harness 以 `@mutantcat/dsh-<name>` 发布，vendored Cordis 层以 `@mutantcat/cordis` 与 `@mutantcat/cordis-plugin-*` 发布。vendored 框架的映射见 [docs/rescope.md](rescope.zh.md)；本页是旧 scope 代码与插件的兼容契约。

## Scope 映射

| 类型 | 改前 | 改后 |
|---|---|---|
| 仓库包 | `@deepseek-ai/dsh-<name>` | `@mutantcat/dsh-<name>` |
| Vendored 框架 | `@deepseek-ai/cordis` | `@mutantcat/cordis` |
| 外部 LibreOffice 引擎 | `@deepseek-ai/libreoffice-kit*` | 不变；包仍留在其 registry scope |

## 旧 scope 使用方的兼容

- 源码解析别名：`scripts/gen-tsconfig-paths.ts` 对每个别名都输出两份，一份是 `@mutantcat`，一份是 `@deepseek-ai`，因此按旧 scope 发布的插件不用改 import 就能解析到同一份源码。
- 运行期插件加载：`vendor/loader/src/config/tree.ts` 在 import 之前把旧 scope 的插件 specifier 改写成当前的 `@mutantcat` 名，因此改名之前写下的 `cordis.yml` 继续可用。
- 外部引擎：LibreOffice kit 及其平台包来自 registry，不属于本仓库，因此别名生成器与 Loader 都不改写它们。
- 类型与会话数据：改名只改变包身份；公共 API、会话格式与插件协议保持不变。

## 施加与回退

上面这份映射由 [`scripts/rescope-harness.ts`](../scripts/rescope-harness.ts) 承载并执行改名，任何引用都不靠手改：

```sh
pnpm run rescope-harness            # report what would change
pnpm run rescope-harness --apply    # rewrite every reference
pnpm run rescope-harness:check      # assert the post-state
pnpm run rescope-harness --apply --reverse   # return to the legacy names
```

施加后接上 `pnpm install`、`pnpm run gen-tsconfig-paths`、各目录生成器，以及对它触及的双语对跑 `pnpm run verify-translation-pairing --write --all`。
