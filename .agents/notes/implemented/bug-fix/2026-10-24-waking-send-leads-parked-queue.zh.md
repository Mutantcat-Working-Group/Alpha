# Agent Note: 轮次被终止后，唤醒发送领先被暂停的队列

Status: implemented

[English](2026-10-24-waking-send-leads-parked-queue.md) | 中文

## 问题

`Agent.cancel(cause, { keepInbox: true })` 会停止当前轮次，并把它尚未领取的后续消息停在 idle，而恢复这批被暂停工作的唯一方式是一次显式唤醒发送（[continuable subagent 中断](../feature/2026-08-06-continuable-subagent-interrupt.zh.md)）。那次唤醒发送此前追加在被暂停消息之后，于是用户按下停止后立刻输入的新提示会排在最后，落在那条已中止轮次早已排队的每一条过期消息之后。用户想要纠正一个失控轮次时，只能先看着旧工作跑完，新指令才生效。[唤醒锁存决策](2026-08-07-cancel-convergence-wake-latch.zh.md)已经覆盖了落在 abort 到 idle 窗口内的唤醒发送；本 note 覆盖的是 driver 已经收敛到 idle 之后才到达的那次发送。

## 决策

`ReactLoopAgent` 带一个私有 `leftoverQueueLeads` 标志。它在 driver 自身的收敛边界——`kick()` 的 `finally` 内、phase 仍为 `running` 时——按 `terminated && inbox.nextTurn.length > 0` 重算，其中 `terminated` 是 `phase.abort.signal.aborted`。重算发生在 `setPhase({ kind: 'idle' })` 之后，因此该标志绝不会比设置它的那个 idle 片段活得更久。`followup()` 先读 phase 再触碰 inbox——splice observer 可能重入 `cancel()`，从而清空刚才据以判断的队列——当 phase 为 `idle` 且该标志已置位时，它调用 `inbox.prepend('next-turn', input)` 和 `wakeDriver()`，而不是追加。被暂停的消息保持彼此的相对顺序；唤醒发送只前移到最前一次。`steer()` 不变；在一个在线或仍被暂停的轮次之后、或在一个自行结束的轮次之后发送的后续消息，仍旧追加。

`signal.aborted` 判别位是承重的，不是图方便。自行结束的轮次——completed、blocked 或 failed——会带着完好无损的队列收敛到 idle，必须保持到达顺序；只有被中止的轮次才会把用户已明确要改向的工作停下来。由于 `inbox.claim('next-turn', turn)` 只取 `next-turn` 的头部，一个宽松的 `idle && nextTurn.length > 0` 判据会让唤醒发送领先于 blocked 轮次留下的那条消息，改变被恢复的 driver 首先领取哪条消息。

`user/message` 会话事件是在消息被领取时追加的，不是入队时，因此会话日志及其 golden 里记录的顺序反映的是执行顺序；各项测试正是对这个顺序断言。

## 曾考虑的替代方案

**只要 idle 片段仍有排队工作就领先（`idle && nextTurn.length > 0`）。** 拒绝：pre-step `reject` 会让轮次以 `blocked` 原因收敛到 idle，而 `next-turn` 仍保留着相邻消息（`packages/core/agent-loop/tests/interception.spec.ts`）。让随后的唤醒发送领先于那条被暂停消息，会使被恢复的 driver 首先领取唤醒，从而打破“第一个请求仍是那条被暂停消息”的断言。

**在 `cancel()` 内部重排被暂停的队列。** 拒绝：`cancel()` 返回时 driver 仍在收尾，被暂停的集合要到收敛边界才最终确定；该标志只有在那里才可信。

**轮转或反转被暂停的消息。** 拒绝：需求是被暂停消息保持原有相对顺序；只有唤醒发送移动。

**教客户端去提升唤醒发送的优先级。** 拒绝：`inbox.raise()` 与 `steer()` 本就作为显式重排工具存在，但需求是停止后的普通后续消息自动领先，而不是要求用户再去够第二个控件。

## 后果

轮次被终止后发送的后续消息领先被暂停的队列，而被暂停的队列保持其相对顺序；在一个在线或仍被暂停的轮次之后、或在一个自行结束的轮次之后发送的后续消息，仍旧追加。continuable subagent 中断路径是一次 `keepInbox` 取消，因此中断后的唤醒发送现在领先被暂停的后续消息，而不是在它们之后按 FIFO 恢复；那条 note 的顺序表述已同步更新。落在 abort 到 idle 窗口内的唤醒发送仍旧搭乘既有的 `wakeRequested` 锁存，并在收敛时重放，届时它追加在被暂停工作之后；弥合这处残余的顺序差异不在本次改动范围内。该标志是 `ReactLoopAgent` 的私有成员，不增加任何公共表面。

## 测试

`packages/core/agent-loop/tests/cancel.spec.ts` 覆盖了领先单条被暂停消息的后续消息，以及领先两条被暂停消息而不打乱其顺序的后续消息。`packages/subagent/subagent/tests/continuation.spec.ts` 覆盖了 continuable child 中断领先被暂停的队列。keyless Web 场景 `apps/web/tests/subagent-interrupt.e2e.ts`、`subagent-interrupt-ui.e2e.ts`、`queue-actions.e2e.ts` 和 `queue-image.e2e.ts` 端到端断言唤醒发送领先被暂停项，并把 `queued-image` 的 golden 刷新为唤醒在先、被暂停在后的顺序。
