# Agent Note: Complete parent catalogs without migrating child catalogs

Status: implemented

English | [中文](2026-09-19-session-local-subagent-migration.zh.md)

## Problem

Opening a historical parent requires discovery facts from its direct children. A child's corrupt body or invalid descriptor, or an unreadable header elsewhere in the root, could reject the parent's V4 preparation and hide otherwise readable history.

## Decision

Opening A discovers candidate B Sessions through headers, reads their own descriptors, and completes A's catalog. Historical child reads use the V0–V3 catalog; current child reads use native validation. These reads neither prepare B's own catalog nor publish B's successor. Opening B separately performs B's migration and catalog preparation. Frontend discovery and `list_agents` retain their parent-catalog behavior and existing result types.

JSONL omits unreadable or unsupported headers from discovery. A child-body or descriptor-field failure produces a warning with the child path and omits that child's supplemental fact, while preserving healthy siblings and existing parent entries. Cancellation and source-consistency failures still stop the operation. Inspected child revisions, including failed decodes, are rechecked before reuse and publication so repairs cannot silently reuse stale evidence. Released predecessors remain byte-identical.

This partially supersedes child-failure propagation in [released migrations](../architecture/2026-08-31-released-session-format-migrations.md) and [incomplete child evidence](2026-09-19-v3-incomplete-child-catalog-evidence.md). Their format conversion, descriptor cardinality, conflict validation, and immutable publication rules remain active.

## Alternatives considered

**Skip catalog completion and discover children in each consumer.** This introduces incomplete tool results and additional UI states despite the parent's readable child descriptors. The parent catalog already serves these consumers.

**Recursively prepare child catalogs.** A only needs B's own descriptor. Preparing B's descendants adds unrelated work and failure dependencies.

**Refuse A when one child cannot be read.** The child's discovery metadata does not justify withholding the parent's healthy history. Warnings retain the child location without inventing mode or label fields.

## Consequences

Initial parent preparation still scans headers and reads direct-child bodies one at a time. It does not claim to eliminate this I/O. Published V4 parents use their catalog without rescanning children. A failed child's missing catalog entry is not automatically repaired after parent publication; the child remains addressable by id, as with other incomplete historical descriptor evidence.

Raw and compressed tests cover catalog completion, child-local errors, source changes and repairs, unchanged child generations, and deferred child-catalog preparation. The shipped Web migration snapshot checks the parent catalog with a corrupt sibling, then opens the child independently. Its additional historical child raises the corpus budget from ten to eleven roles; the guard rejects a twelfth role.
