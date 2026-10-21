---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-16-session-format-v4

[English](2026-09-16-session-format-v4.md) | 中文

## 概述

会话格式 V4 用生产者自有的来源类型取代 V3 中包裹消息来源的插件包装，把系统提示词改为记录在日志中的 `system/message` 而不是请求头字段，将开发者消息新增为持久化事件，并把写入器版本提升到 4。

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
    previous: "2026-10-02-message-source-additive-kinds"
    after: "1506a9b8224986c83015ae99d2cb5ede705538c58c063d6a48ef6d761a31ba6c"
    decision: version-bump
  - root: "event:assistant/attempt"
    previous: "2026-09-14-image-offload"
    after: "15d5dfdd822aa35e115afd74a8982825a493880457774e6850bc1520b50875e4"
    decision: version-bump
  - root: "event:assistant/message"
    previous: "2026-09-14-image-offload"
    after: "1033093edd0db80ff410e00830b523405e00bb0c7684948e531ff65095799625"
    decision: version-bump
  - root: "event:compaction/summary"
    previous: "2026-09-14-image-offload"
    after: "e2f9a41e0989f54ed8cee80f8db2bcf9d60a5c810dc9d45b83fa050b9dce7602"
    decision: version-bump
  - root: "event:developer/message"
    previous: null
    after: "eef4ef54dc7a133d47448a4ee822e45a351314923ef5f66db34c8b24e4b32d80"
    decision: version-bump
  - root: "event:request/header"
    previous: "2026-09-11-initial"
    after: "a5805fab2457f244f1124989f2d50e48544294de239092278992db8b95807f71"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-10-02-message-source-additive-kinds"
    after: "fa8f7d3ebf08a76c7f7a8b0781873c4d819b964da5dbb52cd3cdfa5da34f452d"
    decision: version-bump
  - root: "event:system/message"
    previous: "2026-09-14-image-offload"
    after: "69081694be231d56fd9580ba14645fd5e35373202605d5c5c841a9435b5fa3b1"
    decision: version-bump
  - root: "event:team/message/queued"
    previous: "2026-09-14-image-offload"
    after: "21fb6a90d5068f6a0003b7ab316ed2f56342477146a65c00db0f13c4d8df667d"
    decision: version-bump
  - root: "event:tool/ptc-dispatch"
    previous: "2026-09-14-image-offload"
    after: "100f6dca1468538239522cde3533e5bd721d0f1a7b50bea8b0eb533ea6c96163"
    decision: version-bump
  - root: "event:tool/result"
    previous: "2026-09-14-image-offload"
    after: "7c9f44e90a0058f4cc532ae20dad0c10afa6eba22e70a6c79fc79490bad64397"
    decision: version-bump
  - root: "event:turn/end"
    previous: "2026-09-14-image-offload"
    after: "0f8512903d94f57a4748fa1a2092e64342856796684e6b8343db685b192745ce"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-10-02-message-source-additive-kinds"
    after: "3f72db3d87a0c5c43e68be467b4cca728eaf5adc1d5d2b6975ff42bfbd961761"
    decision: version-bump
```

<a id="compatibility"></a>
## 兼容性

读取器通过相邻格式迁移接受 V3 日志：历史插件来源被提升为对应生产者的类型，本构建未声明的扩展类型以 `plugin:` 身份命名空间化。未知来源类型被保留而不是拒绝，因此后续生产者自有的类型可以直接以同版本增量加入。写入器只输出 V4 且不降级；任何进一步的结构性变更都需要更高的写入器版本及其自身的头版本转换。

<a id="verification"></a>
## 验证

格式迁移用例把录制的 V3 语料回放为 V4，并逐项对比已发布的期望结果；目录与持久化用例把当前声明与本确认记录比对；客户端投影、subagent 目录与会话查询用例端到端覆盖生产者自有来源类型与开发者消息事件。

<a id="dev-note"></a>
## 开发备注

无。
