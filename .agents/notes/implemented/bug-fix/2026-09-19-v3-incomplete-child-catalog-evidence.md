# Agent Note: Preserve V3 Sessions with incomplete child catalog evidence

Status: implemented

English | [中文](2026-09-19-v3-incomplete-child-catalog-evidence.zh.md)

## Problem

A valid V3 child log can have no own descriptor, an unsupported descriptor version, or multiple descriptors. Its header still establishes its identity and parent relationship. Requiring one supported descriptor to migrate the parent makes unavailable discovery fields prevent access to otherwise readable history.

## Decision

Optional V3→V4 catalog completion for offline fixture preparation and Preview packing appends a missing parent entry only when exactly one supported own child descriptor supplies its discovery fields. Other descriptor counts and unsupported versions contribute no new fact; existing parent entries and child events remain intact. Runtime JSONL migration does not collect this evidence and restores each Session independently, as specified in the [adjacent migration decision](../architecture/2026-08-31-released-session-format-migrations.md).

Supplied child creation times must match existing parent entries. Mode, label, and descriptor fields are checked only for exactly one supported own descriptor. These evidence checks belong to explicit offline completion; child corruption or unsupported generations never prevent runtime parent migration.

## Alternatives considered

**Refuse the whole parent.** Discovery metadata is insufficient to justify making valid parent history unavailable.

**Choose a descriptor or infer defaults.** Multiple descriptors do not establish which identity was admitted. Invented mode or label fields would become durable catalog facts without evidence.

## Consequences

A historical child without a usable descriptor remains discoverable from a readable parent-linked header even when no parent catalog entry exists. Runtime migration preserves that absence rather than inventing a fact. The child’s own open performs decoding and reports any failure locally; publishing a parent successor never requires successful child decoding.

Pure completion and Preview tests retain unavailable-evidence, existing-entry, and conflict coverage. JSONL read/write regressions cover independent parent and child opens, stable parent revisions across child changes, and unchanged predecessor bytes.

The [Session-local migration decision](./2026-09-19-session-local-subagent-migration.md) supersedes runtime child-body collection and unopened-branch projection reads; optional offline completion and durable catalog semantics remain active.
