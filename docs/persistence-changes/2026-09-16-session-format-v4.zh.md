---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-16-session-format-v4

[English](2026-09-16-session-format-v4.md) | 中文

## 概述

将 V4 集成写入方声明的 SessionHeader.version 从 3 推进到 4，记录一等 tool 角色结果，并向 turn/end.reason 添加 forked 变体。

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
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-14-image-offload"
    after: "cbe418d5a3727fbd3599f90101680dae254ac1d6163b1b8b2ca30f28afb5212a"
    decision: version-bump
  - root: "event:assistant/attempt"
    previous: "2026-09-14-image-offload"
    after: "2f1565d92801f4334f8dc34fbb980890eef621e81a7c90ed0fd8d0a6db2ec3b2"
    decision: version-bump
  - root: "event:assistant/message"
    previous: "2026-09-14-image-offload"
    after: "f219a9f66fcc92ffec27bbd96fa21ffc2cffbaf2ad1de05757ec37205b1a0b58"
    decision: version-bump
  - root: "event:compaction/summary"
    previous: "2026-09-14-image-offload"
    after: "86c1ee9c8ab6c6e160d4ccc00b3d9ad5a6c687938b552d55eec528279baa1559"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-09-14-image-offload"
    after: "2a47ef7025d7dcf7e9977aadd738e7408a210b101a7dbbd37f4d87f22166eff0"
    decision: version-bump
  - root: "event:system/message"
    previous: "2026-09-14-image-offload"
    after: "1772581b17e1fab970fda49f04ffae2a181b7992ca4efa63bffe5f8b2bd62300"
    decision: version-bump
  - root: "event:team/message/queued"
    previous: "2026-09-14-image-offload"
    after: "9a25c2e889855516a531dc906905ec1d88157f7c2651aed27ac4f754bb128240"
    decision: version-bump
  - root: "event:tool/ptc-dispatch"
    previous: "2026-09-14-image-offload"
    after: "75f1d59512dd2e6468bed27c6203a721b116ef7869e291e3fee34c977d013185"
    decision: version-bump
  - root: "event:tool/result"
    previous: "2026-09-14-image-offload"
    after: "f4c6f3eae6607f412a9023406c8c3bd351a02451848bb78c2436f409447dd60c"
    decision: version-bump
  - root: "event:turn/end"
    previous: "2026-09-14-image-offload"
    after: "0f8512903d94f57a4748fa1a2092e64342856796684e6b8343db685b192745ce"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-09-14-image-offload"
    after: "5274b395e7bf6660d020fba7e29a1e20ef2e77097fd7597e9debb13e45c540d6"
    decision: version-bump
```

<a id="compatibility"></a>
## 兼容性

工具角色声明会改变十个事件根，因为 inbox 条目、消息事件、compaction 摘要、标题请求、团队消息和 PTC dispatch 嵌入了共享的 `Message` 或 `ContentBlock` 声明。从联合中移除 `tool-result` 并按角色细化消息，会改变这些可达 schema，并非新增十套独立事件协议。`turn/end` 的变更单独记录 forked reason；`SessionHeader` 记录版本递增。

[原生 V4 校验决策](../../.agents/notes/implemented/architecture/2026-09-17-native-v4-read-validation.zh.md) 负责说明这些当前字段所需的读取接纳规则。

V3-to-V4 迁移将已发布的 user 角色工具结果提升为 tool 角色消息，包含必需的 toolCallId 和可选的 isError。工具结果包装不再属于内容块联合。迁移保留每个已接纳源事件和继承切分点，并根据同一持久化根目录中保留的直属子 Session 日志追加缺失的父级 subagent/catalog 记录。历史正文恢复要求显式提供子日志证据集合；没有可供补全的子日志时也须传入空集合。缺少必需的 descriptor 或身份冲突会拒绝迁移且不发布后继；已有 catalog 事实保持不变。历史读取打开在内存中准备结果。写入打开在重新校验子项成员与修订后，将当前后继发布到未修改的前代文件旁。Delivery generation 校验防止历史确认成为有效的 V4 水位。V3 读取方拒绝更新的 generation。同一个未发布迁移向 turn/end.reason 添加 forked。精确切点的 fork 在继承标记之后追加子会话自有的错误结果和结束事件。V4 接纳经过校验、使用确定性分支 ID 和文案的未启动 fork 结果；已发布的 V0–V3 校验器和已记录的前驱代际保持不变。

<a id="verification"></a>
## 验证

精确切点 fork 集成后，聚焦的 Session、agent-loop、Session Controller、V4、chat-view 和 compaction 测试共 63 个文件、1,523 个测试通过。V4 fork 测试确认编码、解码和恢复保留原始 ID 与文本，拒绝格式错误的结果，并验证嵌套继承切点。工具角色迁移测试和 SDK 快照刷新也在原始变更中通过；构建后的 Python runtime sdk-snapshot 场景通过，定向 pi-ai 与 auto-review 覆盖率检查通过 351 个测试，三个受影响模块覆盖率均为 100%。

<a id="dev-note"></a>
## 开发备注

无。
