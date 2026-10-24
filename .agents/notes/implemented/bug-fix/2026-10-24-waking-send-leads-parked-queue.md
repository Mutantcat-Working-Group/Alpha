# Agent Note: A waking send after a terminated turn leads the parked queue

Status: implemented

English | [中文](2026-10-24-waking-send-leads-parked-queue.zh.md)

## Problem

`Agent.cancel(cause, { keepInbox: true })` stops the live turn and parks its unclaimed follow-ups at idle, and the only way to resume that parked work is an explicit waking send ([continuable subagent interrupt](../feature/2026-08-06-continuable-subagent-interrupt.md)). That waking send appended behind the parked messages, so the prompt a user typed right after pressing stop ran last, after every stale message the aborted turn had already queued. A human redirecting a runaway turn had to watch the old work finish before the new instruction took effect. The [wake-latch decision](2026-08-07-cancel-convergence-wake-latch.md) already governs a waking send that lands inside the abort-to-idle window; this note governs the send that lands after the driver has settled at idle.

## Decision

`ReactLoopAgent` carries a private `leftoverQueueLeads` flag. It is recomputed at the driver's own convergence boundary — inside `kick()`'s `finally`, while the phase is still `running` — as `terminated && inbox.nextTurn.length > 0`, where `terminated` is `phase.abort.signal.aborted`. The recompute runs after `setPhase({ kind: 'idle' })`, so the flag never outlives the idle episode that set it. `followup()` reads the phase before it touches the inbox — a splice observer can reenter `cancel()`, which would clear the queue the decision was taken from — and when the phase is `idle` and the flag is set it calls `inbox.prepend('next-turn', input)` and `wakeDriver()` instead of appending. The parked messages keep their relative order; the waking send moves to the front once. `steer()` is unchanged, and a follow-up behind a live or still-parked turn, or after a turn that ended on its own, still appends.

The `signal.aborted` discriminator is load-bearing rather than a convenience. A turn that ended on its own — completed, blocked, or failed — converges to idle with its queue intact and must keep arrival order; only an aborted turn parks work the user has explicitly redirected away from. Because `inbox.claim('next-turn', turn)` takes exactly the head of `next-turn`, a broad `idle && nextTurn.length > 0` criterion would lead a waking send ahead of a message a blocked turn left parked, changing which message a resumed driver claims first.

The `user/message` session event is appended when a message is claimed, not when it is enqueued, so the recorded order in a session log and its golden reflects execution order; the tests assert on that order.

## Alternatives considered

**Lead on any idle episode that still has queued work (`idle && nextTurn.length > 0`).** Rejected: a pre-step `reject` converges the turn to idle with reason `blocked` while `next-turn` still holds the adjacent message (`packages/core/agent-loop/tests/interception.spec.ts`). Leading a later waking send ahead of that parked message makes the resumed driver claim the wake first, breaking the assertion that the first request is still the parked message.

**Reorder the parked queue inside `cancel()`.** Rejected: the driver is still unwinding when `cancel()` returns, so the parked set is not final until the convergence boundary; the flag is only trustworthy there.

**Rotate or reverse the parked messages.** Rejected: the requirement is that the parked messages keep their original relative order; only the waking send moves.

**Teach the client to raise the waking send's priority.** Rejected: `inbox.raise()` and `steer()` already exist as explicit reordering tools, but the requirement is that a plain follow-up after a stop leads automatically, without asking the user to reach for a second control.

## Consequences

A follow-up sent after a terminated turn leads the parked queue, which keeps its relative order; a follow-up sent behind a live or still-parked turn, or after a turn that ended on its own, still appends. The continuable-subagent interrupt path is a `keepInbox` cancel, so a waking send after an interrupt now leads the parked follow-ups instead of resuming FIFO behind them, and that note's ordering claims are updated to match. A waking send that lands inside the abort-to-idle window still rides the existing `wakeRequested` latch and is replayed at convergence, where it appends behind the parked work; closing that residual ordering gap is outside this change. The flag is private to `ReactLoopAgent` and adds no public surface.

## Testing

`packages/core/agent-loop/tests/cancel.spec.ts` covers a follow-up that leads a single parked message and a follow-up that leads two parked messages without reordering them. `packages/subagent/subagent/tests/continuation.spec.ts` covers the continuable-child interrupt leading the parked queue. The keyless Web scenarios `apps/web/tests/subagent-interrupt.e2e.ts`, `subagent-interrupt-ui.e2e.ts`, `queue-actions.e2e.ts`, and `queue-image.e2e.ts` assert the waking send ahead of the parked items end to end, with the `queued-image` goldens refreshed to the waking-then-parked order.
