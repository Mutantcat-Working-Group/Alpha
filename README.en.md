<div align="center">
<img src="./icon.png" style="width:100px;" width="100"/>
<h2>Alpha</h2>
</div>

[中文](README.md) | English

### 1. Overview

- Alpha is an open-source AI code editor built on an **everything-is-a-plugin** architecture powered by [Cordis](https://github.com/cordiverse/cordis).
- The desktop (Tauri), Web, and CLI entry points share one agent core, one session format, and one plugin graph, so a plugin is written once and loads on all three.
- The installers bundle independent Python, Node.js, and pnpm runtimes. Python data processing, Office document read/write, and Node scripts work on first use without anything from the user's system environment.
- Terminal, SSH, subprocess, sandbox, LSP, browser, and computer interaction ship as plugins that start and stop on demand.
- Sessions are written to disk end to end and replayable: every input that reaches a model request can be reconstructed from the session log, which keeps audits and reproductions possible.
- The application ID is `org.mutantcat.alpha`, and data stays under `$DSH_HOME`, so upgrading keeps existing profiles.
- **Publisher** Mutantcat Working Group (mutantcat.org) · GitHub: https://github.com/Mutantcat-Working-Group

Core value:

- Let plugins decide the agent's capability boundary instead of special cases in the main loop.
- Make every model request reconstructable from the session log, so behavior stays auditable, replayable, and reproducible.
- Ship Python, Node, and the package manager inside the installer, moving environment preparation from the user to the release.
- Build all three platforms on one pipeline, with the signing strategy stated per target.
- Fail misconfiguration at load time instead of skipping it silently at run time.

### 2. Features

#### One core, three entry points

- Desktop, Web, and CLI share one agent core and one session format.
- Describe a task and the agent plans, calls tools, and reports back; running tasks, queued input, and background jobs raise an interruption warning on restart.

#### Bundled runtimes

- Python, Node.js, and pnpm ship inside the installer; no interpreter or pip environment to prepare.
- The desktop edition shows update status and supports automatic download and restart-to-install.

#### Auditable sessions

- Sessions persist end to end, every model-visible input has a matching log event, and the result is replayable and reproducible.
- Any input that reaches a model request can be reconstructed from the session log for audits and debugging.

### 3. Installation & Downloads

1. Desktop: download the installer for your platform from [Releases](https://github.com/Mutantcat-Working-Group/Alpha/releases); double-clicking it installs and runs Alpha with no further configuration. Windows emits an NSIS installer, macOS emits an ad-hoc signed DMG for each of Apple Silicon and Intel, and Linux emits an AppImage.
2. Web: install Node.js and run `npx @mutantcat/alpha web`, which serves `http://127.0.0.1:3080` by default; `--no-open` starts the server without opening a browser.
3. To run from source or package installers yourself, see section 7.

<a id="run"></a>

### 4. Quick Start

1. Describe a task in the input box after the first launch; the agent plans, calls tools, and reports back.
2. The account row at the bottom left reports update status and can check on demand. The desktop edition downloads and installs automatically.
3. When scripts or data processing are needed, the agent uses the bundled Python runtime directly.
4. See the [Web UI guide](docs/user/guide/index.md), the [architecture documentation](docs/architecture.md), and the [development guide](docs/development.md) for detail.

### 5. Plugin Ecosystem & Compatibility

Alpha does not rebuild the plugin ecosystem; it wires the existing ones in. Every entry below is a bridge that actually exists in this repository, and each one can be mounted or left out on its own.

- **DSH plugin protocol**: the plugin protocol and manifest conventions are intact, so repositories under the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic keep loading without a configuration rewrite. The `dsh.bundle`, `dsh.profile`, and `dsh.client` manifest fields in `package.json` are unchanged.
- **Claude Code**: the subagent bridge (`@mutantcat/dsh-subagent-claude-code`) runs tasks through Claude Code, the hooks bridge (`@mutantcat/dsh-hooks-claude-code`) takes over its hook protocol, skills are read from `~/.claude/skills`, and `CLAUDE.md` is treated as an instruction file just like `AGENTS.md`.
- **Codex**: the subagent bridge (`@mutantcat/dsh-subagent-codex`) runs tasks through Codex, the hooks bridge (`@mutantcat/dsh-hooks-codex`) takes over its hook protocol, and skills are read from the `skills` subdirectory of `$CODEX_HOME` or `~/.codex`.
- **ACP (Agent Client Protocol)**: arbitrary clients reach Alpha through `@mutantcat/dsh-subagent-acp`; in the other direction the `acp` profile ships an ACP server that any ACP client can drive.
- **MCP (Model Context Protocol)**: `@mutantcat/dsh-mcp-client` registers external MCP server tools and resources onto `ctx.tools`, one configuration entry per server, with no server enabled by default. `@mutantcat/dsh-mcp-resources` owns shared resource discovery and reading.
- **Skills**: local skills come from `<projectRoot>/.dsh/skills`, custom `customSkillDirs`, and the Codex and Claude Code user roots above. Both directory bundles with `SKILL.md` and flat `<name>.md` files are parsed, the roots are watched, and additions, removals, and edits reach the session catalog without a restart.
- **Office document skills**: `@mutantcat/dsh-skill-office` provides Word, PowerPoint, and Excel authoring, structural checks, and delivery, running on the bundled Python environment by default.
- Plugins register contributions through `ctx.effect()` and `ctx.on()`; the value returned by `register()` is the disposer.
- Runtime self-modification (`extensions`) is preserved and unchanged.
- Plugin manifests stay in `cordis.yml`; a bare plugin name must appear in the `dependencies` of the resolver manifest.
- Plugin authors follow the conventions in [AGENTS.md](AGENTS.md), `docs/`, and `.agents/`.

### 6. Progress

- [X] Desktop shell and Web client
- [X] Bundled Python / Node.js / pnpm runtimes
- [X] Three-platform CI installers (Windows NSIS, macOS DMG, Linux AppImage)
- [ ] Automatic update channel (current release artifacts are credential-free builds and do not use the Nightly feed)
- [ ] Plugin marketplace and one-click install

<a id="run-from-source"></a>

### 7. Build from Source & Packaging

1. Running from source needs Node.js `^22.19` or `>=24` plus pnpm: `pnpm install`, `pnpm run build`, then `pnpm alpha web`.
2. To package one platform yourself, run `pnpm run package:ci:tauri:<target>` inside `apps/desktop`, where `<target>` is one of `mac:arm64`, `mac:x64`, `win:x64`, `linux:x64`, or `linux:arm64`. Artifacts land in `.desktop-build/targets/<target>/artifacts/`.

### 8. Community

- Type `/feedback` in a session, or rate any reply thumbs up/down and fill in a category with details; feedback is recorded with that conversation log.
- Tag plugin repositories with [`dsh-plugin`](https://github.com/topics/dsh-plugin) so others can find them.
- Agent participants follow [AGENTS.md](AGENTS.md).

### 9. Safety & License

- Read [SAFETY.md](SAFETY.md) before running the project.
- The project is open source under the [MIT](LICENSE) license.
- Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## Acknowledgements

Thanks to the [Cordis](https://github.com/cordiverse/cordis) community and every developer who contributed to this project. Alpha builds on the open-source ecosystem and continues to evolve independently.
