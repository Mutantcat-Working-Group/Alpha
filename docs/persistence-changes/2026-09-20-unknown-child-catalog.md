---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-20-unknown-child-catalog

English | [中文](2026-09-20-unknown-child-catalog.zh.md)

## Summary

Retain unreadable historical children in subagent/catalog with unknown mode.

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
  - root: "event:subagent/catalog"
    previous: "2026-09-11-initial"
    after: "4d6002c7eec8d76bbb6e531a35a55bc66dfb87621bc2e89e3af0641acf947bb3"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The catalog adds one unknown-mode alternative with the same identity and optional label fields as one-shot mode. Existing alternatives and the V4 header remain unchanged. New readers accept old records; older readers may reject records with unknown mode. The persistence classifier has a scoped catalog exception for this addition, while other union additions and modifications remain strict. Unknown membership grants no continuation capability.

<a id="verification"></a>
## Verification

Catalog migration, restoration, projection, and Web regressions cover retained unknown membership and child-local errors. Persistence classifier tests accept the exact catalog extension and reject altered existing fields, other new modes, extra unknown fields, removals, and unrelated union additions.

<a id="dev-note"></a>
## Dev Note

None.
