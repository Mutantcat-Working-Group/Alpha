---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-20-unknown-child-catalog

[English](2026-09-20-unknown-child-catalog.md) | 中文

## 概述

新增 subagent/catalog-unknown，在 descriptor 无法确定模式时保留历史直属子会话的 header 身份。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-20-unknown-child-catalog
baseline: false
changes:
  - root: "event:subagent/catalog-unknown"
    previous: null
    after: "d21dd6c60a43d9cb0d93da371e482f66ffd55daa36544e80978a0e7b32737b21"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新增普通的必读事件，不修改已定稿的 subagent/catalog 载荷、Session header 或事件信封。已有日志仍有效。不认识新事件的旧读取器拒绝包含它的日志；当前读取器将其投影为现有目录中的未知模式项，继续执行请求仍受支持的子 descriptor 约束。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/session/session-format-v3-to-v4/tests/validation.spec.ts packages/subagent/subagent/tests/catalog.spec.ts：16 个测试通过，覆盖未知身份恢复、畸形载荷拒绝、重复 child 拒绝及共享目录投影。

<a id="dev-note"></a>
## 开发备注

无。
