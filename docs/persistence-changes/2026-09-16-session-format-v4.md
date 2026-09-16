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

The [V3-to-V4 migration](../../packages/session/session-format-v3-to-v4/README.md#v3-to-v4-specification) advances the header and preserves every admitted event and inherited cut. Its generation-aware delivery checks prevent historical acknowledgements from becoming active V4 watermarks. V3 readers refuse the newer generation; the catalog restores supported older inputs through the complete adjacent chain. The [V3 schema reference](historical-formats/v3.md) preserves the outgoing declarations, and persistence retains committed predecessor bytes while publishing only the current successor.

<a id="verification"></a>
## Verification

`pnpm exec vitest run packages/session/session-format-v3-to-v4/tests` passed 22 tests across two files, covering identity preservation, inherited cuts, admission, and delivery-generation refusal. `pnpm run verify-persistence-formats` passed for all five references from V0 through V4. Before the writer change, `pnpm run verify-persistence-catalog` passed and `pnpm run verify-persistence-formats --archive 3` captured the V3 schema.

<a id="dev-note"></a>
## Dev Note

None.
