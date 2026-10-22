# Agent Note：协作式轮次暂停与继续

Status: implemented

[English](2026-10-22-cooperative-turn-pause-resume.md) | 中文

## 问题

用户在观察一个较长的 agent 轮次时，可能希望在执行中途停下，稍后从同一点继续，而不丢失已完成的工作。现有控件都不符合这一意图。`cancel()` 会中止整个轮次，将其结算为已取消并释放 driver；重启意味着开启一个新轮次，其请求从日志重建。`interruptModelStep()` 只切断在途的 provider 等待并立即放行下一步，因此它停掉的是单次 provider 调用，而不是轮次——循环仍在继续。

因此，暂停控件需要一种独立的生命周期：把轮次在步骤之间保持打开，让用户检查状态，并从恰好停止的位置继续。暂停是一次实时交互，而非持久交互：重启后的进程没有可恢复的 park driver，所以该机制是进程本地的，必须显式失败，而不能伪装成持久状态。

## 决策

`Agent.pause()` 与 `Agent.resume()` 在步骤之间停放和释放一个运行中的轮次。阶段联合新增第三个成员 `paused`，通过 `agent/status` 上报，并在客户端镜像为 `running` 旁的 `paused` 位。被停放的轮次是一个在步骤之间保持打开的 `running` 轮次；它不是第四种可观察状态，也永不持久化。

### 暂停切断在途步骤并保持轮次打开

`pause()` 要求一个 `running` 轮次。它调用 `interruptModelStep()` 切断在途的 provider 等待，使停放立即生效——已在运行工具的步骤在其下一个边界处停放。已投递的前缀作为一条被打断的 assistant 消息结算，与 interrupt 完全一致，因此日志只携带一次部分工作。随后 driver 停放在步骤之间的一个 promise 上，而不放行下一步；轮次保持打开。在 `running` 轮次之外或已处于暂停时调用 `pause()` 均为无操作。

### 从暂停点继续，且不引入新词汇

`resume()` 要求一个 `paused` 轮次，并 resolve 该停放 promise。循环在步骤之间恢复，下一步从暂停点之前的日志重新组装其请求——与「取消后重启」的轮次所做的重建相同。由于前缀已作为普通的被打断 assistant 消息结算，继续不引入任何新的会话事件、持久词汇变化或日志重复。停放期间排队的输入会被恢复后的步骤认领，因为唤醒 driver 在轮次未被中止时会锁存。

### Cancel 与 dispose 唤醒停放

`cancel()` 会 resolve 暂停门并中止轮次信号，因此被停放的轮次会以已取消结束，而不会在停放 promise 上死锁。dispose 走同一路径。`whenIdle()` 不做特殊处理：它本来就跟随 driver 到静止，而被停放的 driver 仍是活跃 driver。

### 宿主命令与客户端状态

`SessionCommandController.pause()` 与 `resume()` 驱动一个实时普通 Agent 在各状态间转换，拒绝缺失的 Session（`session/not-found`）、子 agent 拥有的 Session（`agent-busy`）、`running` 之外的暂停（`session/not-running`）以及 `paused` 之外的继续（`session/not-paused`）。`api-session/status` 事件透传三态状态；客户端把 `paused` 映射为 `running=false, paused=true`，因此被停放的 composer 绝不会渲染为运行中。停放位同时作为 `running` 旁的 `paused` 位随 Session 列表传递，因为停放由事件建立，而列表是重连客户端唯一收到的基线；缺少它，一次重载就会把已停放的轮次读成空闲，并把它仍在运行的工作搁在那里。

### Web 控件

对于带有空草稿或受阻草稿的运行中普通 Session，composer 保留其 Stop 座位。运行中的普通 Session 新增一个次要的「暂停」按钮；带有空草稿或受阻草稿的已暂停普通 Session 把主按钮变为「继续」并获得自己的 Stop 座位，因为已经在运行工具的步骤在轮次停放期间继续执行。子 agent 的 composer 保留其现有的独立 Stop 按钮，不暴露「暂停」。

### 工作区行

已停放的 Session 显示 `paused` 状态点——停放于单一亮度的进行中圆环——并带本地化的「已暂停」标签。这个静止圆环读作活跃，但不声称工作正在推进，并且与进行中圆点一样压过「已完成但未查看」提醒。

## 验证

[`pause-resume.spec.ts`](../../../../packages/core/agent-loop/tests/pause-resume.spec.ts) 证明 `running` 轮次之外的无操作、停放—继续的完整往返、从暂停点之前的日志重新组装请求、恢复时排队输入的投递、第二次暂停的无操作，以及停放中 cancel 使轮次以已中止结束。[`commands-pause-resume.host.spec.ts`](../../../../packages/api/session-controller/tests/commands-pause-resume.host.spec.ts) 证明每一条被接受与被拒绝的宿主命令，包括缺失与子 agent 拥有的 Session。[`manager.client.spec.ts`](../../../../packages/api/session-controller/tests/manager.client.spec.ts) 固定三态状态到 running 与 paused 位的映射。[`input-bar.client.spec.tsx`](../../../../packages/client/ui-conversation/tests/input-bar.client.spec.tsx) 证明运行中 composer 上的「暂停」按钮、已暂停 composer 上的「继续」主按钮、该「继续」主按钮旁的 Stop 座位，以及已暂停的 composer 不暴露「暂停」。[`ui-session.client.spec.ts`](../../../../packages/client/ui-session/tests/ui-session.client.spec.ts) 证明停放在 running→paused→running→idle 的流转后依然保留，并从列表基线播种，因此重连绝不会把已停放的轮次读成空闲。[`rows.client.spec.tsx`](../../../../packages/client/ui-workspace/tests/rows.client.spec.tsx) 证明已暂停的行显示静止圆环而非空闲圆点，并且仍然压过「已完成但未查看」提醒。[`state-dot.client.spec.tsx`](../../../../packages/client/ui-primitives/tests/state-dot.client.spec.tsx) 与 [`state-dot-styles.client.spec.ts`](../../../../packages/client/ui-primitives/tests/state-dot-styles.client.spec.ts) 证明 paused 圆环渲染八个单元格、没有逐单元格相位，也没有实心圆点规则。

## 考虑过的替代方案

**把暂停当作 `interruptModelStep()`。** 拒绝：切断步骤并立即放行下一步并不会停止轮次，因此无法为用户检查与继续而保持执行。

**把暂停当作 `cancel()`。** 拒绝：中止轮次会将其结算为已取消并释放 driver；继续意味着开启一个新轮次，这丢失了「从暂停点继续」的约定，并且与 cancel 控件重复。

**带会话事件的持久 `paused` 状态。** 拒绝：停放是进程本地的，重启即消亡。为它持久化会为一个无法在进程外存活的状态增加持久事件与词汇变化，而恢复的会话仍然需要被打断轮次的路径。

**自动恢复停放中的输入。** 拒绝：自动恢复会让暂停看起来被忽略，并夺走用户重定向的窗口，这与[可续子 agent 中断](../feature/2026-08-06-continuable-subagent-interrupt.zh.md)通过把队列停放至显式唤醒 send 来避免的正是同一故障。

## 后果

- `Agent` 接口新增 `pause()` 与 `resume()`；每个实现方与测试桩都提供它们。
- `AgentStatus` 新增 `paused`；宿主与客户端状态路径透传三态，客户端将其映射为 `running=false, paused=true`。
- 存活超过其进程的停放轮次在重新加载时变为被打断的轮次，与进程本地范围一致；没有任何持久状态另有主张。
- 暂停与继续是普通 Session 的控件；子 agent 拥有的 Session 以 `agent-busy` 拒绝它们，与既有的中断权限边界一致。
