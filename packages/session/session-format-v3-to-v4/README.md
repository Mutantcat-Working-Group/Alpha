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
  - [Header and physical framing](#header-and-framing)
  - [Tool-result representation](#tool-results)
  - [Extension data](#extension-data)
  - [Message-source conversion](#message-sources)
  - [Parent catalog prerequisites](#parent-catalog)
  - [Sequence references and inheritance](#sequence-references)
  - [Delivery generations](#delivery-guards)
  - [Source audit and refusal](#source-audit)
- [Native V4 admission](#native-v4-admission)
  - [Header, messages, and surface metadata](#native-fields)
  - [Lifecycle and reference relationships](#native-relationships)
  - [Developer changes and deferred schemas](#developer-changes)
  - [Fork-generated results](#fork-results)
  - [Validation entry points and recovery](#native-recovery)
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

Historical body restoration requires explicit child evidence. `sessionFormatV3ToV4.createStage()` refuses without that binding; an empty array explicitly declares no children. Persistence must collect the complete available direct-child set, while isolated transcript replay can supply its deliberately empty set. Keep the evidence unchanged for the catalog's lifetime.

```text
const catalog = createSessionFormatCatalogWithChildren(childFacts)
const restore = catalog.createRestore(physicalHeader, {
  recovery: 'strict', validation: 'current',
})
for (const row of physicalRows) restore.decodeRow(row)
const artifact = restore.finish()
```

Every restore creates independent Stage state. Compact runs expand as iterables without an intermediate event array. Partial emissions do not establish success: a later row or `finish()` can refuse the artifact. The [format protocol](../session-format/README.md) owns scheduling and error handling; [JSONL persistence](../session-persistence-jsonl/README.md) owns source reads, preparation, and verified exclusive successor publication.

-----

<a id="v3-to-v4-specification"></a>
## V3-to-V4 specification

This edge changes only the named representations below and appends available missing catalog facts. It namespaces unknown ignorable event types and retains each admitted source event's time, sequence, message identities, surface operation, references, and all fields outside those conversions. It creates no system prompt, developer event, tool execution, or replacement message. Earlier V0–V2 inputs first pass through their existing edges to V3; those edges retain their own transformations and refusal policies.

Source events must be dense from zero. A seeded Session's last `session/end-seed` carrying `inherited: true` determines its inherited event count, excluding the marker. A supplied source cut must agree. Missing seeded markers and inherited markers in unseeded Sessions are refused. Each stage owns its counters and cut; seeded stages leave the cut unknown before EOF, including when preceding migrations change event count.

Complete restoration validates native V4 tool and fork results, turn/step order, tool and PTC lifecycles, retries, title citations, commands, compaction ownership and spans, the protected system head, deliveries, catalog membership, inherited cuts, and installed event vocabulary. It permits unfinished tails but refuses closing events with unresolved tools or mismatched transactions. Installed Session restoration owns common event-envelope and message acceptance. The [native validation decision](../../../.agents/notes/implemented/architecture/2026-09-17-native-v4-read-validation.md) records the ownership split. The V3 semantic validator never receives a V4 event.

No preset id, PTC dispatch event tag, file attachment, or physical filename is renamed by this edge. Content extensions in embedded streams follow the rules below; stream order and indices remain unchanged.

V4 source admission rejects retired plugin wrappers in surface, inbox, and title-request messages before recoverable scanning can discard rows. The catalog and native JSONL scanner validate every known message-source slot before exposing restored data. Unknown nonempty attribution kinds and every own JSON metadata field remain intact; external names such as `constructor` and `__proto__` are ordinary producer strings.

[liftToolResult](src/tool-role.ts) converts the message of a `tool/result` event whose source representation has role `user`. It requires a nonempty message id, source `{ kind: 'tool', callId }` with a nonempty call id, and exactly one `tool-result` block naming the same call. The block's content must be an array; an optional `isError` must be boolean.

| V3 field | V4 field or treatment |
|---|---|
| `data.message.role: 'user'` | `role: 'tool'` |
| `data.message.content[0].toolCallId` | `data.message.toolCallId`, equal to the retained `source.callId` |
| `data.message.content[0].content` | Direct `data.message.content`, including empty content |
| `data.message.content[0].isError` | Optional `data.message.isError` |
| Wrapper `type: 'tool-result'` | Removed with the wrapper |
| Message `id`, `source`, event fields | Retained; no message or call id is minted |

The wrapper alone supplies the interpreted call id, content, and optional error flag. Other wrapper fields become `plugin:result:<original-field>`; outer message fields other than `id`, `role`, `source`, and `content` become `plugin:message:<original-field>`. Complete original names remain in the suffix, including existing prefixes. Distinct owners and colliding names retain separate values; own `__proto__` and `constructor` data stays intact. No metadata container or new content type is added.

A malformed canonical wrapper raises a format error. Nested results are unsupported by this converter and refuse without publishing a successor. The transformation does not repair contradictory `data.error`; native target validation requires it to accompany the wrapper's `isError: true`. Converter support may expand later while preserving the established native V4 representation.

<a id="extension-data"></a>
### Extension data

Unknown V3 content tags become `plugin:<original-type>`; all other fields remain unchanged and opaque. Stream starts use the same tag in `blockType`; every other field retains its original key and value. An existing prefix on a content tag is prefixed again, keeping distinct old names distinct. Arguments, replay state, and plugin content fields are not traversed. These names do not load or execute plugins.

Request-tool definitions retain their own field names and values, including ordinary extension metadata. A definition with its own top-level `deferLoading` field refuses V3 migration: the field is defined only in V4, so this edge assigns it no historical meaning. Nested parameter data is unchanged. Native V4 admission of `deferLoading: true` is unchanged.

<a id="message-sources"></a>
### Message-source conversion

The [message walker](src/sources.ts) visits only these payload positions. It converts legacy plugin wrappers and retains direct source kinds.

| Owning event | Message position |
|---|---|
| `user/message` | `data` |
| `system/message`, `assistant/message`, `tool/result` | `data.message` |
| `agent/inbox/spliced` | Each `data.inserted[]` member |
| `session/title-llm-request` | Each `data.messages[]` member |
| `developer/message` | Native walker only; an unknown ignorable V3 event is namespaced and its payload is not visited |

A plugin source requires a string `plugin`, including the empty string. Conversion removes that property, replaces `kind`, and preserves every other own JSON property. Direct source kinds must be nonempty strings. Conversion does not infer missing metadata from message text, tool arguments, configuration, or current files.

| Exact V3 `plugin` | V4 `kind` |
|---|---|
| `compact` | `compact-checkpoint` |
| `tools-code-mode`, `tools-ptc` | `ptc-mode` |
| `dsh-compaction-basic` | `compact-basic` |
| `@deepseek-ai/dsh-system-prompt`, on a system-role message | `system-prompt` |
| `@deepseek-ai/dsh-system-prompt`, on another role | `runtime-context` |
| Same-name first-party producers listed below | The exact plugin string |
| Any other plugin name | `plugin:` followed by the complete original name |

The same-name producers are `agent-instructions`, `session-reference`, `team-message`, `goal`, `skill-invocation`, `skill-catalog`, `coordinator`, `subagent-report`, `subagent-settled`, `webhook`, `agent-message`, `model-selection`, `plan-mode`, `time-context`, `tmux-context`, `user-approval`, `repeat-tool-reminder`, `tool-cordis`, `cordis-host-runner`, `tool-goal`, `tool-jobs`, `hooks-codex`, `hooks-claude-code`, `schedule`, and `dsh-session-title-llm`.

The complete plugin string is retained after `plugin:`: a plugin named `acme` becomes `plugin:acme`. Direct sources, including unknown and already-prefixed kinds, keep their original kind and every own JSON field.

There is no recursive source search. Captured request text, assistant replay state and streams, tool arguments/content metadata, Team payloads, and arbitrary nested objects remain unchanged unless another explicitly named rule applies.

<a id="parent-catalog"></a>
### Parent catalog prerequisites

`historicalChildCatalogSource()` collects a direct subagent child's id and creation time, the number of its own `subagent/descriptor` events after its inherited cut, and the first descriptor payload. The child must have `origin: 'subagent'` and a direct parent. Supplemental facts require `childId`, a nonnegative safe-integer `childCreatedAt` and `descriptorCount`, and a `descriptor` property; absent descriptors are represented by null. An optional `sourcePath` is retained for diagnostics.

| Available evidence | Migration decision |
|---|---|
| One descriptor with version 1 | Require string provider and label; derive `mode: 'continuable'`. |
| One descriptor with version 2 or 3 | Require string provider; use its mode and optional label under catalog rules. |
| Zero descriptors, or an unsupported descriptor version | Retain an existing parent entry; otherwise append unknown-mode membership. |
| More than one own descriptor | Retain an existing parent entry without mode/label comparison; otherwise append unknown-mode membership. |
| Existing own parent entry | Retain it and its extensions; require matching child creation time and mode/label from exactly one supported own descriptor, when available. |
| Missing own parent entry with complete supported evidence | Append a version-0 catalog fact with child id, creation time, mode, and optional label. |
| Missing own parent entry without complete evidence | Append a version-1 `subagent/catalog` with header identity and unknown mode, without inventing a label. |

Catalog versions 0 and 1 require string `childId`, nonnegative safe-integer `childCreatedAt`, mode `continuable` or `one-shot` (version 1 additionally accepts `unknown`), and a string label for continuable mode; a present label in any mode must also be a string. Version 2 accepts only `external` mode with an optional string label. Duplicate own child ids are refused. Existing entries without a corresponding retained child remain in the parent. Descriptor collection does not restore a child's old continuation composition or recover deleted children from tool arguments. Unknown-mode entries retain header identity without asserting a supported child descriptor.

The stage considers parent catalog records only after the final inherited cut. Every inherited marker discards earlier catalog candidates without interpreting their payloads. Missing entries append after all source events, sorted by creation time then child id, with dense new sequences. Their time is the final source event's time, or header creation time for an empty log. They neither enter the model surface nor change the inherited count.

Storage supplies recognizable direct-child evidence and rechecks membership and physical revisions during preparation, memo reuse, and publication. The JSONL provider isolates unreadable child headers, child decoding failures, and invalid descriptor fields while retaining other catalog entries; it does not migrate child catalogs during parent preparation. The converter still rejects conflicting supplied facts and changed parent history. [JSONL persistence](../session-persistence-jsonl/README.md) owns warnings, source checks, and child-local failure handling. Current V4 reads never invoke this converter and validate native catalog fields, uniqueness, and delivery ownership directly.

<a id="sequence-references"></a>
### Sequence references and inheritance

This edge performs no coordinate remapping. Existing event sequences, `sourceEventSeqs`, replacement `startSeq/endSeq`, command and title references, compaction spans, captured Session references, delivery coordinates, turn/step numbers, stream indices, and all ids retain their values. Tool-result lifting and source conversion do not change source event count; appended catalog records only extend the suffix.

For a seeded Session, the last `session/end-seed` carrying `inherited: true` identifies the inherited event count, excluding that marker. It is unchanged from the V3-stage input, including when preceding V0–V2 migrations already remapped it. A supplied source cut must agree; a missing tagged marker, an inherited marker in an unseeded Session, or a cut outside the events is refused. Unseeded stages expose zero before EOF; seeded stages leave the count unknown until `finish()`. Untagged markers do not define fork inheritance.

<a id="delivery-guards"></a>
### Delivery generations

| Delivery record | Admission and preservation |
|---|---|
| Any interpreted `session-log-deepseek/delivery-accepted` | Generation must be a nonnegative safe integer; omission identifies V0. |
| V3 source marker claiming generation 4 | Refuse: advancing the header must not activate a target-generation watermark. |
| V3 source marker for generation 3 | Require a nonempty Session id and nonnegative safe-integer `throughSeq` before the marker; a foreign id is allowed only before the inherited cut with `parentSession`. |
| Other source generations, including values above 4 | Retain their event type, payload, and coordinates unchanged; they remain inactive in V4. |
| Native V4 marker for generation 4 | Apply the same earlier-coordinate and Session-ownership checks using V4 as current. |
| Native V4 historical marker, including generation 3 | Retain recorded coordinates and identity; it is not a V4 acceptance watermark. |

No delivery payload or event type is rewritten. Higher-version migrations own any future activation checks; this edge checks only promotion to V4. The marker’s envelope sequence remains unchanged.

<a id="source-audit"></a>
### Source audit and refusal

V3 physical decoding and header validation run before the stage. The stage checks dense sequences, source cuts, canonical tool-result wrappers, named plugin sources, delivery ownership, and supplied catalog evidence as specified above. It does not run the complete released V3 semantic restorer or copy the V2→V3 event/content allowlist. Complete restoration additionally applies the V4 target rules below; physical parsing, stage conversion, and target restoration are distinct checks.

Only the enumerated messages and fields are converted. Unrelated events and arbitrary JSON do not acquire new meanings from matching strings or numbers. The fixed `RELEASED_V3_EVENT_TYPES` set separates source events from extensions independently of the current writer. The stage rejects unknown required V3 event types before interpreting their payloads or consulting the V4 vocabulary, including names that V4 recognizes. Unknown ignorable names become `plugin:<original-name>` with their payload unchanged. No generic source-schema validation or recursive numeric-field inference is implied.

Only the canonical V3 `tool/result` wrapper has a preserving conversion. A retired `tool-result` block in another interpreted position is refused by target admission rather than retained as an invalid V4 block. Native V4 applies the same tag refusal before recoverable suffix suppression. The check covers only these positions:

| Owner | Content inspected for the retired tag |
|---|---|
| `user/message` | `data.content[]` |
| `system/message`, `developer/message`, `assistant/message`, `tool/result` | `data.message.content[]`; the canonical source tool/result wrapper is lifted before target checking |
| `agent/inbox/spliced`, `session/title-llm-request` | `data.inserted[].content[]` and `data.messages[].content[]`, respectively |
| `team/message/queued` | `data.message.content[]` |
| `compaction/summary`, `tool/ptc-dispatch` | `data.summary[]`, optional `data.rawOutput[]`, and `data.content[]`, respectively |
| Embedded assistant streams | `assistant/message.data.stream[]` and `assistant/attempt.data.stream[]` entries with `type: 'chunk'`: `chunk.block.type` for `block-end`, and `chunk.blockType` for `block-start` |

The [retired-syntax check](src/retired-syntax.ts) examines direct block tags, not arbitrary descendants. Tool arguments, replay state, JSON-schema parameters, nested metadata, and unknown ignorable event payloads remain opaque. An unknown ignorable developer payload is deferred until reader vocabulary recognizes it; the writer validates known developer records even when marked ignorable.

A direct stage can raise `SessionFormatError` for malformed data or `SessionFormatUnsupportedMigrationError` when a preserving conversion is unavailable. The catalog wraps stage failures as unsupported migration; transformed-target failures receive that classification as well. Strict current validation reports its target failure directly. Physical corruption follows the chosen decoder recovery policy. No prefix is a completed restore, and a refusal does not authorize source mutation, a partial successor, or generation fallback.

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

System image admission requires a nonempty attachment id, one of PNG/JPEG/WebP/GIF MIME types, nonnegative bytes, positive width/height, optional string name, and positive original dimensions when present. Native storage admission is distinct from whether a particular model provider can represent that content.

Current common admission does not validate each user/tool/developer content block against the complete generated schema. It checks message identity, role, source, and an array container; version-specific validators add only the checks listed here. Unknown block kinds and uninspected fields can therefore survive storage admission and still be refused by a provider.

<a id="native-relationships"></a>
### Lifecycle and reference relationships

| Owner | Required relationship |
|---|---|
| `turn/start`, `turn/end`, `step/start`, `step/end` | Ordered turn/step numbers, matching open owners, no overlapping turn/step, and no unresolved advertised or started tool call at a closing boundary. Unfinished tails remain open. |
| `assistant/message`, `tool/call`, appended `tool/result` | Match an open step; advertised call ids are unique, starts retain name/arguments, and results settle one advertised call. A result before its start requires the exact admitted `TOOL_NOT_STARTED` repair. Tool-result surface replacements require an open turn instead of replaying the original call lifecycle. |
| `system/message`, `developer/message`, `assistant/attempt` | Match an open turn and step. Request headers and contexts require an open turn. |
| `tool/ptc-dispatch-start`, `tool/ptc-dispatch` | Require an open turn, unique sub-call start and settlement, stable root/parent/name/arguments, and a nested parent belonging to the same root. |
| `llm/retry`, `llm/retry-started` | Match the current request provider and turn/step, sequential attempts per policy chain, stable retry identity, and one start matching a prior scheduled attempt. |
| `session/title`, `session/title-llm-request` | Cite distinct earlier human `user/message` events. User-assigned titles have no citations; other titles have citations. An LLM title request has nonempty citations and one user-role text message sourced from `dsh-session-title-llm`. |
| `command/run`, `command/done` | Run ids are unique; completion has a prior run. A present completion `sourceEventSeq` names an earlier non-command event and accompanies success. |
| `compaction/start`, `compaction/summary`, `compaction/end` | Match compaction id, source command, and the active turn context. Summary spans name exact current-surface nodes and exclude the protected head; successful completion has one summary. Inherited unfinished compactions expire at the end-seed marker. |
| `compaction/prune` | Its span names exact current-surface nodes and excludes the protected head; it does not require a compaction transaction or its owner fields. |
| Compact checkpoint replacement | Its `compact-checkpoint` source identifies the active compaction. |
| Native `subagent/catalog` | Validates own version-0/version-1/version-2 payloads after the inherited cut. Each child id must be unique. Native reads neither collect child logs nor compare their physical facts; inherited entries do not establish own membership. |
| Inherited cut and delivery | Apply the marker, coordinate, and generation-ownership rules stated above. |

These checks are generation-owned in [relationships.ts](src/relationships.ts). Full common message/envelope acceptance and plugin-owned message projections additionally use the installed Session; the exported V4 restorer alone is not a replacement for complete catalog restoration.

<a id="developer-changes"></a>
### Developer changes and deferred schemas

The edge does not create developer history. Native `developer/message` requires positive turn/step coordinates, role `developer`, a nonempty message id, array content, and producer-owned source metadata. Each `tool-addition` or `tool-removal` block requires a nonempty `toolName`. Additions reject any own inline `tool` field, including values that would otherwise be optional JSON metadata.

An event containing additions must have `headerSeq`; it selects an earlier known `request/header` for all additions in that event. Each name must match exactly one definition there with string `description` and object `parameters`. Missing, forward, wrong-type, unknown, ambiguous, and incomplete bindings are refused. Events without additions must omit `headerSeq`; `sourceEventSeqs` remains independent derivation/replacement metadata. Replacement, fork, restart, and compaction retain the recorded binding rather than consulting the current registry or latest header.

Tool-change blocks in ordinary messages, inbox/title input, compaction summary/raw output, or embedded assistant block-start/block-end records are refused. A present `request/header.header.tools[].deferLoading` must be exactly true; it is independent of whether any developer addition exists. Empty developer nodes retain surface positions, produce no model message, and cannot replace the protected system head. Unknown ignorable developer payloads are deferred until the reader knows that event type.

Native format support does not enable automatic emission, provider tool loading, or UI rendering. Current provider and UI consumers explicitly refuse developer history they cannot represent. Backward-compatible consumer support for the already accepted representation is separate from adding a new format.

<a id="fork-results"></a>
### Fork-generated results

Fork seed construction belongs to core Session, not this migration. Native V4 admits its synthetic `TOOL_NOT_STARTED` error results with ids `forked-tool-result-<callId>-<seq>`, role `tool`, matching source/call ids, `isError: true`, `ToolNotStartedError`, and one text block. Append results carry their own sequence and no source references; later replacements retain an earlier suffix and cite exactly that original result. The branch-specific text is retained, not normalized to crash-recovery wording.

Started fork calls use `TOOL_OUTCOME_UNKNOWN` error results and retain their recorded start references. They follow ordinary started-call validation; the special not-started identity rules above do not apply to them. Fork construction closes its open tail with `turn/end.reason.kind: 'forked'` and leaves completed earlier steps and turns unchanged.

The ordinary interrupted not-started repair retains its canonical historical integer suffix and exact crash-recovery text. Both forms must settle an advertised call under the lifecycle rules. The stage preserves existing fork/call/message ids; it does not infer ancestry from their string prefixes or execute a tool.

<a id="native-recovery"></a>
### Validation entry points and recovery

| Entry point | Checks and limits |
|---|---|
| V4 codec decode | Released physical framing plus V4 row admission. Required predecessor PTC tags, retired system headers, and owned malformed native fields are refused before recoverable suffix suppression. |
| V4 codec encode | The same native row checks; ignorable developer payloads are still validated by the writer. |
| Native catalog, `validation: 'transformed'` | Codec checks only; skips artifact restoration because no migration ran. This is not full native validation. |
| Historical catalog, `validation: 'transformed'` | Conversion followed by generation-owned V4 restoration; skips installed common Session validation. |
| Catalog, `validation: 'current'` | Generation-owned V4 checks plus installed current Session header, envelope, message, surface, and projection validation. Use strict recovery for fixtures and publication verification. |
| Native JSONL scanner | Supplies installed vocabulary to row admission before recovery and applies mandatory V4 relationships before exposing the accepted prefix. |

Unknown required events are refused by vocabulary-aware restoration. Unknown ignorable payloads remain uninterpreted; required `tool/code-dispatch-start` / `tool/code-dispatch` are refused as retired syntax, while ignorable predecessors stay opaque. The physical decoder defers ignorable developer payloads when vocabulary is absent; a native reader that knows developer events must validate them before accepting a recoverable suffix. Only accepted inherited markers establish the cut.

-----

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

- **Historical converter coverage** — Unsupported source forms may fail without publishing a successor or changing the source. First-party recordings do not enumerate third-party extensions. Later converter fixes may add support after V4 publication if their V4 output remains compatible. Interpreting extra stream-start fields and preparing future delivery generations require a concrete format change.
- **Accepted V4 transition** — the [checkpoint](../../../docs/session-format-status.md#finalization-record) protects the accepted history. Backward-compatible additions can remain V4 through new acknowledgements; breaking changes require a successor. Already-written V4 files do not rerun this incoming edge, and historical inputs remain intact.
- **V5 prerequisite readers** — V4 child evidence currently goes through the installed catalog. A future writer must bind fixed-generation V4 prerequisite reading before changing that catalog. The exported V4 restorer supplies generation-owned checks; full common message admission additionally uses installed Session validation.
- **Nested historical tool results** — migration currently refuses results containing another tool-result wrapper. The original generation remains intact and no V4 successor is published. A later converter may support evidenced source cases without changing the established V4 format; the [migration cookbook](../../../docs/cookbook/adding-a-session-format-version.md#stages-and-validation) defines that distinction.
- **Historical extension consumers** — prefixed message and result fields preserve JSON data without activating core fields. A consumer must explicitly understand those fields before interpreting them.
- **Retained child logs required** — a parent alone cannot recover unrecorded child ids, creation times, or descriptors. Deleted children cannot be reconstructed from tool arguments; existing parent catalog records remain.
- **Unknown historical modes** — without exactly one supported own descriptor, a missing parent entry records unknown mode. Current reads do not rewrite that entry; opening the child resolves available descriptor information or reports its own error.
- **Storage scope** — facts cover recognizable children within the same persistence root. Cross-root import and corrupt-log repair are outside this migration.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
