---
description: "Restore V3 Sessions as V4 with native tool-role rows, inherited cuts, and recorded delivery generations."
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v3-to-v4

English | [中文](README.zh.md)

## Summary

`dsh-session-format-v3-to-v4` restores released V3 Sessions into the unreleased V4 integration format. Tool results become tool-role messages; the incoming edge preserves admitted events and inherited cuts, appends missing parent catalog records, and prevents historical delivery markers from becoming active V4 watermarks. The V4 codec retains the released physical row framing without invoking the V3 validator; the static format catalog consumes it, while JSONL persistence owns source reads and successor publication.

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

The logical header changes only `version: 3` to `version: 4`. Released user-role tool-result wrappers become tool-role messages with `toolCallId`, optional `isError`, and direct result content. Released `{ kind: 'plugin', plugin }` message sources become producer-owned kinds through the frozen rename table in [sources.ts](src/sources.ts), retaining producer-specific fields. Every admitted source event retains its type, timestamp, sequence, message identity, surface operation, references, and all non-migrated payload fields; the stage appends only missing own parent catalog records after processing the source events. The released V3 codec remains owned by [V2-to-V3](../session-format-v2-to-v3/README.md); this package reuses it only for the historical source side without changing earlier migration semantics.

Source events must be dense from zero. A seeded Session's last `session/end-seed` carrying `inherited: true` determines its inherited event count, excluding the marker. A supplied source cut must agree. Missing seeded markers and inherited markers in unseeded Sessions are refused. Each stage owns its counters and cut; seeded stages leave the cut unknown before EOF, including when preceding migrations change event count.

Complete restoration validates native V4 tool and fork results, turn/step order, tool and PTC lifecycles, retries, title citations, commands, compaction ownership and spans, the protected system head, deliveries, catalog membership, inherited cuts, and installed event vocabulary. It permits unfinished tails but refuses closing events with unresolved tools or mismatched transactions. Installed Session restoration owns common event-envelope and message acceptance. The [native validation decision](../../../.agents/notes/implemented/architecture/2026-09-17-native-v4-read-validation.md) records the ownership split. The V3 semantic validator never receives a V4 event.

A `session-log-deepseek/delivery-accepted` event must identify a nonnegative safe-integer generation; omission identifies V0. A source marker claiming V4 is refused because advancing the header would activate it. Source V3 markers require a nonempty Session id and a `throughSeq` that names an earlier event. A foreign V3 marker is permitted only inside the inherited prefix of a Session with `parentSession`. Other generations retain their recorded coordinates and ids. No delivery payload is rewritten.

V4 source admission rejects retired plugin wrappers in surface, inbox, and title-request messages before recoverable scanning can discard rows. The catalog and native JSONL scanner validate every known message-source slot before exposing restored data. Unknown nonempty attribution kinds and every own JSON metadata field remain intact; external names such as `constructor` and `__proto__` are ordinary producer strings.

V4 restoration validates V4 delivery coordinates and ownership under the same rules. V3 deliveries are historical in V4 and do not become V4 watermarks. The V4 codec retains the released V2 physical framing and performs native tool-result and system-message field admission before recovery; complete vocabulary, delivery, and relationship checks require the target restorer or catalog `validation: 'current'`. Retired `header.system` fields and required predecessor PTC tags are refused even in a recoverable suffix; ignorable predecessor PTC records remain opaque. Recoverable codec reads alone do not establish strict restoration.

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

V4 also admits fork-generated `TOOL_NOT_STARTED` results with deterministic `forked-tool-result-<callId>-<seq>` IDs and branch-specific text. Native validation checks the advertised call, error result, identity suffix, and surface operation directly; persisted and restored data retain the original fork ID and wording. Later surface replacements, including tool-result pruning, retain that identity and validate their source references through the installed Session. Released V0–V3 validators remain unchanged.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The migration declaration creates independent streaming stages. Compact runs expand as iterables without an intermediate event array. The V3-to-V4 stage rewrites historical message sources and lifts historical tool-result wrappers once while emitting V4 events. The V4 codec uses the released V2 codec only for physical header and source-range framing, and validates native tool-role rows directly; it does not invoke the released V3 validator or source-conversion views. JSONL scanners call `assertV4RowAdmission` before suppressing recoverable rows and the shared mandatory relationship validator before returning the completed logical prefix.

The target restorer validates native fields and mandatory cross-event relationships, then returns the original artifact. Unknown ignorable events remain opaque, and unfinished inherited compactions expire at the end-seed marker. No runtime invariant companion is published because this pure library owns no independently maintained runtime observations.

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

Historical requests retain their recorded messages and model configuration. The [migration stage](src/migration.ts) represents `tool/result` payloads as tool-role messages without adding model-visible content; catalog records do not enter model messages directly, though later subagent listing can discover the historical children.

#### Token effect

The conversion changes no request text or token-bearing data.

#### KV Cache effect

The edge preserves the recorded request prefix. Provider cache availability and eviction remain outside this library.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Unreleased integration format** — integrate and validate the selected structural changes before releasing V4; already-written V4 files do not rerun this incoming edge. Use disposable integration homes and retain the original historical inputs.
- **Nested historical tool results** — migration refuses results containing another tool-result wrapper because flattening loses its call identity and error status. The original generation remains intact and no V4 successor is published; those histories need a preserving conversion before they can resume.
- **Historical tool-result extensions** — outer message JSON properties remain own data properties, including `__proto__` and `constructor`. Unknown wrapper fields have no defined V4 destination and refuse migration. Existing outer `toolCallId` or `isError` fields must agree with the lifted result; conflicts refuse without publishing a successor.
- **Retained child logs required** — a parent alone cannot recover unrecorded child ids, creation times, or descriptors. Deleted children cannot be reconstructed from tool arguments; existing parent catalog records remain.
- **Storage scope** — facts cover recognizable children within the same persistence root. Cross-root import and corrupt-log repair are outside this migration.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
