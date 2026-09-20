---
description: "Subagent conversation catalog, continuation routing UI, and '@' reference source for the alpha web client."
kind: "package-reference"
---

# @mutantcat/dsh-client-ui-subagent

English | [中文](README.zh.md)

## Summary

Browse local subagent conversations and external tasks from the parent header. Local conversations show activity, token usage, and duration; continuable children accept follow-up prompts and support Stop. External tasks appear as non-navigable leaves without an execution status. Historical one-shot conversations open as read-only records. The ordinary sidebar omits subagent conversations, and the separate `@` source inserts a running child's label without granting continuation authority.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The session header keeps the current session title as the lineage breadcrumb and appends a `/` count trigger when its direct catalog has entries or a read has failed. An absent catalog, an empty loading catalog, or a successfully loaded empty catalog hides the count trigger. The trigger opens that direct catalog, reports its total and running counts, and loads nested catalogs only when their rows expand. Select any depth to open that child's conversation with its exact `{parentSessionId, childSessionId, mode}` address, or use the row's trailing arrow to open the same address in the right Sidebar, preferring a separate pane when room permits.

This package registers the `dsh-resource://subagentchat/session/<child>?parent=<parent>&mode=<mode>` resource and builtin Sidebar tab type. The resource refreshes the direct-parent catalog before it retains the child `SessionReference`, and releases the reference when the tab record closes. The tab renders the shared `conversation.content` Factory through `sidebar.chat.conversation`, fixes the local View to Chat, and omits the main Conversation header and width controls.

### Browsing the tree

Rows display mode plus activity and an optional log-backed title; running uses the shared ongoing loader, an inactive child whose latest closed turn completed normally uses the shared success dot, and other inactive children use the shared idle dot. Every row reserves the same 14px status column, centering smaller dots so titles align with the loader state. The compact header trigger vertically centers its activity glyph and count with a 4px gap. The trailing column stacks total durable provider usage above active-turn duration. Keyboard navigation works with ArrowRight/ArrowLeft to expand and collapse branches and ArrowUp/ArrowDown, Home, End, and Escape to navigate or close the tree. An unlabeled one-shot row falls back to its session id. A row is a known leaf only after its own catalog loads empty.

### Continuing a conversation

A continuable child with a live parent keeps the ordinary input chrome: typing and Send stay available while the child runs because every follow-up joins the child's FIFO inbox, and an independent Stop routes through `subagents/interruptByParent`. A continuable child whose exact parent is unavailable and which is not running elects a read-only composer explaining the recovery path; while such a child still runs, the selector yields to the ordinary composer with input and Send disabled but its independent Stop usable.

### The `@` reference source

The `@` source remains deliberately separate and inert: candidates are zero-RPC running children from `ctx.sessions.list`, picking one inserts literal `@label ` text, and the codec projects `@label`. It has no command-adjudication hooks and does not resolve labels into continuation addresses.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The catalog and composer behavior are specified by the [Web subagent conversations note](../../../.agents/notes/implemented/feature/2026-07-27-web-subagent-conversations.md) and the [current-turn interrupt note](../../../.agents/notes/implemented/feature/2026-08-06-continuable-subagent-interrupt.md).

### Catalog derivation

The header lineage renderer reads `subagentsByParent` and session summaries through the standard `useSessions` hook. The compact tree remains direct-catalog authoritative: each healthy row's `hasChildren` hint determines disclosure before interaction, a catalog level reserves the disclosure column only when at least one healthy row is a branch, and expanding a branch immediately reserves one disabled loading row per known direct descendant before lazily replacing them with that child's authoritative catalog. Every visible branch is reported to the runtime so membership frames cause a debounced refresh only where the tree is being consumed.

### Duration and tokens

Token totals sum the four disjoint `tokenUsage` buckets. Duration sums completed `subagentTiming` turns, advances once per second only for an open turn on a running child, and freezes after the child becomes inactive; an interrupted open turn is bounded by its same-cut `active.through`, never by newer session metadata.

### Composer election

One-shot children always elect a read-only composer. A continuable child elects one only when its exact parent is unavailable and the child is not running; otherwise the ordinary composer's Session routes prompts through `subagents/prompt`. This package never receives host context or calls a model-facing tool.

Unknown-mode catalog rows remain visible and clickable, using the child id when no label is available. Their composer is read-only until child history establishes a supported mode; a read failure is reported in the child conversation.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the conversation surface, the host seam, and the design notes.

- [ui-conversation](../ui-conversation/README.md) — the chat surface hosting the header action and composer chain.
- [ui-input-trigger](../ui-input-trigger/README.md) — the suggestion machinery hosting the `@` source.
- [subagent](../../subagent/subagent/README.md) — the host-side capability seam behind continuable children.
- [Web subagent conversations](../../../.agents/notes/implemented/feature/2026-07-27-web-subagent-conversations.md) — the catalog and composer specification.
- [Current-turn interrupt](../../../.agents/notes/implemented/feature/2026-08-06-continuable-subagent-interrupt.md) — the independent Stop semantics.

-----

<a id="model-experience"></a>
## Model Experience

### Subagent label text in the user prompt

#### What the model sees

Only the `@` reference source affects model input: a picked candidate reaches the ordinary user message as literal `@label`, without a dedicated block or host-side resolution. Catalog browsing, child navigation, and persisted transcript viewing add no prompt section; accepted continuation content becomes a normal FIFO user message through the host subagent adapter.

#### Token effect

Conditional and append-only: the literal `@label` or a human follow-up adds tokens only to its new user message. Catalog and transcript operations add zero model tokens.

#### KV Cache effect

Append-only. This package never edits earlier request tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the catalog can show and what `@` references mean; they are current package constraints.

- **The catalog has no durable outcome** — activity and timing do not distinguish completion, failure, or cancellation, and the UI exposes no Activation identity; stopping is limited to the composer's current-turn Stop for a running continuable child.
- **`@` references remain display-title text** — duplicate or renamed labels are ambiguous, so they intentionally do not acquire continuation semantics.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The plugin registers a single slash source whose disposal is proven by the HMR-safety spec; it emits no Cordis events and owns no cross-plugin mutable state.
