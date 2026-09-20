---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-19-external-subagent-catalog

English | [中文](2026-09-19-external-subagent-catalog.zh.md)

## Summary

Add an optional external membership marker to one-shot parent catalog entries.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-19-external-subagent-catalog
baseline: false
changes:
  - root: "event:subagent/catalog"
    previous: "2026-09-20-unknown-child-catalog"
    after: "568d482eeba04a9422773e7563cf935bd06f16896758cf880cf19b6bab8b1ada"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing version-0 and version-1 catalog facts remain valid without the optional external field. The literal true identifies a child without a local Session. Creation writes one membership fact; execution and cleanup do not update it. Duplicate child ids remain invalid. Unknown-mode and continuable entries do not accept the marker. This updates the unaccepted optional-field addition in this PR and does not change released generations or the Session format version.

<a id="verification"></a>
## Verification

Focused catalog, external activation, native V4 restoration, and client tests passed. They cover creation-time membership, no settlement update, cleanup failure independent of catalog membership, and duplicate-child rejection.

<a id="dev-note"></a>
## Dev Note

None.
