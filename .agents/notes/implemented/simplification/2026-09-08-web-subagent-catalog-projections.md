# Agent Note: Web subagent catalogs consume shared projections

Status: implemented

English | [中文](2026-09-08-web-subagent-catalog-projections.zh.md)

## Problem

The parent catalog projection already publishes complete membership through the Session control stream. A separate catalog-change event, repeated RPC reads, and a second membership cache duplicate that delivery and require coordination between responses and later events. Historical Sessions still need initial loading when their projection is absent, and parent Agent availability remains independent of durable membership.

## Decision

The Client retains catalog membership only in its standard per-Session projection store. Initial `session.projections` reads return a complete projection baseline from one live-preferred Session observation. The endpoint accepts any Session id and has no catalog-specific dependency or validation. The same observation supplies the values and sequence cursor. Initial baselines and live control frames use the store's existing sequence ordering, so an older response cannot replace a newer value. The endpoint does not activate an Agent or sample child activity. Opening a conversation uses its follow baseline without scheduling a second projection read; unopened branches use header relationships from the Session list instead of requesting child projections. Missing historical catalog entries remain non-durable unresolved navigation rows until the child is opened.

Feature consumers select `subagentCatalog` from `projectionsBySession`, supplement missing rows from parent-linked subagent summaries, and derive activity from Session-list baselines and status events. Header-discovered rows carry unresolved mode and grant no continuation authority. Menu and branch refreshes update only the lightweight Session list. Opening the selected child validates its descriptor and parent and resolves the mode; a failed open stays local to that child. Existing projection ordering, generic explicit projection reads, and independent parent availability remain unchanged.

The [parent-catalog decision](../architecture/2026-09-01-parent-owned-subagent-catalog.md) owns durable creation facts and ordering. This decision supersedes the dedicated membership-refresh mechanism in [Web subagent conversations](../feature/2026-07-27-web-subagent-conversations.md); that note remains active for navigation, control, and presentation decisions.

Host summaries replace running and availability state; local create/fork placeholders only enrich missing metadata. Sharing overwrite behavior would let a late local response erase a newer Host state and generate a false completion reminder. Removed ordinary Sessions retain stores only for nonempty child catalogs; empty catalogs carry no navigation that needs to survive removal. Breadcrumb selectors derive addresses from the Session-list snapshot so their subscriptions cover every dependency.

## Alternatives considered

**Keep notification-driven reads.** Rejected because the shared stream already delivers the changed value. Menu subscriptions, response-local activity replay, and trailing membership reads add no required delivery capability.

**Remove the initial-read endpoint.** Deferred. Session-list projections are cache hints and may be absent; following a conversation also transfers history and retains observation state. A lightweight read preserves historical catalog access without establishing a conversation follow stream. Parent availability is a live delivery hint, not a durable projection fact.

## Consequences

Membership changes use the existing control stream without extra catalog notifications or reads. Whole-value projection publication still costs O(D) for D children; this change does not introduce delta transport. Initial reads return the observation's complete projection baseline, including values beyond the catalog, so they reuse standard baseline semantics at the cost of that additional initial payload. Session sequence ordering does not establish identity across reused Session ids.

Manager tests cover pushed membership, stale initial responses, lazy loading, status composition, retained completion metadata, retry, removal of empty catalogs, late create/fork responses, and reconnect cancellation. Host tests exercise the shared control stream and cold observations. The persisted-subagent Web scenario covers nested historical navigation and continuation through the shipped application.

The [Session-local migration decision](../bug-fix/2026-09-19-session-local-subagent-migration.md) supersedes runtime child-body collection and unopened-branch projection reads; optional offline completion and durable catalog semantics remain active.
