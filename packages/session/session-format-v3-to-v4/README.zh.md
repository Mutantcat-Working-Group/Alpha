---
description: "将 V3 Session 恢复为 V4，使用原生工具角色行并保留继承切分点和已记录的投递代际。"
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v3-to-v4

[English](README.md) | 中文

## 概述

`dsh-session-format-v3-to-v4` 将已发布的 V3 Session 恢复为尚未发布的 V4 集成格式。工具结果转换为工具角色消息；入边保留已接纳事件和继承切分点，追加缺失的自身父目录记录，并防止历史投递标记成为生效的 V4 水位。V4 编解码器保留已发布的物理行格式，但不调用 V3 校验器；静态格式目录使用本库，JSONL 持久化负责源读取和后继代发布。

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

逻辑头部只将 `version: 3` 改为 `version: 4`。已发布的用户角色工具结果包装转换为工具角色消息，包含 `toolCallId`、可选的 `isError` 和直接结果内容。每个获准源事件都保留其类型、时间戳、序号、消息身份、surface 操作、引用和所有未迁移的载荷字段；Stage 处理源事件之后只追加缺失的自身父目录记录。已发布 V3 编解码器仍由 [V2 到 V3](../session-format-v2-to-v3/README.zh.md)拥有；本包复用它，不改变较早迁移的语义。

源事件必须从零开始连续编号。带种子的 Session 中，最后一个携带 `inherited: true` 的 `session/end-seed` 决定继承事件数，不包含该标记本身。传入的源切分点必须与之相符。带种子却缺少标记，或不带种子却出现继承标记的 Session 均被拒绝。每个 Stage 独立拥有计数器和切分点；带种子的 Stage 在 EOF 前保持切分点未知，包括前序迁移改变事件数的情况。

完整恢复校验原生 V4 工具与 fork 结果、turn/step 顺序、工具与 PTC 生命周期、重试、标题引用、命令、压缩归属与区间、受保护的 system 首节点、投递、目录成员关系、继承切分点及已安装的事件词表。它允许未完成的尾部，但会拒绝带有未结算工具或事务不匹配的关闭事件。已安装的 Session 恢复器负责通用事件行和消息的接纳。[原生校验决策](../../../.agents/notes/implemented/architecture/2026-09-17-native-v4-read-validation.zh.md)记录了职责划分。V3 语义校验器永远不会接收 V4 事件。

`session-log-deepseek/delivery-accepted` 事件必须标识非负安全整数代际；省略时表示 V0。声称属于 V4 的源标记会被拒绝，因为推进头部会使它生效。源 V3 标记要求非空 Session id，以及指向较早事件的 `throughSeq`。属于其他 Session 的 V3 标记只允许出现在带有 `parentSession` 的 Session 的继承前缀中。其他代际保留记录的坐标和 id。任何投递载荷都不会被重写。

V4 恢复按相同规则校验 V4 投递坐标和归属。V3 投递在 V4 中属于历史数据，不会成为 V4 水位。V4 编解码器只复用已发布 V2 的物理分帧，并在恢复前直接执行原生工具结果和 system 消息字段准入；完整的词表、投递和关系校验需要目标恢复器或目录的 `validation: 'current'`。即使位于可恢复的后缀，退役的 `header.system` 字段和必需的前代 PTC 标签也会被拒绝；可忽略的前代 PTC 记录保持不透明。仅执行可恢复编解码读取不能证明严格恢复成功。

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

V4 还接受 fork 生成的 `TOOL_NOT_STARTED` 结果，使用确定性的 `forked-tool-result-<callId>-<seq>` ID 和分支专用文案。原生校验直接检查声明的调用、错误结果、身份后缀和 surface 操作；持久化与恢复的数据保留原始 fork ID 和文案。后续 surface 替换（包括工具结果裁剪）保留该身份，并由已安装的 Session 校验其源引用。已发布的 V0–V3 校验器保持不变。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制 — 点击展开</summary>

迁移声明创建相互独立的流式 Stage。紧凑事件段通过迭代器展开，不生成中间事件数组。V4 编解码器只为物理头部和源范围分帧使用已发布 V2 编解码器，并直接校验原生工具角色行。JSONL 扫描器在抑制可恢复行之前调用 `assertV4RowAdmission`，并在返回完整逻辑前缀之前调用共用的强制关系校验器。

目标恢复器校验原生字段和强制跨事件关系，然后返回原始产物。未知的可忽略事件保持不透明，未完成的继承压缩事务在 end-seed 标记处结束。本包不发布运行时不变量伴随插件，因为这个纯函数库不拥有独立维护的运行时观测。

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

历史请求保留记录的消息与模型配置。[迁移 Stage](src/migration.ts)将 `tool/result` 载荷表示为工具角色消息，不添加模型可见内容；目录记录不会直接进入模型消息，后续子代理列举可以发现历史子 Session。

#### Token 影响

转换不改变请求文本或承载 token 的数据。

#### KV Cache 影响

该迁移边保留记录的请求前缀。提供方缓存的可用性和淘汰策略不属于本库职责。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- **尚未发布的集成格式**——发布 V4 前须集成并验证选定的结构变更；已写入的 V4 文件不会重跑此入边。使用可丢弃的集成 home，并保留原始历史输入。
- **历史嵌套工具结果**——迁移会拒绝包含另一层 tool-result 包装的结果，因为展平会丢失其调用身份和错误状态。原始代际保持不变，也不会发布 V4 后继；这些历史需要能保留信息的转换才能继续运行。
- **历史工具结果扩展**——外层消息的 JSON 属性仍保留为自有数据属性，包括 `__proto__` 和 `constructor`。未知 wrapper 字段没有已定义的 V4 存放位置，因此拒绝迁移。已有外层 `toolCallId` 或 `isError` 字段必须与提升后的结果一致；冲突时拒绝且不发布 successor。
- **依赖保留的子日志**——仅凭父日志无法恢复未记录的子 id、创建时间或 descriptor。删除的子 Session 无法从工具参数恢复；已存在的父目录记录仍保留。
- **存储范围**——事实只覆盖同一持久化根目录内可识别的子 Session。跨根目录导入和损坏日志修复不属于此迁移。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
