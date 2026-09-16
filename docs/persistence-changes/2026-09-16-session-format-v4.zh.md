---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-16-session-format-v4

[English](2026-09-16-session-format-v4.md) | 中文

## 概述

将声明的 SessionHeader.version 从 3 推进到 4，用于 V4 集成写入器。事件载荷与信封的声明类型均未变化。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-16-session-format-v4
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-11-initial"
    after: "1a3440e3577382704d42a6263aa463504eb74c566734a55e9503a63efcd02445"
    decision: version-bump
```

<a id="compatibility"></a>
## 兼容性

[V3 到 V4 迁移](../../packages/session/session-format-v3-to-v4/README.zh.md#v3-to-v4-specification)推进 header，并保留每个已接纳事件与继承切点。其按 generation 校验 delivery 的规则可防止历史确认成为有效的 V4 水位。V3 读取方拒绝更新的 generation；目录通过完整的相邻迁移链恢复受支持的旧输入。[V3 schema 参考](historical-formats/v3.zh.md)保留原声明，持久化在只发布当前后继代的同时保留已提交前代的字节。

<a id="verification"></a>
## 验证

`pnpm exec vitest run packages/session/session-format-v3-to-v4/tests` 的两个文件共 22 个测试通过，覆盖恒等保留、继承切点、准入与 delivery generation 拒绝。`pnpm run verify-persistence-formats` 对从 V0 到 V4 的全部五个参考均验证通过。写入器变更前，`pnpm run verify-persistence-catalog` 通过，且 `pnpm run verify-persistence-formats --archive 3` 已捕获 V3 schema。

<a id="dev-note"></a>
## 开发备注

无。
