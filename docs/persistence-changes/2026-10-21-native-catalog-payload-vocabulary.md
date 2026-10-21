---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-21-native-catalog-payload-vocabulary

English | [中文](2026-10-21-native-catalog-payload-vocabulary.zh.md)

## Summary

The parent catalog projection accepts the payload vocabulary the V4 migration already writes. Local creation keeps writing version 0; a migrated child whose descriptor is missing, unrecognized, or duplicated becomes a version 1 fact whose mode stays unknown, and an execution outside a local child Session is a version 2 fact with mode external.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-21-native-catalog-payload-vocabulary
baseline: false
changes:
  - root: "event:subagent/catalog"
    previous: "2026-09-19-external-subagent-catalog"
    after: "53750b9abf61efb7992b0aadc3e247ec927449c63266df28230fd1139f5590ac"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The change is a reader widening inside one format version: version 0 keeps its one-shot and continuable facts, version 1 adds the unknown mode alongside the local modes, version 2 requires the external mode, and a payload whose version and mode disagree is still rejected. No released generation, writer output, or `SESSION_FORMAT_VERSION` moves, so existing logs keep restoring and no successor format is implied.

<a id="verification"></a>
## Verification

`packages/subagent/subagent/tests/catalog.spec.ts` folds the V4 vocabulary through the pure projection definition, checks the wire view for unknown and external rows, and rejects the three mismatched version and mode pairs; `packages/experimental/webworker-packer/tests/preview.spec.ts` restores a child without a descriptor and observes the version 1 unknown fact.

<a id="dev-note"></a>
## Dev Note

None.
