---
description: "Restore V3 Sessions as V4 while preserving events, inherited cuts, and recorded delivery generations."
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v3-to-v4

English | [中文](README.zh.md)

## Summary

Restore supported V3 Sessions as V4 without changing their events or historical requests. The library advances the header version, retains event coordinates and inherited cuts, and prevents historical delivery markers from becoming active V4 watermarks. Persistence consumes it through the static catalog; the library does not read or publish files.

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

The logical header changes only `version: 3` to `version: 4`. Every admitted event retains its type, payload, timestamp, sequence, message identity, surface operation, and references. The stage emits the original event object. It adds, removes, and reorders no events. The released V3 codec remains owned by [V2-to-V3](../session-format-v2-to-v3/README.md); this package reuses it without changing earlier migration semantics.

Source events must be dense from zero. A seeded Session's last `session/end-seed` carrying `inherited: true` determines its inherited event count, excluding the marker. A supplied source cut must agree. Missing seeded markers and inherited markers in unseeded Sessions are refused. Each stage owns its counters and cut; seeded stages leave the cut unknown before EOF, including when preceding migrations change event count.

Complete restoration applies [native V3 admission](../session-format-v2-to-v3/README.md#native-v3-admission) to the unchanged representation: malformed canonical events and invalid relationships are refused; unknown required event types require installed vocabulary; unknown ignorable events retain their opaque values. This identity edge changes no coordinates or payload meaning, so retaining opaque data does not require interpreting it. The separate source-audit policies of earlier edges remain unchanged.

A `session-log-deepseek/delivery-accepted` event must identify a nonnegative safe-integer generation; omission identifies V0. A source marker claiming V4 is refused because advancing the header would activate it. Source V3 markers require a nonempty Session id and a `throughSeq` that names an earlier event. A foreign V3 marker is permitted only inside the inherited prefix of a Session with `parentSession`. Other generations retain their recorded coordinates and ids. No delivery payload is rewritten.

V4 restoration validates V4 delivery coordinates and ownership under the same rules. V3 deliveries are historical in V4 and do not become V4 watermarks. The V4 codec preserves V3 framing and pre-recovery structural refusal; complete vocabulary, delivery, and relationship checks require the target restorer or catalog `validation: 'current'`. Recoverable codec reads alone do not establish strict restoration.

-----

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

Historical requests retain their recorded messages and model configuration because the [identity stage](src/migration.ts) preserves `SessionFormatEvent.data`. This edge adds no model-visible content.

#### Token effect

The identity conversion changes no request text or token-bearing data.

#### KV Cache effect

The edge preserves the recorded request prefix. Provider cache availability and eviction remain outside this library.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Existing V4 data skips this edge** — later edits to the unreleased migration do not transform an already-written V4 generation. Integration tests need fresh disposable homes populated from unchanged historical input.
- **No file publication** — the library returns validated logical events; persistence owns publishing a successor beside unchanged committed generations.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
