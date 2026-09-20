---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-20-unknown-child-catalog

[English](2026-09-20-unknown-child-catalog.md) | 中文

## 概述

在 subagent/catalog 中使用 unknown 模式保留不可读的历史子会话。

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
  - root: "event:subagent/catalog"
    previous: "2026-09-11-initial"
    after: "4d6002c7eec8d76bbb6e531a35a55bc66dfb87621bc2e89e3af0641acf947bb3"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

Catalog 增加一个 unknown 模式分支，身份与可选 label 字段和 one-shot 模式相同。已有分支及 V4 header 保持不变。新读取器接受旧记录；旧读取器可能拒绝 unknown 模式记录。持久化分类器仅为该 catalog 扩展设置限定例外，其他联合类型新增与修改仍严格检查。未知成员关系不授予继续执行能力。

<a id="verification"></a>
## 验证

Catalog 迁移、恢复、投影和 Web 回归覆盖未知成员保留与子会话局部报错。持久化分类器测试接受此 catalog 扩展，并拒绝已有字段修改、其他新增模式、未知分支额外字段、删除及无关联合类型新增。

<a id="dev-note"></a>
## 开发备注

无。
