<div align=center>
<img src="./icon.png" style="width:100px;" width="100"/>
<h2>Alpha</h2>
</div>

[中文](README.md) | English

Alpha is an open-source AI code editor derived from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It follows an **everything-is-a-plugin** architecture powered by [Cordis](https://github.com/cordiverse/cordis); the desktop, Web, and CLI entry points share one agent core, one session format, and one plugin graph.

### 1. What it does

- The desktop (Electron), Web, and CLI entry points share one agent core, one session format, and one plugin graph, so a plugin is written once and loads on all three.
- The installers bundle independent Python, Node.js, and pnpm runtimes. Python data processing, Office document read/write, and Node scripts work on first use without anything from the user's system environment.
- Terminal, SSH, subprocess, sandbox, LSP, browser, and computer interaction ship as plugins that start and stop on demand.
- Sessions are written to disk end to end and replayable: every input that reaches a model request can be reconstructed from the session log, which makes audits and reproductions possible.
- GitHub Actions builds the three-platform installers when a release is published. Windows emits an NSIS installer, macOS emits an ad-hoc signed DMG for each of Apple Silicon and Intel, and Linux emits an AppImage.
- The application ID is `org.mutantcat.alpha`, and data stays under `$DSH_HOME`, so upgrading keeps existing profiles.

### 2. Installation
<a id="run"></a>

1. Download the installer for your platform from [Releases](https://github.com/Mutantcat-Working-Group/Alpha/releases). Double-clicking it installs and runs Alpha with no further configuration.
2. To try the Web edition only, install Node.js and run `npx @deepseek-ai/dsh web`, which serves `http://127.0.0.1:3080` by default; `--no-open` starts the server without opening a browser.

<a id="run-from-source"></a>

3. Running from source needs Node.js `^22.19` or `>=24` plus pnpm: `pnpm install`, `pnpm run build`, then `pnpm dsh web`.
4. To package one platform yourself, run `pnpm run package:ci:<target>` inside `apps/desktop`, where `<target>` is one of `mac:arm64`, `mac:x64`, `win:x64`, `linux:x64`, or `linux:arm64`. Artifacts land in `.desktop-build/targets/<target>/artifacts/`.

### 3. First steps

1. Describe a task in the input box after the first launch. The agent plans, calls tools, and reports back; running tasks, queued input, and background jobs all raise an interruption warning in the restart confirmation.
2. The account row at the bottom left reports update status and can check on demand. The desktop edition downloads and installs automatically.
3. When scripts or data processing are needed, the agent uses the bundled Python runtime directly, with no interpreter or pip environment to prepare.
4. See the [Web UI guide](docs/user/guide/index.md), the [architecture documentation](docs/architecture.md), and the [development guide](docs/development.md) for detail.

### 4. Plugins and compatibility

- Alpha keeps the DeepSeek Harness plugin protocol intact. Repositories under the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic keep loading and running, and their configuration needs no rewrite.
- Plugins register contributions through `ctx.effect()` and `ctx.on()`; the value returned by `register()` is the disposer. New capability belongs on an existing extension point, not in the agent loop.
- Runtime self-modification and the Claude Code / Codex bridges are preserved, so existing use of the `extensions` and `hooks` packages is unchanged.
- Plugin manifests stay in `cordis.yml`; a bare plugin name must appear in the `dependencies` of the resolver manifest that loads it, or loading fails outright.
- The conventions in `AGENTS.md`, `docs/`, and `.agents/` bind plugin authors too. Read [AGENTS.md](AGENTS.md) before contributing.

### 5. What it optimizes for

- Let plugins decide the agent's capability boundary instead of special cases in the main loop.
- Make every model request reconstructable from the session log, so behavior stays auditable, replayable, and reproducible.
- Ship Python, Node, and the package manager inside the installer, moving environment preparation from the user to the release.
- Build all three platforms on one pipeline, with the signing strategy stated per target rather than discovered from certificates.
- Fail misconfiguration at load time instead of skipping it silently at run time.

### 6. Progress

- [X] Desktop shell and Web client
- [X] Bundled Python / Node.js / pnpm runtimes
- [X] Three-platform CI installers (Windows NSIS, macOS DMG, Linux AppImage)
- [ ] Automatic update channel (current release artifacts are credential-free builds and do not use the Nightly feed)
- [ ] Plugin marketplace and one-click install

## Community and support

- Send feedback and bug reports through [GitHub Discussions](https://github.com/Mutantcat-Working-Group/Alpha/discussions).
- Tag plugin repositories with [`dsh-plugin`](https://github.com/topics/dsh-plugin) so others can find them.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Agent participants follow [AGENTS.md](AGENTS.md).

## Safety

Read [SAFETY.md](SAFETY.md) before running the project.

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
