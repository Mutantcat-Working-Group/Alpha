---
description: "alpha Web 客户端的 subagent 对话目录、续接路由 UI 与 '@' 引用 source。"
kind: "package-reference"
---

# @mutantcat/dsh-client-ui-subagent

[English](README.md) | 中文

## 概述

使用本包可浏览父会话下的每个 subagent 对话、打开任意后代，并查看其是否正在运行以及 token 用量和活跃轮次耗时。已完成的 one-shot 对话会作为只读执行记录打开。可继续对话在运行期间按提交顺序接收后续提示词，并独立提供 Stop。普通会话侧边栏会省略 subagent 对话，因此父会话页头目录是它们的导航入口。独立的 `@` source 会把运行中 child 的 label 插入用户消息，但不会把它解析成继续执行地址。

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

会话头部保留当前标题作为层级导航，并为已知直接子会话或 catalog 错误追加 `/` 数量入口。列表行合并已有父 catalog 事实和会话列表中的头部关系，让历史子会话无需打开日志即可被发现。打开菜单或展开分支只刷新轻量会话列表。选择一行时，通过精确的 `{parentSessionId, childSessionId, mode}` 地址只打开该子会话；只有头部的条目使用 `mode: 'unresolved'`，直到读取自身 descriptor。末尾箭头将同一地址打开到右侧 Sidebar。

本包注册 `dsh-resource://subagentchat/session/<child>?parent=<parent>&mode=<mode>` 资源和内置 Sidebar 标签类型。资源在持有子会话 `SessionReference` 前刷新轻量会话列表，并在标签记录关闭时释放引用。标签通过 `sidebar.chat.conversation` 渲染共享的 `conversation.content` Factory，将局部 View 固定为 Chat，省略主 Conversation 头部和宽度控件。

### 浏览目录

列表行显示模式、活动状态和可选的日志标题；未解析条目显示“尚未打开”，在身份数据可用前使用 id。已有父 catalog 标签仍具有权威性。运行、完成和其他空闲子会话分别使用共享的进行中、成功和空闲标记。缓存的用量和耗时为可选项。ArrowRight/ArrowLeft 展开或收起分支，ArrowUp/ArrowDown、Home、End、Escape 用于导航或关闭树。头部发现的子会话若没有列出的后代或缓存 catalog 条目，无需读取正文即可作为叶节点。

### 续接对话

未解析子会话保持只读输入区，直到打开历史记录并得到有效身份。父代理在线的可继续子会话使用普通输入区：后续消息进入子代理 FIFO 收件箱，Stop 经 `subagents/interruptByParent` 路由。父代理不可用且未运行的可继续子会话使用只读输入区；仍运行时禁用输入和 Send，但保留 Stop。一次性子会话历史始终只读。

### `@` 引用 source

`@` source 仍然刻意保持独立且惰性：候选是从 `ctx.sessions.list` 零 RPC 得到的运行中 child；pick 会插入字面文本 `@label `，codec 投影为 `@label`。它不参与命令裁决，也不会把 label 解析成继续执行地址。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

目录与编辑器行为由 [Web subagent 对话笔记](../../../.agents/notes/implemented/feature/2026-07-27-web-subagent-conversations.zh.md) 与[当前轮次中断笔记](../../../.agents/notes/implemented/feature/2026-08-06-continuable-subagent-interrupt.zh.md) 规定。

### 目录派生

页头谱系 renderer 通过标准 `useSessions` 钩子读取 `subagentsByParent` 与会话摘要。紧凑树仍以直接目录为权威依据：每个健康行的 `hasChildren` 提示在交互前决定是否显示展开控件；每层目录仅在其中至少一个健康行是分支时才预留展开列；展开分支时会立即为每个已知直接后代预留一行禁用的加载行，随后再用该 child 的权威目录懒加载结果替换。每个可见分支都会上报给运行时，使成员帧只在树正被消费的位置触发去抖动刷新。

### 耗时与 token

token 用量总计为四个互不重叠的 `tokenUsage` 桶之和。耗时会累加已完成的 `subagentTiming` 轮次，仅在运行中 child 存在未结束轮次时每秒递增一次，并在 child 变为 inactive 后冻结；被中断的未结束轮次以其同一切面的 `active.through` 为上界，绝不使用更新的会话元数据。

### 编辑器选举

one-shot child 始终选用只读编辑器。可继续 child 仅在其确切 parent 不可用且 child 未在运行时选用只读编辑器；否则普通编辑器的会话会经 `subagents/prompt` 路由提示词。本包绝不接收宿主上下文，也不调用面向模型的工具。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖对话界面、宿主 seam 与设计笔记。

- [ui-conversation](../ui-conversation/README.zh.md)——承载页头操作与编辑器链的聊天界面。
- [ui-input-trigger](../ui-input-trigger/README.zh.md)——承载 `@` source 的建议机制。
- [subagent](../../subagent/subagent/README.zh.md)——可继续 child 背后的宿主能力 seam。
- [Web subagent 对话](../../../.agents/notes/implemented/feature/2026-07-27-web-subagent-conversations.zh.md)——目录与编辑器规范。
- [当前轮次中断](../../../.agents/notes/implemented/feature/2026-08-06-continuable-subagent-interrupt.zh.md)——独立 Stop 的语义。

-----

<a id="model-experience"></a>
## 模型体验

### 用户提示词中的 subagent label 文本

#### 模型看到的内容

只有 `@` 引用 source 会影响模型输入：pick 的候选以字面文本 `@label` 进入普通用户消息，没有专用内容块或宿主侧解析。浏览目录、导航 child 与查看持久化 transcript（文本记录）都不会添加提示词 section；已接收的继续交互内容会经宿主 subagent 适配器成为普通 FIFO 用户消息。

#### Token 影响

有条件且仅追加：字面 `@label` 或用户后续消息只会向对应的新用户消息增加 token。目录与 transcript 操作增加零模型 token。

#### KV Cache 影响

仅追加。本包绝不改写更早的请求 token。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义目录能显示什么、`@` 引用意味着什么；它们是当前包约束。

- **目录没有持久化结果**：活动状态与计时无法区分完成、失败或取消，且 UI 不公开 Activation 身份；停止能力仅限编辑器上针对运行中可继续 child 的当前轮次 Stop。
- **`@` 引用仍是显示标题文本**：重复或改名后的 label 会有歧义，因此它们刻意不获得继续执行语义。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。插件只注册一个 slash source，其资源释放已由 HMR（热模块替换）安全规范验证；它不发出 Cordis 事件，也不持有跨插件可变状态。
