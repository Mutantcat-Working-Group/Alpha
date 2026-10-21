---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-21-native-catalog-payload-vocabulary

[English](2026-10-21-native-catalog-payload-vocabulary.md) | 中文

## 概述

父目录 projection 接受 V4 迁移已经在写的 payload 词汇。本地创建继续写版本 0；迁移后 descriptor 缺失、无法识别或重复的 child 写成版本 1 事实，mode 保持 unknown；未在本地 child Session 中运行的执行写成版本 2 事实，mode 为 external。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-21-native-catalog-payload-vocabulary
baseline: false
changes:
  - root: "event:subagent/catalog"
    previous: "2026-09-19-external-subagent-catalog"
    after: "53750b9abf61efb7992b0aadc3e247ec927449c63266df28230fd1139f5590ac"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

这是同一格式版本内的读取放宽：版本 0 保留 one-shot 与 continuable 事实，版本 1 在本地 mode 之外增加 unknown，版本 2 要求 external，而版本与 mode 不一致的 payload 仍会被拒绝。已发布的代际、writer 输出和 `SESSION_FORMAT_VERSION` 都没有变化，既有日志仍可恢复，也不隐含后继格式。

<a id="verification"></a>
## 验证

`packages/subagent/subagent/tests/catalog.spec.ts` 通过纯 projection 定义折叠 V4 词汇，检查 unknown 与 external 行的 wire 视图，并拒绝三种版本与 mode 不匹配的组合；`packages/experimental/webworker-packer/tests/preview.spec.ts` 恢复一个没有 descriptor 的 child，并观察到版本 1 的 unknown 事实。

<a id="dev-note"></a>
## 开发备注

无。
