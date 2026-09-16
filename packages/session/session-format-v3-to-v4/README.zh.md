---
description: "将 V3 Session 恢复为 V4，保留事件、继承切分点和已记录的投递代际。"
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v3-to-v4

[English](README.md) | 中文

## 概述

`dsh-session-format-v3-to-v4` 将已发布的 V3 Session 恢复为尚未发布的 V4 集成格式。入边保留已接纳事件，追加缺失的父目录记录，并继承 V3 分帧与关系校验。静态格式目录使用本库；JSONL 持久化负责源读取和后继代发布。

## 目录

- [使用本包](#use-this-package)
- [V3 到 V4 规范](#v3-to-v4-specification)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

完整恢复应使用[目录](../session-format-catalog/README.zh.md)。直接导入用于组装目录和测试；本库没有 Cordis 挂载配置。[公开导出](src/index.ts)提供相邻迁移、原样复用的已发布 V3 编解码器、V4 编解码器和目标校验器。

仅头部操作推进已校验的元数据，不读取正文：

```text
const targetHeader = sessionFormatV3ToV4.migrateHeader(sourceHeader)
```

完整恢复解码行、通过新的 Stage 处理行，并校验目标产物。Stage 的部分输出不代表恢复成功：后续事件或 `finish()` 仍可能拒绝该产物。严格的目录恢复使用 `{ recovery: 'strict', validation: 'current' }`；[格式协议](../session-format/README.zh.md)负责调度和错误处理。

-----

<a id="v3-to-v4-specification"></a>
## V3 到 V4 规范

逻辑头部只将 `version: 3` 改为 `version: 4`。每个获准事件都保留其类型、载荷、时间戳、序号、消息身份、surface 操作和引用。Stage 输出原始事件对象，并在未改变的源事件之后追加缺失的自身父目录记录。已发布 V3 编解码器仍由 [V2 到 V3](../session-format-v2-to-v3/README.zh.md)拥有；本包复用它，不改变较早迁移的语义。

源事件必须从零开始连续编号。带种子的 Session 中，最后一个携带 `inherited: true` 的 `session/end-seed` 决定继承事件数，不包含该标记本身。传入的源切分点必须与之相符。带种子却缺少标记，或不带种子却出现继承标记的 Session 均被拒绝。每个 Stage 独立拥有计数器和切分点；带种子的 Stage 在 EOF 前保持切分点未知，包括前序迁移改变事件数的情况。

完整恢复对未改变的表示应用[原生 V3 准入规则](../session-format-v2-to-v3/README.zh.md#native-v3-admission)：拒绝格式错误的规范事件和无效关系；未知必需事件类型要求已安装的事件词表支持；未知可忽略事件保留其不透明值。该迁移不改变源坐标或载荷含义，因此保留不透明数据不需要解释其内容。较早迁移边各自的源审计策略保持不变。

`session-log-deepseek/delivery-accepted` 事件必须标识非负安全整数代际；省略时表示 V0。声称属于 V4 的源标记会被拒绝，因为推进头部会使它生效。源 V3 标记要求非空 Session id，以及指向较早事件的 `throughSeq`。属于其他 Session 的 V3 标记只允许出现在带有 `parentSession` 的 Session 的继承前缀中。其他代际保留记录的坐标和 id。任何投递载荷都不会被重写。

V4 恢复按相同规则校验 V4 投递坐标和归属。V3 投递在 V4 中属于历史数据，不会成为 V4 水位。V4 编解码器保留 V3 行格式和恢复前的结构性拒绝规则；完整的词表、投递和关系校验需要目标恢复器或目录的 `validation: 'current'`。仅执行可恢复编解码读取不能证明严格恢复成功。

-----

### 入口

```text
const catalog = createSessionFormatCatalogWithChildren(childFacts)
const restore = catalog.createRestore(physicalHeader, {
  recovery: 'strict', validation: 'current',
})
for (const row of rows) restore.decodeRow(row)
const artifact = restore.finish()
```

`childFacts` 必须显式提供；空数组声明没有可补齐的子 Session。catalog 使用 `createSessionFormatV3ToV4(childFacts)` 在 stage 工厂中绑定这些证据；通用迁移接口不传递子 Session 数据。在已绑定迁移的生命周期内保持证据不变。`historicalChildCatalogSource()` 收集直属 subagent 子 Session 的 id、创建时间、继承前缀之后的自身 descriptor 数量及载荷。收集阶段允许 descriptor 缺失或版本未知。Stage 将 descriptor v1 解释为必须带 label 的 continuable，按 v2/v3 的 mode 与 label 字段解释这两个版本；它不恢复历史 continuation composition。

父 Session 已有的自身目录记录不要求子 descriptor 可用。记录中的扩展字段保持不变；创建时间与可获得的受支持发现字段必须与子 Session 一致。重复的自身 descriptor 会被拒绝。缺失的目录记录要求恰好一个受支持且发现字段完整的 descriptor；descriptor 缺失或版本未知会拒绝迁移且不发布后继版本。原生 V4 读取也检查自身目录字段及唯一性；畸形目录数据报告格式错误，而不是入边迁移失败。目录载荷版本 0 是准入模式；后续载荷演进必须同时更新编解码器准入规则与仓库的持久化变更记录。

迁移保留每个来源事件及其顺序、序号、时间和 payload，仅按创建时间、子 id 排序追加缺失的自身目录记录。追加时间使用来源最后一个事件的时间，空日志使用 header 创建时间。目录字段与唯一性检查仅作用于最终继承截点之后的记录；继承的 payload 保持不透明，也不计入自身成员关系。已有目录的扩展字段原样保留。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制 — 点击展开</summary>

迁移声明创建相互独立的流式 Stage。紧凑事件段通过迭代器展开，不生成中间事件数组。V4 编解码器只转换物理头部版本，将已发布 V3 事件行格式和恢复行为委托给原编解码器。JSONL 扫描器在抑制可恢复行之前调用 `assertV4RowAdmission`。

目标恢复器通过私有 V3 关系视图区分 V4 投递和历史 V3 投递，然后返回原始产物。临时的代际替换不会离开该视图。本包不发布运行时不变量伴随插件，因为这个纯函数库不拥有独立维护的运行时观测。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [格式版本与发布状态](../../../docs/session-format-status.zh.md) — 当前检出写入版本与已发布格式的权威记录。
- [添加 Session 格式版本](../../../docs/cookbook/adding-a-session-format-version.zh.md) — 相邻迁移边的集成与校验。
- [JSONL 持久化](../session-persistence-jsonl/README.zh.md) — 不可变代际选择与发布。

-----

<a id="model-experience"></a>
## 模型体验

### 历史恢复

#### 模型看到什么

历史请求保留记录的消息与模型配置，因为[迁移 Stage](src/migration.ts)保留 `SessionFormatEvent.data`。该迁移边不添加模型可见内容。

#### Token 影响

目录记录不直接进入模型消息；后续子代理列举可以发现历史子 Session。

#### KV Cache 影响

该迁移边保留记录的请求前缀。提供方缓存的可用性和淘汰策略不属于本库职责。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- **尚未发布的集成格式**——发布 V4 前须集成并验证选定的结构变更；已写入的 V4 文件不会重跑此入边。使用可丢弃的集成 home，并保留原始历史输入。
- **依赖保留的子日志**——仅凭父日志无法恢复未记录的子 id、创建时间或 descriptor。删除的子 Session 无法从工具参数恢复；已存在的父目录记录仍保留。
- **存储范围**——事实只覆盖同一持久化根目录内可识别的子 Session。跨根目录导入和损坏日志修复不属于此迁移。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
