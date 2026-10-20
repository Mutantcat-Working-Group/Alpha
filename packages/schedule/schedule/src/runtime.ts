/** Host timer over stored tasks; Session activation is a delivery operation. */
import { createUserMessage } from '@mutantcat/dsh-llm'
import type { ContextFormed } from '@mutantcat/dsh-llm'
declare module '@mutantcat/dsh-llm' {
  interface MessageSourceMap {
    'schedule': { kind: 'schedule' } & ContextFormed
  }
}
import type { Context } from '@mutantcat/cordis'
import type {} from '@mutantcat/dsh-api-session-controller'
import { isRecurringScheduleRecord, renderReminderFraming, renderRecurringReminderBatchFraming, resolveRecurringOccurrence } from './domain.ts'
import type { DeliveryRetentionBounds, RecurringScheduleRecord } from './types.ts'
import type { ScheduleTask } from './storage.ts'
import { appendDelivery } from './delivery-history.ts'

import type { Context } from '@mutantcat/cordis'
import type { Agent } from '@mutantcat/dsh-agent'
import { createUserMessage } from '@mutantcat/dsh-llm'
import type { ContextFormed } from '@mutantcat/dsh-llm'
declare module '@mutantcat/dsh-llm' {
  interface MessageSourceMap {
    'schedule': { kind: 'schedule' } & ContextFormed
  }
}

import type { EveryScheduleRecord, OneShotScheduleRecord } from './types.ts'
import {
  foldScheduleEvents,
  renderEveryReminderBatchFraming,
  renderReminderFraming,
  resolveEveryOccurrence,
  ScheduleLogError,
} from './domain.ts'
import type { FoldedSchedules } from './domain.ts'
import { flushSchedulePersistence } from './persistence.ts'
import { runScheduleTransaction } from './transaction.ts'

/** Largest delay that Node timers represent without clamping. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Owns at most one timer across recomputations; delivery and management share the serialized operation. */
export class ScheduleRuntime {
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<void> | undefined
  private stopping = false
  private requested = false

  /**
   * @param ctx - Host services used to resume and enqueue.
   * @param tasks - Current durable tasks.
   * @param transact - Serialize delivery against management writes.
   * @param commit - Persist task status, target, receipt, and history together after durable inbox delivery.
   */
  constructor(
    private readonly ctx: Context,
    private readonly tasks: () => readonly ScheduleTask[],
    private readonly transact: (work: () => Promise<void>) => Promise<void>,
    private readonly commit: (task: ScheduleTask) => Promise<void>,
    private readonly retention: DeliveryRetentionBounds,
  ) {}

  /**
   * Recompute the nearest obligation after startup or a durable change.
   * Dispatch failures are logged; refused admission does not retry automatically.
   */
  requestDrive(): void {
    if (this.stopping) return
    this.requested = true
    this.clearTimer()
    if (this.running !== undefined) return
    let run: Promise<void>
    try {
      run = this.ctx.agents.withoutInitiator(async () => {
        while (this.requested && !this.stopping) {
          this.requested = false
          await this.transact(async () => { await this.drive() })
        }
      })
    } catch (error: unknown) {
      // Ancestor unloading closes initiator admission before runtime cleanup runs.
      this.requested = false
      this.ctx.logger.warn(`schedule: dispatch stopped: ${String(error)}`)
      return
    }
    this.running = run
    void run.catch((error: unknown) => {
      this.ctx.logger.warn(`schedule: dispatch stopped: ${String(error)}`)
    }).finally(() => {
      this.running = undefined
      if (this.requested && !this.stopping) this.requestDrive()
    })
  }

  /** Stop the timer and drain an accepted delivery before storage closes. */
  async dispose(): Promise<void> {
    this.stopping = true
    this.clearTimer()
    // requestDrive reports execution failures; teardown only waits for quiescence.
    await this.running?.catch(() => undefined)
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private async drive(): Promise<void> {
    this.clearTimer()
    if (!this.isRunnable()) return
    try {
      await flushSchedulePersistence(this.ctx, this.agent.session)
    } catch (error: unknown) {
      if (this.isLive()) {
        this.ctx.logger.warn(`schedule: preflight failed for agent "${this.agent.id}": ${renderThrown(error)}`)
      }
      return
    }
    if (!this.isRunnable()) return

    const folded = this.readFolded()
    if (folded === undefined) return
    const wakeNow = Date.now()
    const wakeDecision = this.decide(folded, wakeNow)
    if (wakeDecision === undefined) return
    if (wakeDecision.kind === 'wait') {
      if (wakeDecision.target !== undefined) this.arm(wakeDecision.target, wakeNow)
      return
    }

    let maintenance: Promise<boolean>
    try {
      maintenance = this.agent.runMaintenance(() => {
        if (!this.isRunnable()) return Promise.resolve(false)
        const claimed = this.readFolded()
        if (claimed === undefined) return Promise.resolve(false)
        const decisionNow = Date.now()
        const decision = this.decide(claimed, decisionNow)
        if (decision === undefined) return Promise.resolve(false)
        if (decision.kind === 'wait') {
          if (decision.target !== undefined) this.arm(decision.target, decisionNow)
          return Promise.resolve(false)
        }
        try {
          const text = decision.kind === 'one-shot'
            ? renderReminderFraming(decision.record)
            : renderEveryReminderBatchFraming(decision.reminders)
          const message = createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: 'schedule' },
          })
          committed.add(task.record.id)
        }
        for (const { task: member, occurrence } of occurrences) {
          await this.commit({
            ...member,
            record: { ...member.record, scheduledAt: occurrence.nextScheduledAt ?? occurrence.occurrenceAt },
            status: occurrence.nextScheduledAt === undefined ? 'inactive' : 'active',
            ...appendDelivery(member, { scheduledAt: occurrence.occurrenceAt, deliveredAt, messageId: message.id }, this.retention),
          })
          committed.add(member.record.id)
        }
      } catch (error: unknown) {
        // Successful commits and targets made future by clock rollback keep their timer obligation.
        const pending = admitted.filter(member => !committed.has(member.record.id))
        const failedAt = Date.now()
        for (const member of pending) {
          if (Date.parse(member.record.scheduledAt) <= failedAt) failed.add(member.record.id)
        }
        const ids = pending.map(member => member.record.id)
        this.ctx.logger.warn(`schedule: reminders ${JSON.stringify(ids)} were not acknowledged: ${String(error)}`)
      }
    }
    if (this.stopping) return
    const next = this.tasks().filter(task => task.status === 'active' && !failed.has(task.record.id))
      .reduce<number | undefined>((at, task) => {
        const target = Date.parse(task.record.scheduledAt)
        return at === undefined ? target : Math.min(at, target)
      }, undefined)
    if (next !== undefined) {
      this.timer = setTimeout(() => { this.timer = undefined; this.requestDrive() },
        Math.max(0, Math.min(next - Date.now(), MAX_TIMER_DELAY_MS)))
      this.timer.unref()
    }
  }
}
