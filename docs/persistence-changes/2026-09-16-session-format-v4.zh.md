---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-16-session-format-v4

[English](2026-09-16-session-format-v4.md) | 中文

## 概述

将 V4 集成写入方声明的 SessionHeader.version 从 3 推进到 4，并向 turn/end.reason 添加 forked 变体。

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
  - root: "event:turn/end"
    previous: "2026-09-14-image-offload"
    after: "0f8512903d94f57a4748fa1a2092e64342856796684e6b8343db685b192745ce"
    decision: version-bump
```

<a id="compatibility"></a>
## 兼容性

[V3 到 V4 迁移](../../packages/session/session-format-v3-to-v4/README.zh.md#v3-to-v4-specification)推进 header，保留每个已接纳源事件与继承切点，并根据同一持久化根目录中保留的直接子 Session 日志追加缺失的父级 `subagent/catalog` 记录。历史正文恢复要求显式提供子日志证据集合；没有可供补全的子日志时也须传入空集合。缺少必需的 descriptor 或身份冲突会拒绝迁移，且不发布后继；已有 catalog 事实保持不变。链接中的规范负责 descriptor 准入与确定性追加顺序。

历史读取打开在内存中准备结果。写入打开在重新校验子项成员与修订后，将当前后继发布到未修改的前代文件旁。已写入的 V4 文件不会重新运行该迁入边，因此未发布集成使用可丢弃的 home。Delivery generation 校验防止历史确认成为有效的 V4 水位。V3 读取方拒绝更新的 generation；[V3 schema 参考](historical-formats/v3.zh.md)保留原声明。

同一个未发布迁移向 `turn/end.reason` 添加 `forked`。精确切点的 fork 在继承标记之后追加子会话自有的错误结果和结束事件。V4 接纳经过校验、使用确定性分支 ID 和文案的未启动 fork 结果；已发布的 V0–V3 校验器和已记录的前驱代际保持不变。

<a id="verification"></a>
## 验证

`pnpm exec vitest run packages/session/session-format-v3-to-v4/tests packages/session/session-format-catalog/tests packages/session/session-persistence-jsonl/tests/catalog-migration.spec.ts` 的九个文件共 140 个测试通过，一个测试跳过。这些测试覆盖 catalog 补全、继承切点、子日志证据拒绝，以及 JSONL 准备与发布。

写入器变更前，`pnpm run verify-persistence-catalog` 通过，且 `pnpm run verify-persistence-formats --archive 3` 已捕获 V3 schema。V4 header schema digest 保持不变。

精确切点 fork 集成后，聚焦的 Session、agent-loop、Session Controller、V4、chat-view 和 compaction 测试共 63 个文件、1,523 个测试通过。V4 fork 测试确认编码、解码和恢复保留原始 ID 与文本，拒绝格式错误的结果，并验证嵌套继承切点。

<a id="dev-note"></a>
## 开发备注

无。
