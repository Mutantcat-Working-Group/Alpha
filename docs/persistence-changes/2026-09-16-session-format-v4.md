---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-16-session-format-v4

English | [中文](2026-09-16-session-format-v4.zh.md)

## Summary

Advances the declared SessionHeader.version from 3 to 4 for the V4 integration writer. No declared event payload or envelope type changes.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-16-session-format-v4
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-11-initial"
    after: "1a3440e3577382704d42a6263aa463504eb74c566734a55e9503a63efcd02445"
    decision: version-bump
```

<a id="compatibility"></a>
## Compatibility

The [V3-to-V4 migration](../../packages/session/session-format-v3-to-v4/README.md#v3-to-v4-specification) advances the header, preserves every admitted source event and inherited cut, and appends missing parent `subagent/catalog` records from retained direct-child logs in the same persistence root. Historical body restoration requires an explicit child-evidence set, including an empty set when no children are available to backfill. Missing required descriptors or conflicting identities refuse migration without publication; existing catalog facts remain. The linked specification owns descriptor admission and deterministic append order.

Historical read opens prepare the result in memory. Write opens revalidate child membership and revisions before publishing the current successor beside unchanged predecessor files. Already-written V4 files do not rerun this incoming edge, so unreleased integration uses disposable homes. Delivery-generation checks keep historical acknowledgements from becoming active V4 watermarks. V3 readers refuse the newer generation; the [V3 schema reference](historical-formats/v3.md) preserves the outgoing declarations.

<a id="verification"></a>
## Verification

`pnpm exec vitest run packages/session/session-format-v3-to-v4/tests packages/session/session-format-catalog/tests packages/session/session-persistence-jsonl/tests/catalog-migration.spec.ts` passed 140 tests across nine files, with one skipped test. The suites cover catalog completion, inherited cuts, child-evidence refusal, and JSONL preparation/publication.

Before the writer change, `pnpm run verify-persistence-catalog` passed and `pnpm run verify-persistence-formats --archive 3` captured the V3 schema. The V4 header schema digest and its generated companion remain unchanged.

<a id="dev-note"></a>
## Dev Note

None.
