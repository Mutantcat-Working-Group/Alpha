# Agent Note：Web 子代理目录消费共享 projection

Status: implemented

[English](2026-09-08-web-subagent-catalog-projections.md) | 中文

## 问题

父目录 projection 已通过 Session control stream 发布完整成员关系。独立的目录变化事件、重复 RPC 读取与第二份成员缓存重复传递同一数据，并要求协调响应与后续事件。历史 Session 的 projection 缺席时仍需初始加载，父 Agent 可用性也独立于持久成员关系。

## 决策

Client 仅在标准每会话投影存储中保留 catalog 事实。显式 `session.projections` 读取从一次优先存活来源的会话观察返回完整基线；端点接受任意会话 id，不依赖 catalog 专用校验。观察同时提供数值和序列游标；初始基线与实时控制帧遵循已有序列排序，旧响应不能覆盖新值。端点不激活 Agent 或采样子活动。打开对话使用 follow 基线，不另行请求投影。未打开分支使用会话列表的头部关系，不请求子投影；缺失的历史 catalog 条目保持为非持久化、未解析的导航行，直到打开子会话。

功能消费者从 `projectionsBySession` 选择 `subagentCatalog`，用关联父会话的子代理摘要补充缺失行，并从会话列表基线和状态事件派生活动。头部发现的条目携带未解析模式，不授予续接权限。菜单与分支刷新只更新轻量会话列表。打开选中的子会话时校验 descriptor 和父归属并解析模式，失败仅影响该子会话。已有投影排序、通用显式投影读取和独立父可用性保持不变。

[父目录决策](../architecture/2026-09-01-parent-owned-subagent-catalog.zh.md) 说明持久创建事实与顺序。本决策取代 [Web 子代理会话](../feature/2026-07-27-web-subagent-conversations.zh.md) 中的专用成员刷新机制；该记录继续保留导航、控制与展示决策。

Host 摘要替换运行状态与可用性；本地 create/fork 占位摘要只补充缺失的元数据。若共用覆盖行为，晚到的本地响应会抹去较新的 Host 状态，并生成虚假的完成提醒。普通 Session 移除后，仅为非空子目录保留 store；空目录没有需要保留的导航关系。面包屑 selector 从 Session 列表快照推导地址，使订阅涵盖全部依赖。

## 考虑过的替代方案

**保留通知驱动的读取。** 不采用，因为共享流已经传递变化后的值。菜单订阅、请求内活动状态回放与尾随成员读取没有提供额外的必要传递能力。

**删除初始读取 endpoint。** 暂缓。Session 列表 projection 是可能缺席的缓存提示；跟随会话还会传输历史并保留 observation 状态。轻量读取保留历史目录访问能力，无需建立会话跟随流。父 Agent 可用性是实时投递提示，而非持久 projection 事实。

## 影响

成员变化使用既有 control stream，无需额外目录通知或读取。对 D 个子级发布完整 projection 值仍需 O(D)；本变更不引入增量传输。初始读取返回 observation 的完整 projection 基线，其中包括目录以外的值，以额外初始载荷换取标准基线语义的复用。Session 序号排序不确立复用 Session id 之间的身份关系。

Manager 测试覆盖成员推送、过时初始响应、按需加载、状态组合、完成元数据保留、重试、空目录移除、晚到的 create/fork 响应与重连取消。Host 测试覆盖共享 control stream 与冷 observation。持久化子代理 Web 场景通过发布应用验证嵌套历史导航与续传。

[会话独立迁移决策](../bug-fix/2026-09-19-session-local-subagent-migration.zh.md)取代运行时子正文收集与未打开分支投影读取；可选离线补全和持久化 catalog 语义仍有效。
