# Agent Note: Migrate each Session independently of its children

Status: implemented

English | [中文](2026-09-19-session-local-subagent-migration.zh.md)

## Problem

Runtime V3→V4 preparation collected every direct child's descriptor to complete the parent catalog. This decoded whole child logs before opening the parent, and unrelated unreadable headers could prevent complete membership classification. A corrupt child therefore blocked valid parent history. Historical revisions also fingerprinted the entire root, invalidating a parent's cached preparation when unrelated files changed.

## Decision

JSONL migrates only the Session explicitly opened by a reader or writer. It preserves existing catalog facts and does not read child bodies or collect cross-session evidence. Read opens prepare current logical events without publishing; write opens validate the selected source and exclusively publish its immutable successor. Public revisions and preparation reuse depend only on the selected file. Predecessor generations remain byte-identical.

Discovery combines parent catalog facts with header relationships. The subagent service returns unresolved direct-child entries when no catalog fact exists; the Web derives them from its existing Session list. Menu and branch refreshes enumerate headers without requesting child projections. Selecting a child opens its own history, validates its direct parent and descriptor, and resolves mode and label. Until then the address grants no continuation authority and the composer stays read-only. A child open failure remains local. Explicit programmatic reads and continuation requests also migrate their selected Session on demand; explicit descendant inspection and bulk migration still read the Sessions they request.

The catalog remains the durable source of successful creation facts. Unresolved discovery rows are neither persisted events nor projection values. No new Session format or persistent index is needed. Offline fixture preparation and Preview packing may still explicitly supply child evidence for catalog completion; their caller already owns that corpus.

This partially supersedes runtime catalog prerequisites and corpus revisions in [released migrations](../architecture/2026-08-31-released-session-format-migrations.md), the discovery-only assumption in [parent catalogs](../architecture/2026-09-01-parent-owned-subagent-catalog.md), and unopened-branch reads in [Web projection consumption](../simplification/2026-09-08-web-subagent-catalog-projections.md). Their format, creation, ordering, and transport decisions remain active. [Incomplete evidence](2026-09-19-v3-incomplete-child-catalog-evidence.md) continues to govern optional offline completion.

## Alternatives considered

**Catch child failures and continue backfill.** This still decodes every healthy child, hides failures, and permanently omits discovery facts when the parent successor is published.

**Supply an empty child set without changing discovery.** This removes migration coupling but makes historical children disappear from catalog-only consumers.

**Persist placeholder catalog events or another child index.** Unknown mode and label are not successful creation facts. A second persistent index adds write coordination and repair without improving header-based navigation.

## Consequences

Explicit direct-child discovery now enumerates N headers in addition to materializing D catalog facts. It avoids all child-body decoding, while ordinary parent migration has no corpus-dependent preparation. Historical rows may initially show an id instead of a label and cannot promise resumability. Headers that cannot be decoded cannot contribute a navigation row, but do not block opening another known Session.

Raw and compressed persistence regressions cover V0–V3, child corruption and future formats, independent publication, unchanged predecessors, and stable parent revisions across child mutations. Service tests verify only the parent is observed. Client and Host tests verify unresolved addresses, selected-child decoding, mode resolution, and ownership rejection. The shipped Web preset-migration snapshot round-trips parent and child generations with a corrupt sibling and checks that only explicitly opened Sessions migrate.
