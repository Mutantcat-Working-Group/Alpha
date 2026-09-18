---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-16-session-format-v4

English | [中文](2026-09-16-session-format-v4.zh.md)

## Summary

Advances the declared SessionHeader.version from 3 to 4 for the V4 integration writer, records first-class tool-role results, and adds the forked variant to turn/end.reason.

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
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-14-image-offload"
    after: "cbe418d5a3727fbd3599f90101680dae254ac1d6163b1b8b2ca30f28afb5212a"
    decision: version-bump
  - root: "event:assistant/attempt"
    previous: "2026-09-14-image-offload"
    after: "2f1565d92801f4334f8dc34fbb980890eef621e81a7c90ed0fd8d0a6db2ec3b2"
    decision: version-bump
  - root: "event:assistant/message"
    previous: "2026-09-14-image-offload"
    after: "f219a9f66fcc92ffec27bbd96fa21ffc2cffbaf2ad1de05757ec37205b1a0b58"
    decision: version-bump
  - root: "event:compaction/summary"
    previous: "2026-09-14-image-offload"
    after: "86c1ee9c8ab6c6e160d4ccc00b3d9ad5a6c687938b552d55eec528279baa1559"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-09-14-image-offload"
    after: "2a47ef7025d7dcf7e9977aadd738e7408a210b101a7dbbd37f4d87f22166eff0"
    decision: version-bump
  - root: "event:system/message"
    previous: "2026-09-14-image-offload"
    after: "1772581b17e1fab970fda49f04ffae2a181b7992ca4efa63bffe5f8b2bd62300"
    decision: version-bump
  - root: "event:team/message/queued"
    previous: "2026-09-14-image-offload"
    after: "9a25c2e889855516a531dc906905ec1d88157f7c2651aed27ac4f754bb128240"
    decision: version-bump
  - root: "event:tool/ptc-dispatch"
    previous: "2026-09-14-image-offload"
    after: "75f1d59512dd2e6468bed27c6203a721b116ef7869e291e3fee34c977d013185"
    decision: version-bump
  - root: "event:tool/result"
    previous: "2026-09-14-image-offload"
    after: "f4c6f3eae6607f412a9023406c8c3bd351a02451848bb78c2436f409447dd60c"
    decision: version-bump
  - root: "event:turn/end"
    previous: "2026-09-14-image-offload"
    after: "0f8512903d94f57a4748fa1a2092e64342856796684e6b8343db685b192745ce"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-09-14-image-offload"
    after: "5274b395e7bf6660d020fba7e29a1e20ef2e77097fd7597e9debb13e45c540d6"
    decision: version-bump
```

<a id="compatibility"></a>
## Compatibility

The tool-role declaration changes ten event roots because inbox entries, message events, compaction summaries, title requests, team messages, and PTC dispatches embed the shared `Message` or `ContentBlock` declarations. Removing `tool-result` from that union and specializing message roles changes those reachable schemas without adding ten independent event protocols. The `turn/end` change separately records the forked reason; `SessionHeader` records the version increase.

The [native V4 validation decision](../../.agents/notes/implemented/architecture/2026-09-17-native-v4-read-validation.md) owns the reader admission required by these current fields.

The V3-to-V4 migration lifts released user-role tool results into tool-role messages with a required toolCallId and optional isError. Tool-result wrappers leave the content-block union. The migration preserves every admitted source event and inherited cut, and appends missing parent subagent/catalog records from retained direct-child logs in the same persistence root. Historical body restoration requires an explicit child-evidence set, including an empty set when no children are available to backfill. Missing required descriptors or conflicting identities refuse migration without publication; existing catalog facts remain. Historical read opens prepare the result in memory. Write opens revalidate child membership and revisions before publishing the current successor beside unchanged predecessor files. Delivery-generation checks keep historical acknowledgements from becoming active V4 watermarks. V3 readers refuse the newer generation. The same unreleased transition adds forked to turn/end.reason; exact-cut forks append child-owned error results and closers after the inherited marker. V4 admits checked not-started fork results with deterministic branch-specific IDs and wording; released V0–V3 validators and recorded predecessor generations remain unchanged.

<a id="verification"></a>
## Verification

The focused Session, agent-loop, Session Controller, V4, chat-view, and compaction suites passed 1,523 tests across 63 files after integration of exact-cut forks. V4 fork tests retain original IDs and text across encoding, decoding, and restoration, reject malformed results, and validate nested inherited cuts. The tool-role migration tests and SDK snapshot refresh also passed in the originating change; the built Python runtime sdk-snapshot scenario passed, and focused pi-ai and auto-review coverage passed 351 tests with 100% coverage of the three affected modules.

<a id="dev-note"></a>
## Dev Note

None.
