---
description: "Import-sessions Settings page for the alpha web client: one dropdown of the Agent session stores installed on the Host machine, one explicit Import action, and a per-session result list."
kind: "package-reference"
---

# @mutantcat/dsh-client-ui-settings-import-sessions

English | [中文](README.zh.md)

## Summary

The **Import sessions** Settings page brings other Agents' chat history into Alpha. Opening the page asks the Host which Agent session stores this machine has installed and lists them in one dropdown, Alpha's own store first, so only detected installations appear. Picking an entry and pressing **Import** runs one import from that store. Afterwards it lists one row per discovered session — imported, already present, or refused with the Host's reason — plus a count summary. Nothing runs until the button is pressed: there is no watcher, no polling, and no background sync.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open Settings and select **Import sessions**, pick the Agent whose history you want, then press **Import**. Mount `@mutantcat/dsh-client-ui-settings-import-sessions` in a Web composition that already provides the settings shell, the locale runtime, and a plugin publishing the `harnessSessionsImport` service; the page registers its own navigation entry and needs no configuration of its own.

### Choosing the source Agent

The dropdown names the Agent session stores installed on the machine the Host runs on, discovered under the user's home directory. Alpha's own entry reads the deployment-configured Harness sessions root, which defaults to the official DeepSeek Harness home's `sessions` directory, so a configured root outside that default stays the one this import opens. The foreign entries cover the layouts those Agents write — Codex's `~/.codex` directory, Claude Code's `~/.claude/projects`, and ZCode's `~/.zcode` directory — and each appears only while its installation is present, so a store that is not installed is never offered. The page is read-only over every store it opens: it copies what it adopts into Alpha's own store and never moves, rewrites, or deletes anything there.

### Reading the results

Each row names the session by its Alpha identifier when it was adopted, or by its source path when it was refused, and shows one of three statuses. **Imported** means this run copied it into Alpha. **Already present** means the session's identity is already in Alpha's store, so this run left it untouched. **Refused** means the session could not be read or validated; the Host's reason appears on the row and every other session in the same run still imports. The page re-pulls the Session list after a successful call, so adopted sessions appear in navigation without a manual refresh.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The page is one localized `settings.section` contribution with id `import-sessions` ordered right after the archived-sessions page; the Settings shell owns the navigation entry, the modal, and the mounted section, so none of that chrome lives here.

### Registration and data sources

`apply()` registers the locale namespace, binds it, and uses `ctx.slots.inject()` to contribute the section, so a late or restored slot declaration still reaches it. The registration closes over `ctx.harnessSessionsImport`: `sessionSources()` lists the installed Agents and the root each one reads, and `importSessions()` runs the import and refreshes the Session list. The page owns no store, no transport, and no refresh logic of its own; it holds the discovered Agents, the picked root, the in-flight state, and the last result as component-local state.

### Failure handling

A rejected discovery read or a rejected import call renders the failure message and returns the page to an idle, usable state, so the user can pick another Agent and try again. Per-session refusals are data, not errors: they arrive inside the successful result and never abort the run.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host loader entry: the page is browser-only, so the plugin body is empty |
| [`src/client/index.ts`](src/client/index.ts) | Browser plugin: locale namespace, section registration, injected discovery and import calls |
| [`src/client/ImportSessionsSection.tsx`](src/client/ImportSessionsSection.tsx) | The page component: source-Agent dropdown, Import action, progress, result rows |
| [`src/client/locales.ts`](src/client/locales.ts) | Chinese and English dictionaries for every visible and accessible string |
| [`src/client/ImportSessionsSection.module.css`](src/client/ImportSessionsSection.module.css) | Page styles |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the operation behind the button, the store it writes to, and the format it migrates from.

- [Session Controller](../../api/session-controller/README.md) — the `session.importHarnessSessions` and `session.harnessSessionSources` Remotes, the `harnessSessionsRoot` Config field, and the client `harnessSessionsImport` face this page reads.
- [session-persistence-jsonl](../../session/session-persistence-jsonl/README.md) — the read-only foreign sessions-root reader that discovers and restores source generations.
- [Session subsystem](../../../docs/subsystems/session.md) — the durable Session store the adopted sessions land in.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define how this page adopts history; they are current package constraints.

- **The import runs only when the user asks** — the page never watches, polls, or synchronizes the source directory, so a Harness session written after a run needs another explicit Import.
- **A run reports per-session outcomes, not a single verdict** — one unreadable or corrupt source session is refused with the Host's reason while its siblings still import, so a partial success is normal and is never presented as a total failure.
- **The source directory is never modified** — Alpha copies what it adopts, so archiving, deleting, or re-formatting the source remains entirely the Harness installation's concern.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. A browser-side settings page that registers one localized `settings.section` contribution and its locale namespace; it emits no Cordis events and owns no cross-plugin mutable relation.
