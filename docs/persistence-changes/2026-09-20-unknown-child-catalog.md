---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-20-unknown-child-catalog

English | [中文](2026-09-20-unknown-child-catalog.zh.md)

## Summary

Add subagent/catalog-unknown to retain historical direct-child header identity when a descriptor cannot establish the mode.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-20-unknown-child-catalog
baseline: false
changes:
  - root: "event:subagent/catalog-unknown"
    previous: null
    after: "d21dd6c60a43d9cb0d93da371e482f66ffd55daa36544e80978a0e7b32737b21"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

This adds an ordinary required-on-read event without changing the finalized subagent/catalog payload, Session header, or envelope. Existing logs remain valid. Older readers that do not know the new event refuse logs containing it; current readers project it into the existing catalog with unknown mode and keep continuation requests restricted to supported child descriptors.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/session/session-format-v3-to-v4/tests/validation.spec.ts packages/subagent/subagent/tests/catalog.spec.ts: 16 tests passed, covering unknown identity restoration, malformed payload rejection, duplicate child rejection, and shared catalog projection.

<a id="dev-note"></a>
## Dev Note

None.
