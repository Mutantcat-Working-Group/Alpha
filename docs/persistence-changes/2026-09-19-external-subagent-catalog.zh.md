---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-19-external-subagent-catalog

[English](2026-09-19-external-subagent-catalog.md) | 中文

## 概述

为一次性父级目录条目增加可选的外部成员标记。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-19-external-subagent-catalog
baseline: false
changes:
  - root: "event:subagent/catalog"
    previous: "2026-09-20-unknown-child-catalog"
    after: "568d482eeba04a9422773e7563cf935bd06f16896758cf880cf19b6bab8b1ada"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有 version-0 与 version-1 目录事实无需 external 字段仍然有效。字面量 true 标记没有本地 Session 的子级。创建时写入一次成员事实，执行与清理均不更新该记录。重复子 id 仍然无效。未知模式与可继续条目不接受此标记。本次更新本 PR 尚未接受的可选字段新增记录，不改变已发布世代或 Session 格式版本。

<a id="verification"></a>
## 验证

聚焦的目录、外部 activation、原生 V4 恢复与客户端测试通过，覆盖创建时成员登记、不发布结算更新、清理失败独立于目录成员关系以及拒绝重复子级。

<a id="dev-note"></a>
## 开发备注

无。
