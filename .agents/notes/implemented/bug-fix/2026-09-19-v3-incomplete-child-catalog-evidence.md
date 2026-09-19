# Agent Note: Preserve V3 Sessions with incomplete child catalog evidence

Status: implemented

English | [中文](2026-09-19-v3-incomplete-child-catalog-evidence.zh.md)

## Problem

A valid V3 child log can have no own descriptor, an unsupported descriptor version, or multiple descriptors. Its header still establishes its identity and parent relationship. Requiring one supported descriptor to migrate the parent makes unavailable discovery fields prevent access to otherwise readable history.

## Decision

The V3→V4 migration appends a missing parent catalog entry only when exactly one supported own child descriptor supplies its discovery fields. Other descriptor counts and unsupported versions contribute no new catalog fact. Existing parent entries and child events remain intact. This replaces only the missing-evidence refusal in the [adjacent migration decision](../architecture/2026-08-31-released-session-format-migrations.md).

Known child creation times must still match existing parent entries. Available unambiguous mode and label fields must also agree. Invalid known descriptor fields, corrupt logs, unreadable membership, unsupported selected generations, and changed source revisions retain their existing failures.

## Alternatives considered

**Refuse the whole parent.** Discovery metadata is insufficient to justify making valid parent history unavailable.

**Choose a descriptor or infer defaults.** Multiple descriptors do not establish which identity was admitted. Invented mode or label fields would become durable catalog facts without evidence.

## Consequences

A historical child without a usable descriptor remains readable by id but may be absent from its parent's direct-child catalog. Existing catalog entries remain visible. Once a V4 successor is published, opening it does not rescan historical children; automatic later catalog repair is outside this migration. Preparation still rechecks child revisions before publication, so newly available evidence cannot silently bypass source consistency checks.

Unit, JSONL read/write, and Preview packing tests cover unavailable evidence, unchanged source bytes, retained entries, identity conflicts, and evidence changes before publication.
