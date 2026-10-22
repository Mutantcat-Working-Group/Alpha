# Agent Note: Cooperative turn pause and resume

Status: implemented

English | [中文](2026-10-22-cooperative-turn-pause-resume.zh.md)

## Problem

A user watching a long agent turn may want to stop it mid-execution and continue later from the same point, without losing the work already done. The existing controls do not fit that intent. `cancel()` aborts the whole turn, settling it as cancelled and discarding the driver; restarting means a new turn whose request reassembles from the log. `interruptModelStep()` cuts only the in-flight provider wait and immediately admits the next step, so it stops one provider call but does not stop the turn — the loop keeps working.

A pause control therefore needs a distinct lifecycle: hold the turn open between steps, let the user inspect state, and continue from exactly where it stopped. The pause is a live interaction, not a durable one: a relaunched process has no parked driver to resume, so the mechanism is process-local and must fail loud rather than pretend durability.

## Decision

`Agent.pause()` and `Agent.resume()` park and release a running turn between steps. The phase union grows a third member, `paused`, reported through `agent/status` and mirrored on the client as a `paused` bit beside `running`. A parked turn is a `running` turn held between steps; it is not a fourth observable status and never persists.

### Pause cuts the in-flight step and holds the turn open

`pause()` requires a `running` turn. It calls `interruptModelStep()` to cut the in-flight provider wait so the park takes effect now — a step already running tools parks at its next boundary. The delivered prefix settles as an interrupted assistant message, exactly as an interrupt does, so the log carries the partial work once. The driver then parks on a promise between steps instead of admitting the next one; the turn stays open. `pause()` outside a running turn or while already paused is a no-op.

### Resume continues from the pause point with no new vocabulary

`resume()` requires a `paused` turn and resolves the park. The loop resumes between steps, and the next step reassembles its request from the log up to the pause point — the same reconstruction a cancelled-and-restarted turn performs. Because the prefix was settled as an ordinary interrupted assistant message, resume introduces no new session event, no durable vocabulary change, and no log duplication. Queued input sent while parked is claimed by the resumed step, since the wake driver latches while the turn is not aborted.

### Cancel and disposal wake the park

`cancel()` resolves the pause gate and aborts the turn signal, so a parked turn ends as cancelled rather than deadlocking on the park promise. Disposal follows the same path. `whenIdle()` is not special-cased: it already follows the driver to quiescence, and a parked driver is still an active driver.

### Host commands and client state

`SessionCommandController.pause()` and `resume()` drive one live ordinary Agent between the states, rejecting an absent Session (`session/not-found`), a subagent-owned Session (`agent-busy`), a pause outside `running` (`session/not-running`), and a resume outside `paused` (`session/not-paused`). The `api-session/status` event carries the tri-state status through; the client maps `paused` to `running=false, paused=true`, so a parked composer is never rendered as running.

### Web control

The composer keeps its Stop seat unchanged for a running ordinary session with an empty or blocked draft. A running ordinary session gains a secondary Pause button; a paused ordinary session with an empty or blocked draft makes the primary button Resume. Subagent composers keep their existing independent Stop button and expose no Pause.

## Verification

[`pause-resume.spec.ts`](../../../../packages/core/agent-loop/tests/pause-resume.spec.ts) proves the no-op outside a running turn, the park-and-continue round trip, request reassembly from the log up to the pause point, queued-input delivery on resume, the second-pause no-op, and cancel-while-parked ending the turn aborted. [`commands-pause-resume.host.spec.ts`](../../../../packages/api/session-controller/tests/commands-pause-resume.host.spec.ts) proves every accepted and rejected host command, including absent and subagent-owned Sessions. [`manager.client.spec.ts`](../../../../packages/api/session-controller/tests/manager.client.spec.ts) pins the tri-state status onto the running and paused bits. [`input-bar.client.spec.tsx`](../../../../packages/client/ui-conversation/tests/input-bar.client.spec.tsx) proves the Pause button on a running composer and the Resume primary on a paused one, and that a paused composer exposes no Pause.

## Alternatives considered

**Pause as `interruptModelStep()`.** Rejected: cutting the step and admitting the next one immediately does not stop the turn, so it cannot hold execution for the user to inspect and continue.

**Pause as `cancel()`.** Rejected: aborting the turn settles it as cancelled and releases the driver; continuing means a new turn, which loses the "resume from the pause point" contract and duplicates the cancel control.

**A durable `paused` status with a session event.** Rejected: the park is process-local and dies on relaunch. Persisting it would add a durable event and a vocabulary change for a state that cannot survive the process, and a restored session would still need the interrupted-turn path.

**Auto-resume parked input.** Rejected: an auto-resume would make the pause look ignored and steal the user's window to redirect, the same fault the [continuable subagent interrupt](../feature/2026-08-06-continuable-subagent-interrupt.md) avoids by parking the queue until an explicit waking send.

## Consequences

- The `Agent` interface grows `pause()` and `resume()`; every implementer and test stub supplies them.
- `AgentStatus` gains `paused`; the host and client status paths carry the tri-state through, and the client maps it to `running=false, paused=true`.
- A parked turn that outlives its process becomes interrupted on reload, consistent with the process-local scope; no durable state claims otherwise.
- Pause and resume are ordinary-session controls; subagent-owned Sessions reject them with `agent-busy`, matching the existing interrupt authority boundary.
