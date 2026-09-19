# Agent Note: 保留子目录证据不完整的 V3 Session

Status: implemented

[English](2026-09-19-v3-incomplete-child-catalog-evidence.md) | 中文

## Problem

有效 V3 子日志可能没有自身 descriptor、descriptor 版本不受支持，或存在多个 descriptor。其 header 仍能确定身份及父子关系。要求一个受支持的 descriptor 才迁移父日志，会让不可获得的发现字段阻止读取原本可读的历史。

## Decision

离线夹具准备和 Preview 打包中的可选 V3→V4 catalog 补全，仅在恰好一个受支持的自身子 descriptor 提供发现字段时追加缺失父条目。其他 descriptor 数量或不支持的版本不贡献新事实，已有父条目和子事件保持完整。运行时 JSONL 迁移不收集这些证据，并按[相邻迁移决策](../architecture/2026-08-31-released-session-format-migrations.zh.md)独立恢复各会话。

传入子创建时间必须匹配已有父条目。只有恰好一个受支持自身 descriptor 时才检查模式、标签和 descriptor 字段。这些证据检查属于显式离线补全；子会话损坏或不支持的代次不会阻止运行时父会话迁移。

## Alternatives considered

**拒绝整个父 Session。** 发现元数据不足以成为禁止读取有效父历史的理由。

**选择一个 descriptor 或推断默认值。** 多个 descriptor 无法确定哪个身份已被准入。推断的 mode 或 label 会在没有证据的情况下成为持久目录事实。

## Consequences

即使没有父 catalog 条目，缺少可用 descriptor 的历史子会话仍可通过可读且关联父会话的头部被发现。运行时迁移保留该缺失状态，不虚构事实。子会话自身 open 执行解码并局部报告失败；发布父后继从不要求子解码成功。

纯补全与 Preview 测试保留不可用证据、已有条目和冲突覆盖。JSONL 读写回归覆盖父子独立打开、子变化期间父版本标识稳定，以及前代字节不变。

[会话独立迁移决策](./2026-09-19-session-local-subagent-migration.zh.md)取代运行时子正文收集与未打开分支投影读取；可选离线补全和持久化 catalog 语义仍有效。
