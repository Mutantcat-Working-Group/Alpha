---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-02-message-source-additive-kinds

[English](2026-10-02-message-source-additive-kinds.md) | 中文

## 概述

为持久化消息来源追加可合并扩展的 'schedule' producer kind。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-02-message-source-additive-kinds
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-14-image-offload"
    after: "4f0d49f11892c6bc82ec26ca6da62190ab9528cb485270fc978f89c7307bfa04"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-14-image-offload"
    after: "771544077f082091c3d0a561d2394fd09b36457a784f4284ff1d4e8eb87603d3"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-14-image-offload"
    after: "b1718d3a4f806ef163db75a7e03c48b9348995e0267b496872e382c174b58416"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有记录仍然有效。两处客户端投影都按记录必需的字符串 'kind' 读取持久化消息来源：已知 producer 得到具体标签，未知 'kind' 一律作为不透明内容保留，不回放 producer 专有字段。因此向 union 追加 'schedule' 不会改变旧记录的回放，所有既有 kind 均逐字节保留。三个受影响 root 中新增的 union 分支只有 'schedule'。

<a id="verification"></a>
## 验证

pnpm exec vitest run scripts/persistence-changes.spec.ts：37 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
