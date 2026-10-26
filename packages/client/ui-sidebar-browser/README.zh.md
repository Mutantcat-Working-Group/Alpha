---
description: "右侧 Sidebar 浏览器 tab：在 sandbox 中访问 HTTP(S) 页面，包括 loopback 服务。"
kind: "package-reference"
---

# @mutantcat/dsh-client-ui-sidebar-browser

[English](README.md) | 中文

## 概述

在独立的右侧 Sidebar tab 中浏览 HTTP(S) 页面，包括 loopback 服务。Web 与 Desktop 都保留应用维护的 history：Web 用 iframe 渲染每个页面，Desktop 在 shell 能以原生 child webview 承载该页面时改用它，shell 拒绝时回到 iframe。本包不会向被访问内容注入桌面原生或 Node 能力。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

随附的 Web 与 Desktop composition 已挂载本包。可以从右侧 Sidebar guide 打开 **浏览器**、输入 HTTP(S) URL，或点击 Assistant Markdown 中的 HTTP(S) 链接。不带 scheme 的主机名会补全为 HTTPS。公共目标与 loopback 目标使用相同的默认 sandbox。每次 guide 操作或消息链接操作都会创建一个新的 Browser tab。

### 何时选择

当 Web 页面需要保留在当前 Session 旁时，选择 Browser。本地文件使用 [Document Preview](../ui-sidebar-documentpreview/README.zh.md)；站点需要本包不授予的浏览器 capability 时，或在 Web 中拒绝 iframe 嵌入时，使用明确的外部浏览器操作。

### 最小配置

本包没有配置字段。自定义 Web composition 挂载 Host companion；随后 Client loader 会发现 package manifest 声明的浏览器入口：

```yaml
- id: ui-sidebar-browser
  name: '@mutantcat/dsh-client-ui-sidebar-browser'
```

Client 插件可以调用 `ctx.sidebarRight.openTab('browser', { params: { url } })` 打开 tab。可选 URL 会在导航前接受与地址栏输入相同的校验。

工具栏提供后退、前进、刷新、前往、在系统浏览器中打开、逐 tab 的 sandbox 开关，以及选取组件按钮。关闭 sandbox 是临时选择，并会显示警告。外部打开接受已知的 HTTP(S) 目标。tab 标题显示 Web 主机名。Desktop 原生载体承载文档时 sandbox 开关不可用，因为 iframe `sandbox` 属性对该载体不生效。

### 选取组件（Desktop）

Desktop 会为已加载的页面启用选取组件按钮；Web 保持禁用，因为 iframe 无法读取跨域文档。进入该模式会在已经承载页面的 webview 中执行选取脚本，页面不会重新加载；当该 tab 没有原生载体时，shell 改为在 iframe 之上打开一个临时 child webview。移动指针会框出指针下的元素；点击某个元素会退出该模式，并把一份纯文本文档附加到当前 composer。按 Escape 或点击鼠标右键会退出该模式且不附加任何内容。该文档记录页面 URL 与标题、标签、XPath、CSS selector、DOM 深度、同级索引、父链、外接矩形、属性、部分计算样式、可见文本与外层 HTML。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节——点击展开</summary>

### 协议策略

地址解析器接受 HTTP 与 HTTPS，包括 loopback 目标。`file:` URL、脚本/data/blob 输入、内嵌凭据、DSH 应用自身 origin 和畸形地址会被拒绝。本地文件由 Document Preview 负责渲染。

### Iframe 载体

iframe 载体默认应用 `sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"`。frame 没有直接的下载或顶层导航 flag。popup 会脱离 sandbox；在 Web 中，逃逸的 popup 会保留 opener，并可以导航顶层应用。被访问的 origin 可以使用自身 Cookie 与 Web storage，但跨域目标无法读取 DSH DOM、storage 或 API 响应。iframe 不发送 referrer，也不添加包自有的 Permissions Policy，因此浏览器默认策略与用户授权生效。toolbar 可以为当前 tab occurrence 移除 sandbox；该选择不持久化。未受 sandbox 约束的页面可以按浏览器 activation 规则导航顶层应用，并使用下载、模态对话框和输入锁定。本包不代理或探测远程页面。

Web 记录 toolbar 提交和 typed tab 打开。导航状态机把每个受控 revision 的第一次 iframe load 视为已知，把后续 load 视为页面已经变化到不可读取 URL 的证据。进入 unknown 状态后，地址会显示标记，后退、前进和外部打开会禁用，刷新则返回最后一个受控 URL。body 重挂载时会重新加载应用最后已知的 URL，并且仅在尚无受控目标时使用可选初始 URL。不产生 iframe load 的 History API 与 fragment 变化仍不可见。iframe `error` event 会显示临时加载失败 notice，直到下一个受控加载，但不会改变 URL history。

### 原生载体（Desktop）

当 shell 暴露 browser-document bridge 时，Desktop 用原生 child webview 渲染当前文档。body 用一个占位 div 替换 iframe，把该矩形上报给 shell，并在文档打开期间每帧重新测量该矩形，因此只发生位移的载体仍能把 child webview 留在其上方；关闭该 tab occurrence 会关闭该 child webview。顶层 child webview 不受 `X-Frame-Options` 或 CSP `frame-ancestors` 指令约束，因此拒绝 iframe 嵌入的页面也能渲染。

shell 把每次完成的导航作为该载体所持 revision 的一次 load 上报，同一个导航状态机消费该上报。页面发起的 popup 在 shell 处被拒绝，并带着目标 URL 上报，客户端通过 `window.open` 打开该 URL。该载体不跨 body 重挂载保留页面 identity，不按 tab 隔离 Cookie，也不暴露调试目标。shell 拒绝打开载体时，该文档回到 iframe。

### Controller

每个 tab 获得一个 `BrowserController` class。它的公开命令只有 `loadUrl`、`goBack`、`goForward` 与 `reload`；地址校验与 history 变更均由该对象封装。它的 `BrowserNavigation` class 拥有可序列化的 URL 状态机。`BrowserFrame` 接口负责临时 sandbox 与 document 状态以及载体操作，`IframeImpl` 为当前 iframe 载体实现该接口。Slot injection 通过 `useBrowserFrame` 提供按 key 索引的 frame 状态，并提供普通 callback，因此 React body 不接收 controller 或 observable source；它只保留可编辑草稿与承载页面的 DOM 节点。

Controller 接口不依赖 iframe API。`openNativeDocument`、`moveNativeDocument` 与 `closeNativeDocument` 通过 shell bridge 操作 Desktop 载体；被拒绝的打开会标记 frame，让 body 把该文档交回 iframe。持有 attachment、detach 与 target identity 的 per-tab 原生视图对象仍然延期，并记录在同一份 Sidebar Browser 决策中。

### 选取组件载体

选取组件在 iframe 之外读取页面。toolbar 把 iframe 矩形与 tab key 交给原生 shell：该 tab 已有原生载体时，shell 直接在承载页面的 webview 中执行选取脚本，页面保持已加载状态；否则 shell 在该位置打开一个临时 child webview 并注入脚本。被选中的元素通过一个私有导航 origin 回报，shell 在 URL 提交前拦截它，并以 event 形式把编码后的文档交给 Web 客户端。Web 客户端随后调用 `IConversation.attachTextDocument` 把该文档作为 composer 附件接管。`BrowserFrame` 与 sandbox、document 状态并列持有选取模式。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [右侧 Sidebar](../../../docs/subsystems/sidebar-right.zh.md)——tab composition、导航与生命周期。
- [Document Preview](../ui-sidebar-documentpreview/README.zh.md)——本地源码、Markdown、图片、HTML 与 PDF 渲染。
- [Sidebar Browser 决策](../../../.agents/notes/implemented/feature/2026-09-16-sidebar-browser.zh.md)——当前 iframe 行为、controller 所有权与延期原生载体工作。

-----

<a id="model-experience"></a>
## 模型体验

无。Browser tab 是用户侧呈现状态，不注册工具、prompt section 或 Session event。

#### KV Cache 影响

无；浏览内容不进入模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

隔离策略有意放弃部分浏览器兼容性：

- 在 Web 中，很多站点拒绝 iframe 嵌入，或需要默认 sandbox 不向 frame 授予的下载与顶层导航。HTTPS 应用还可能按 mixed-content 策略阻止公共 HTTP 页面。关闭 sandbox 会用自身限制换取兼容性，但不会绕过 mixed-content 或 private-network 策略。未受 sandbox 约束的 frame 可以按浏览器 activation 规则导航顶层应用，并使用下载、模态对话框和输入锁定。该模式不会按 Browser tab 隔离被访问 origin 的 Cookie，也无法阻止 iframe 内页面自行选择后续 URL。
- 在 Web 中，逃逸出 sandbox 的 popup 会保留 opener，并可以通过该链导航顶层应用。Desktop 会单独处理 popup 创建。
- 后续 iframe load 能表明发生了导航，但无法给出新的跨域 URL。History API 与 fragment 变化可能仍不可见；状态变成 unknown 后，Web 的后退与前进不可用。
- 出于安全原因，浏览器会隐藏很多 iframe 失败：DNS、TLS、mixed-content、CSP 与 `X-Frame-Options` 失败可能触发 `load`，也可能不提供可操作 event，而不是触发 `error`。加载失败 notice 只能作为 best-effort 提示。
- Browser history 会跨 body 重挂载与普通页面刷新保留，但关闭 tab 或卸载 `ui-sidebar-right` 会中止其 occurrence 并删除已存储的 history bucket。
- 本地文件会被拒绝，并继续由 Document Preview 负责。
- 选取组件仅在 Desktop 可用，并且描述被选页面的顶层 document：嵌套 frame 或 shadow root 中的内容会通过承载它的元素回报。Web 上该按钮显示为禁用。
- Desktop 原生载体是每个 tab occurrence 一个 child webview，因此它不跨 body 重挂载保留页面 identity，不按 tab 隔离 Cookie，也不暴露调试目标。per-tab Cookie partition、原生 history 和 target-specific CDP 连接仍然延期，持有 attachment、detach 与 target identity 的 per-tab 原生视图对象同样延期；选取组件在已有原生载体时复用它，否则退回自己临时的 child webview，并随该模式一起关闭。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布 companion。`BrowserNavigation` 是唯一的 URL 状态写入方；store 接收它的 immutable snapshot，controller 与组件的聚焦测试直接覆盖发布与清理。
