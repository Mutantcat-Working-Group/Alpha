---
description: "将 V3 Session 恢复为 V4，保留事件、继承切分点和已记录的投递代际。"
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v3-to-v4

[English](README.md) | 中文

## 概述

将受支持的 V3 Session 恢复为 V4，不改变其中的事件或历史请求。该库推进头部版本，保留事件坐标和继承切分点，并防止历史投递标记成为生效的 V4 水位。持久化通过静态目录使用本库；本库不读取或发布文件。

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

逻辑头部只将 `version: 3` 改为 `version: 4`。每个获准事件都保留其类型、载荷、时间戳、序号、消息身份、surface 操作和引用。Stage 输出原始事件对象，不增删或重排事件。已发布 V3 编解码器仍由 [V2 到 V3](../session-format-v2-to-v3/README.zh.md)拥有；本包复用它，不改变较早迁移的语义。

源事件必须从零开始连续编号。带种子的 Session 中，最后一个携带 `inherited: true` 的 `session/end-seed` 决定继承事件数，不包含该标记本身。传入的源切分点必须与之相符。带种子却缺少标记，或不带种子却出现继承标记的 Session 均被拒绝。每个 Stage 独立拥有计数器和切分点；带种子的 Stage 在 EOF 前保持切分点未知，包括前序迁移改变事件数的情况。

完整恢复对未改变的表示应用[原生 V3 准入规则](../session-format-v2-to-v3/README.zh.md#native-v3-admission)：拒绝格式错误的规范事件和无效关系；未知必需事件类型要求已安装的事件词表支持；未知可忽略事件保留其不透明值。该恒等迁移不改变坐标或载荷含义，因此保留不透明数据不需要解释其内容。较早迁移边各自的源审计策略保持不变。

`session-log-deepseek/delivery-accepted` 事件必须标识非负安全整数代际；省略时表示 V0。声称属于 V4 的源标记会被拒绝，因为推进头部会使它生效。源 V3 标记要求非空 Session id，以及指向较早事件的 `throughSeq`。属于其他 Session 的 V3 标记只允许出现在带有 `parentSession` 的 Session 的继承前缀中。其他代际保留记录的坐标和 id。任何投递载荷都不会被重写。

V4 恢复按相同规则校验 V4 投递坐标和归属。V3 投递在 V4 中属于历史数据，不会成为 V4 水位。V4 编解码器保留 V3 行格式和恢复前的结构性拒绝规则；完整的词表、投递和关系校验需要目标恢复器或目录的 `validation: 'current'`。仅执行可恢复编解码读取不能证明严格恢复成功。

-----

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

历史请求保留记录的消息与模型配置，因为[恒等迁移 Stage](src/migration.ts)保留 `SessionFormatEvent.data`。该迁移边不添加模型可见内容。

#### Token 影响

恒等转换不改变请求文本或承载 token 的数据。

#### KV Cache 影响

该迁移边保留记录的请求前缀。提供方缓存的可用性和淘汰策略不属于本库职责。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- **现有 V4 数据跳过此迁移边** — 对尚未发布迁移的后续修改不会转换已经写出的 V4 代际。集成测试需要使用新的临时 home，并从未改变的历史输入初始化。
- **不发布文件** — 本库返回已校验的逻辑事件；持久化负责在不改变已提交代际的前提下发布后继文件。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
