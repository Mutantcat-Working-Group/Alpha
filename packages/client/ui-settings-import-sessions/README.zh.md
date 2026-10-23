---
description: "alpha Web 客户端的导入会话设置页：以下拉框呈现宿主机上已安装的 Agent 会话存储，配一个显式导入操作与逐会话结果列表。"
kind: "package-reference"
---

# @mutantcat/dsh-client-ui-settings-import-sessions

[English](README.md) | 中文

## 概述

**导入会话**设置页把其他 Agent 的聊天历史带入 Alpha。页面打开时向宿主询问本机安装了哪些 Agent 会话存储，并把它们列进同一个下拉框，Alpha 自己的存储排在首位；某个存储只有在其安装被检测到时才会出现。选中一项并按**导入**，即从该存储执行一次导入。随后它按每个发现的会话列出一行——已导入、已存在，或已拒绝并附上宿主给出的原因——以及一行计数汇总。按下按钮之前不会有任何动作：没有监视器、没有轮询，也没有后台同步。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

打开设置并选择**导入会话**，挑选要导入历史记录的 Agent，然后按**导入**。在已提供设置外壳、locale 运行时，以及发布 `harnessSessionsImport` 服务的插件的 Web 组合中挂载 `@mutantcat/dsh-client-ui-settings-import-sessions`；该页面注册自己的导航条目，本身无需配置。

### 选择来源 Agent

下拉框列出宿主机所运行的机器上已安装的 Agent 会话存储，检测范围是用户主目录。Alpha 自己的条目读取部署配置的 Harness sessions 根目录，默认为官方 DeepSeek Harness 主目录下的 `sessions` 目录，因此配置成该默认布局之外的根目录时，导入打开的仍是它。外来条目覆盖这些 Agent 写入的布局——Codex 的 `~/.codex` 目录、Claude Code 的 `~/.claude/projects`、ZCode 的 `~/.zcode` 目录——且只有在其安装存在时才会出现，未安装的存储绝不会被提供。页面对它打开的每个存储都只读：它把采纳的会话复制进 Alpha 自己的存储，绝不移动、改写或删除那里的任何内容。

### 阅读结果

每一行在会话被采纳时以 Alpha 标识命名，在被拒绝时以来源路径命名，并显示三种状态之一。**已导入**表示本次运行已把它复制进 Alpha。**已存在**表示该会话的标识已在 Alpha 存储中，因此本次运行未改动它。**已拒绝**表示该会话无法读取或校验；宿主给出的原因显示在该行上，而同一次运行中的其他会话仍会导入。调用成功后页面会重新拉取 Session 列表，因此被采纳的会话无需手动刷新就会出现在导航中。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

页面是 id 为 `import-sessions` 的一个本地化 `settings.section` 贡献，排序紧随已归档会话页之后；导航条目、模态框与挂载的分区都归设置外壳所有，不在此包内。

### 注册与数据来源

`apply()` 注册并绑定 locale namespace，再用 `ctx.slots.inject()` 贡献该分区，因此延迟声明或恢复声明的 slot 依然能触达它。注册处以 `ctx.harnessSessionsImport` 闭包：`sessionSources()` 列出已安装的 Agent 及其各自读取的根目录，`importSessions()` 执行导入并刷新 Session 列表。页面不持有 store、不持有 transport，也没有自己的刷新逻辑；检测到的 Agent、选中的根目录、进行中状态与最近一次结果都是组件本地状态。

### 失败处理

检测读取被拒绝或导入调用被拒绝时，页面渲染失败信息并回到空闲可用状态，用户可改选其他 Agent 后重试。逐会话的拒绝是数据而非错误：它们随成功结果一起返回，绝不会中止本次运行。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 宿主 loader 入口：该页面仅供浏览器使用，因此插件体为空 |
| [`src/client/index.ts`](src/client/index.ts) | 浏览器插件：locale namespace、分区注册、注入的检测与导入调用 |
| [`src/client/ImportSessionsSection.tsx`](src/client/ImportSessionsSection.tsx) | 页面组件：来源 Agent 下拉框、导入操作、进度、结果行 |
| [`src/client/locales.ts`](src/client/locales.ts) | 全部可见与无障碍字符串的中英文字典 |
| [`src/client/ImportSessionsSection.module.css`](src/client/ImportSessionsSection.module.css) | 页面样式 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖按钮背后的操作、它写入的存储，以及它迁移的来源格式。

- [Session Controller](../../api/session-controller/README.zh.md)——`session.importHarnessSessions` 与 `session.harnessSessionSources` Remote、`harnessSessionsRoot` Config 字段，以及本页面读取的 client 端 `harnessSessionsImport` 接口。
- [session-persistence-jsonl](../../session/session-persistence-jsonl/README.zh.md)——只读的外部 sessions 根目录读取器，负责发现并还原来源世代。
- [Session 子系统](../../../docs/subsystems/session.zh.md)——被采纳会话最终落入的持久 Session 存储。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端 UI 插件层，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定本页面如何采纳历史；它们是当前包约束。

- **只有用户请求时才会导入**：页面从不监视、轮询或同步来源目录，因此在某次运行之后写入的 Harness 会话需要再显式导入一次。
- **一次运行给出逐会话结果，而不是单一结论**：某个来源会话不可读或损坏时会被拒绝并附上宿主原因，而其同级会话仍会导入，因此部分成功是常态，绝不会被表述为整体失败。
- **来源目录永不被修改**：Alpha 只复制它采纳的内容，因此归档、删除或重新格式化来源完全属于 Harness 安装自身的事务。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包是浏览器端设置页，只注册一个本地化 `settings.section` 贡献及其 locale namespace；它不发出 Cordis 事件，也不持有跨插件可变关系。
