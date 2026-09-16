---
description: "Restore V3 Sessions as V4 while preserving events, inherited cuts, and recorded delivery generations."
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v3-to-v4

English | [中文](README.zh.md)

## Summary

`dsh-session-format-v3-to-v4` restores released V3 Sessions into the unreleased V4 integration format. The incoming edge preserves admitted events, appends missing parent catalog records, and inherits V3 framing and relationship validation. The static format catalog consumes this library; JSONL persistence owns source reads and successor publication.

## Table of Contents

- [Use this package](#use-this-package)
- [V3-to-V4 specification](#v3-to-v4-specification)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use the [catalog](../session-format-catalog/README.md) for complete restoration. Direct imports serve catalog assembly and tests; this library has no Cordis mount configuration. Its [public exports](src/index.ts) provide the adjacent migration, the exact released V3 codec, the V4 codec, and target validators.

The header-only operation advances validated metadata without reading the body:

```text
const targetHeader = sessionFormatV3ToV4.migrateHeader(sourceHeader)
```

Complete restoration decodes rows, passes them through a fresh stage, and validates the target artifact. Partial stage emissions do not establish success: a later event or `finish()` can refuse the artifact. Strict catalog restoration uses `{ recovery: 'strict', validation: 'current' }`; the [format protocol](../session-format/README.md) owns scheduling and error handling.

-----

<a id="v3-to-v4-specification"></a>
## V3-to-V4 specification

The logical header changes only `version: 3` to `version: 4`. Every admitted event retains its type, payload, timestamp, sequence, message identity, surface operation, and references. The stage emits the original event object. It appends missing own parent catalog records after the unchanged source events. The released V3 codec remains owned by [V2-to-V3](../session-format-v2-to-v3/README.md); this package reuses it without changing earlier migration semantics.

Source events must be dense from zero. A seeded Session's last `session/end-seed` carrying `inherited: true` determines its inherited event count, excluding the marker. A supplied source cut must agree. Missing seeded markers and inherited markers in unseeded Sessions are refused. Each stage owns its counters and cut; seeded stages leave the cut unknown before EOF, including when preceding migrations change event count.

Complete restoration applies [native V3 admission](../session-format-v2-to-v3/README.md#native-v3-admission) to the unchanged representation: malformed canonical events and invalid relationships are refused; unknown required event types require installed vocabulary; unknown ignorable events retain their opaque values. This edge changes no source coordinates or payload meaning, so retaining opaque data does not require interpreting it. The separate source-audit policies of earlier edges remain unchanged.

A `session-log-deepseek/delivery-accepted` event must identify a nonnegative safe-integer generation; omission identifies V0. A source marker claiming V4 is refused because advancing the header would activate it. Source V3 markers require a nonempty Session id and a `throughSeq` that names an earlier event. A foreign V3 marker is permitted only inside the inherited prefix of a Session with `parentSession`. Other generations retain their recorded coordinates and ids. No delivery payload is rewritten.

V4 restoration validates V4 delivery coordinates and ownership under the same rules. V3 deliveries are historical in V4 and do not become V4 watermarks. The V4 codec preserves V3 framing and pre-recovery structural refusal; complete vocabulary, delivery, and relationship checks require the target restorer or catalog `validation: 'current'`. Recoverable codec reads alone do not establish strict restoration.

-----

### Entry point

```text
const catalog = createSessionFormatCatalogWithChildren(childFacts)
const restore = catalog.createRestore(physicalHeader, {
  recovery: 'strict', validation: 'current',
})
for (const row of rows) restore.decodeRow(row)
const artifact = restore.finish()
```

`childFacts` is required explicitly; an empty array declares no children to backfill. The catalog uses `createSessionFormatV3ToV4(childFacts)` to bind this evidence in the stage factory; the generic migration interfaces carry no child data. Keep the evidence unchanged for the lifetime of the bound migration. `historicalChildCatalogSource()` collects a direct subagent child's id, creation time, own descriptor count, and descriptor payload after the inherited prefix. Collection permits absent or unknown descriptors. The Stage interprets descriptor v1 as continuable with a required label, and v2/v3 through their mode and label fields; it does not restore historical continuation composition.

An existing own parent catalog entry does not require an available child descriptor. Its extensions remain intact; creation time and available supported discovery fields must agree with the child. Duplicate own descriptors are refused. A missing catalog entry requires exactly one supported descriptor with complete discovery fields; missing or unknown descriptors refuse migration without publication. Native V4 reads also validate own catalog fields and uniqueness; malformed catalog data reports a format error rather than an incoming-migration failure. Catalog payload version 0 is the admitted schema; future payload evolution must update the codec’s admission and the repository’s persistence-change records together.

Migration retains every source event, order, sequence, timestamp, and payload, appending missing own catalog records sorted by creation time then child id. Appended records use the last source event time, or header creation time for an empty log. Catalog field and uniqueness checks apply only after the final inherited cut; inherited payloads remain opaque and do not establish own membership. Existing catalog extensions remain intact.

V4 also admits fork-generated `TOOL_NOT_STARTED` results with deterministic `forked-tool-result-<callId>-<seq>` IDs and branch-specific text. Validation checks the advertised call and error result, using a private canonical V3 repair view; persisted and restored data retain the original fork ID and wording. Later surface replacements, including tool-result pruning, retain that identity and validate their source references through the released rules. Released V0–V3 validators remain unchanged.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The migration declaration creates independent streaming stages. Compact runs expand as iterables without an intermediate event array. The V4 codec translates only the physical header version while delegating released V3 event framing and recovery. JSONL scanners call `assertV4RowAdmission` before suppressing recoverable rows.

The target restorer uses a private V3 relationship view to distinguish V4 deliveries from historical V3 deliveries, then returns the original artifact. Its temporary generation substitutions never escape. No runtime invariant companion is published because this pure library owns no independently maintained runtime observations.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Format version and release status](../../../docs/session-format-status.md) — checkout writer and published format authority.
- [Adding a Session format version](../../../docs/cookbook/adding-a-session-format-version.md) — adjacent-edge integration and validation.
- [JSONL persistence](../session-persistence-jsonl/README.md) — immutable generation selection and publication.

-----

<a id="model-experience"></a>
## Model Experience

### Historical restoration

#### What the model sees

Historical requests retain their recorded messages and model configuration because the [migration stage](src/migration.ts) preserves `SessionFormatEvent.data`. This edge adds no model-visible content.

#### Token effect

Catalog records do not enter model messages directly; subsequent subagent listing can discover the historical children.

#### KV Cache effect

The edge preserves the recorded request prefix. Provider cache availability and eviction remain outside this library.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Unreleased integration format** — integrate and validate the selected structural changes before releasing V4; already-written V4 files do not rerun this incoming edge. Use disposable integration homes and retain the original historical inputs.
- **Retained child logs required** — a parent alone cannot recover unrecorded child ids, creation times, or descriptors. Deleted children cannot be reconstructed from tool arguments; existing parent catalog records remain.
- **Storage scope** — facts cover recognizable children within the same persistence root. Cross-root import and corrupt-log repair are outside this migration.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
