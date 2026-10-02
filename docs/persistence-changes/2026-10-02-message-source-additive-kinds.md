---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-02-message-source-additive-kinds

English | [中文](2026-10-02-message-source-additive-kinds.zh.md)

## Summary

Adds the merge-extensible 'schedule' producer kind to persisted message sources.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-02-message-source-additive-kinds
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-14-image-offload"
    after: "4f0d49f11892c6bc82ec26ca6da62190ab9528cb485270fc978f89c7307bfa04"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-14-image-offload"
    after: "771544077f082091c3d0a561d2394fd09b36457a784f4284ff1d4e8eb87603d3"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-14-image-offload"
    after: "b1718d3a4f806ef163db75a7e03c48b9348995e0267b496872e382c174b58416"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid. Both client projections read a persisted message source by its required string 'kind'; known producers get a specific label and every unknown 'kind' is preserved as opaque content and never replays producer-specific fields. Adding 'schedule' to the union therefore leaves replay of older records unchanged, and every previously recorded kind is retained byte-identically. 'schedule' is the only added alternative across the three affected roots.

<a id="verification"></a>
## Verification

pnpm exec vitest run scripts/persistence-changes.spec.ts: 37 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
