# Agent Note: 保留子目录证据不完整的 V3 Session

Status: implemented

[English](2026-09-19-v3-incomplete-child-catalog-evidence.md) | 中文

## Problem

有效 V3 子日志可能没有自身 descriptor、descriptor 版本不受支持，或存在多个 descriptor。其 header 仍能确定身份及父子关系。要求一个受支持的 descriptor 才迁移父日志，会让不可获得的发现字段阻止读取原本可读的历史。

## Decision

V3→V4 迁移只在恰好一个受支持的自身子 descriptor 提供发现字段时，追加缺失的父目录项。其他 descriptor 数量及不受支持的版本不贡献新的目录事实。已有父目录项和子事件保持完整。这只替代[相邻迁移决策](../architecture/2026-08-31-released-session-format-migrations.zh.md)中的证据缺失拒绝规则。

已知子创建时间仍必须与已有父目录项一致。可获得且明确的 mode 和 label 字段也必须一致。已知 descriptor 字段无效、日志损坏、成员关系不可读、所选代际不受支持以及源修订变化仍保留原有失败行为。

## Alternatives considered

**拒绝整个父 Session。** 发现元数据不足以成为禁止读取有效父历史的理由。

**选择一个 descriptor 或推断默认值。** 多个 descriptor 无法确定哪个身份已被准入。推断的 mode 或 label 会在没有证据的情况下成为持久目录事实。

## Consequences

没有可用 descriptor 的历史子 Session 仍可按 id 读取，但可能不出现在其父级的直属子目录中。已有目录项仍可见。V4 后继发布后，打开它不会重新扫描历史子日志；后续自动修复目录不属于本迁移。准备过程仍会在发布前复查子修订，因此新出现的证据无法悄悄绕过源一致性检查。

单元、JSONL 读写和 Preview 打包测试覆盖不可用证据、源字节不变、条目保留、身份冲突以及发布前的证据变化。
