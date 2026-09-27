# Alpha Desktop

English | [中文](README.zh.md)

Alpha is a Tauri shell around the complete dsh Web application. The shell window opens on a packaged loader page, starts a bundled Node sidecar that runs the private Desktop Host, and navigates to the Host's URL once that Host reports readiness. Desktop defaults to port `19387`, separate from Web's `3080`; a `webserver.config.port` patch can override it. The product name, version, and application identifier live in [tauri.conf.json](src-tauri/tauri.conf.json), and every release family shares that one version string.

## Shell boot

The Host is a Node sidecar launched without a child-process IPC channel, so it reports readiness and accepts commands as newline-delimited JSON on stdout and stdin. The Host argv names the staged runtime directory, the per-user application data directory as its working directory, the primary runtime, the resolution mode `runtime`, the bundled pnpm entry, and the private Node bin directory. Bundled applications carry the sidecar as `Contents/MacOS/node` and the staged payload under `Contents/Resources/runtime`; `resolve_launch` in [lib.rs](src-tauri/src/lib.rs) locates both and `node_sidecar` accepts the per-target file suffix a development build leaves behind.

Boot proceeds in a fixed order. The main window opens on the packaged loader page. The host reader waits for a `ready` event carrying the engine URL and boot injections, or for a `fatal` event carrying the cause. On readiness the shell publishes the boot payload to a window slot and to the current document, waits until the engine port accepts TCP connections, then navigates the window to the engine URL. Every document in the window also receives an initialization script that installs the `dshDesktopBoot` bridge and its readiness gate, and the page-load hook publishes the held payload again into any document that loads later. The Web client awaits `dshDesktopBoot.ready()` before it starts and reports its own boot failures through the `alpha-boot-failed` window event, which the shell presents outside the Web page.

A host that exits before reporting readiness, an engine port that still refuses connections after readiness, or a readiness event without a boot payload keeps the loader visible and opens one native dialog naming the cause. The shell exits once that dialog is dismissed, because nothing recovers a dead engine. A white window with no content is not a reachable state: the loader stays until the engine answers or the failure is reported.

Window close requests send `{"type":"shutdown"}` on the host's stdin and wait up to ten seconds before killing the process. The single-instance guard focuses the existing window instead of starting a second process, so two Alpha processes never race on one profile.

A host an earlier launch left running owns the engine port, so a new host takes the profile directory over before booting. It reads the `host.pid` it writes into that directory, stops a live former host with `SIGTERM`, waits up to five seconds, then `SIGKILL`, and continues once the process or the port is gone. The port is the ownership signal: a former host whose shell died before reaping it stays as a zombie entry, and a zombie holds no listener. A former host that survives the forced stop fails the launch with its process id named, rather than racing it on the port. The Host also initializes the profile directory before loading it, writing the manifest, the user patch layer, and the pnpm workspace settings when they are absent; existing files are never touched.

## macOS code signing

The bundled Node engine runs V8 and cannot start under the macOS hardened runtime without JIT permissions. [entitlements/alpha.plist](src-tauri/entitlements/alpha.plist) grants the JIT, unsigned-executable-memory, executable-page-protection, library-validation, and dyld-environment permissions, and `bundle.macOS.entitlements` points the Tauri bundler at it. The bundler applies that plist to every Mach-O file it signs, including the Node sidecar: a sidecar that keeps its own release signature loses these entitlements during the ad-hoc re-sign and traps immediately, which is why the plist is mandatory rather than optional.

Release builds are ad-hoc, because hosted runners carry no signing identity. macOS builds pass the `-` identity to codesign and additionally sign the finished DMG, and the workflow verifies that signature before upload. Windows and Linux artifacts stay unsigned. Gatekeeper therefore asks the user to confirm the first launch of the macOS application, through the context menu's Open item or by removing the quarantine attribute with `xattr -dr com.apple.quarantine <path>`; Windows shows the SmartScreen prompt on unsigned installers.

## Bundled runtime payload

Desktop carries independent Python, Node.js and pnpm distributions. Python includes numpy, pandas, python-docx, python-pptx, openpyxl, Pillow, lxml and XlsxWriter with their complete dependencies. The `load_workspace_dependencies` tool installs this payload offline on first use under `$DSH_HOME/dsh-runtimes/dsh-primary-runtime` (normally `~/.dsh/dsh-runtimes/dsh-primary-runtime`) and returns absolute interpreter, pnpm script and library paths plus `pythonDistributions`, the bundled distribution names and versions. The version report excludes user-installed additions. Office tasks prefer these libraries unless user or workspace instructions select another environment. Execute the pnpm script with the returned Node executable. The returned Node library directory is reserved for bundled libraries, not pnpm's global installation directory.

Desktop registers `office-docx`, `office-pptx`, and `office-xlsx` by default. The skills use the bundled Python libraries for creation and focused edits, then reopen the files and run a shared structural checker before delivery. PowerPoint creation and editing use python-pptx. Skill resources are staged under `runtime/office-skills` outside the application executable so Python can read the checker. An available `render_document` tool can add visual inspection; its absence does not prevent authoring or delivery. See the [Office skill package](../../packages/skill/skill-office/README.md) for checks and limitations.

The payload follows the Desktop release. `versions.json` records the component and Python distribution versions and the payload identity of the prepared runtime. Matching installations are reused; a dependency change replaces the directory. The payload is staged into the bundle by [prepare-tauri-runtime.ts](scripts/prepare-tauri-runtime.ts), which rejects a sidecar whose Node major version differs from the interpreter that prepared the runtime.

The private Desktop `runtime/bin` directory is added only to package-installation processes, not the Host PATH inherited by PTC and agent shells. This tool does not change PATH, environment variables or user package-manager configuration. pnpm retains its own defaults and user settings for global packages, executable entries and its store, including native errors when the environment does not support global installation. There is no separate dependency updater. [The primary-runtime decision](../../.agents/notes/implemented/feature/2026-09-14-desktop-primary-runtime.md) records these choices.

## Icons

The original artwork lives in the repository root `icon.png`; the platform files under [src-tauri/icons](src-tauri/icons) are exported from it. macOS uses `icon.icns`, the Windows application and installer use `icon.ico`, and the Linux AppImage uses `icon.png`. Tauri generates the remaining platform sizes from these sources during the build.

## Key decisions

| Decision | Why | Direct consequence |
| ---|---|---|
| Release identity | The shell API, Web client, backend, and plugin graph are qualified as one combination; independent versions would create untested combinations and ambiguous update availability. | Alpha and `@mutantcat/dsh` always carry the same exact version. A dsh upgrade is a Desktop release, even when the shell code is unchanged. |
| Runtime | The application must run without a system Node.js or pnpm installation. | The bundled Node sidecar runs the Host with `--expose-internals`, and every package operation uses the bundled pnpm. |
| Package sources | Core installation at startup adds work even when offline. | The staged runtime carries a complete production dependency tree; the profile installs only external plugins. |
| State ownership | Sharing executable dependency graphs would let CLI and Desktop change each other's dsh, Cordis, plugin, or native-module versions, while two desktop processes could race on the same profile. | Alpha acquires its process-lifetime single-instance lock before any profile access and exclusively owns its application data directory, which is also the profile root, plus its package-manager state. CLI and Desktop share supported product data under `$DSH_HOME`, but never executable packages, plugin activation, lockfiles, or `node_modules`. |
| Transport | Web serving and authentication share one implementation. | The shell loads the packaged Web assets for its loader page only; the Host supplies the engine document and authenticated APIs. |

## Installation ownership

Alpha owns its application data directory, which doubles as the profile root: `~/Library/Application Support/org.mutantcat.alpha` on macOS, `%LOCALAPPDATA%\org.mutantcat.alpha` on Windows, and `~/.local/share/org.mutantcat.alpha` on Linux. Its `dependencies` contains packages installed by pnpm; `dsh.profile.bundles` contains the built-in bundles followed by enabled plugins. The staged runtime supplies dsh, the private Desktop Host, and their production packages. Packaged applications select runtime profile resolution without creating package links; development profiles use filesystem links. The host and plugins execute in the Node sidecar process; no renderer receives filesystem access, raw Tauri IPC, a shell, or arbitrary pnpm arguments.

The product UI retains Web actions, including "Open In..." through the shared authenticated HTTP routes. Plugin management uses the Web application's authenticated HTTP APIs against the Desktop profile, and the shell exposes no separate plugin-management IPC. Native directory selection is the one desktop-side interaction: it opens the platform chooser attached to the application window and returns a single path.

### Plugin activation

1. The loader window shows the packaged loading page before the Host starts.
2. Desktop removes profile copies and fallback links for packages listed by the prepared runtime before Host startup, then discards the lockfile when cleanup changes package state. Other plugin files, configuration, and versions remain.
3. Changes to the Node version, platform, or architecture preserve installed plugins. Native incompatibilities surface during loading and can be repaired through pnpm.
4. The main application's Plugins page uses the shared [plugin manager](../../packages/boot/plugin-manager/README.md) against the Desktop profile, with the bundled pnpm under normal user and profile configuration.
5. The shared manager owns installation errors, activation, and restart requirements. Native recovery can disable third-party bundles even when the Host cannot start.

Fatal startup opens one native dialog naming the cause; there is no automatic plugin-recovery transaction and no startup timeout heuristic. A failure dialog naming a former host process means a leftover host refused the stop request; quitting Alpha and ending the stale sidecar clears it.

## Develop

The complete release chain prepares the monorepo first, then stages the runtime, and finally invokes the Tauri bundler:

```sh
pnpm --dir apps/desktop run package:ci:tauri:mac-arm64
```

That command runs the shared preparation (`build:official`, both package families, the primary runtime, the entry pack, and the payload staging) before `tauri build --target <triple> --bundles <dmg|nsis|appimage>`. Staging without bundling is available for inspection:

```sh
pnpm --dir apps/desktop run prepare:tauri-runtime
```

To exercise one bundle directly against the staged payload, run the Tauri CLI from `apps/desktop` with the ad-hoc signing environment:

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false APPLE_SIGNING_IDENTITY=- pnpm exec tauri build --target aarch64-apple-darwin --bundles app
```

On macOS a local DMG build prepends [scripts/dmg-tools](scripts/dmg-tools) to `PATH`. Its `hdiutil` shim retries a failed volume detach with `-force`: an interactive Finder session can hold the mounted image while create-dmg's own retries run out, and hosted runners detach on the first attempt and pass every command through.

## Package

`.github/workflows/release-app.yml` attaches installers to a published GitHub release; publishing a release starts one job per target, and `workflow_dispatch` names the receiving tag explicitly. Each job runs `package:ci:tauri:<target>` ([ci-tauri-package.ts](scripts/ci-tauri-package.ts)), which repeats the shared preparation, stages the target's Node sidecar and runtime payload, builds one bundle kind through the Tauri bundler, copies the artifact under the release asset name, and writes a `.sha256` sidecar beside it. The job refuses a target whose platform differs from the build host, and uploads with `gh release upload --clobber` so a re-run replaces the assets it already attached instead of failing on a duplicate name.

| Target | Runner | Rust triple | Bundle | Release asset |
| ---|---|---|---|---|
| `mac-arm64` | `macos-14` | `aarch64-apple-darwin` | ad-hoc DMG | `Alpha-<version>-arm64-mac.dmg` |
| `mac-x64` | `macos-15-intel` | `x86_64-apple-darwin` | ad-hoc DMG | `Alpha-<version>-x64-mac.dmg` |
| `win-x64` | `windows-latest` | `x86_64-pc-windows-msvc` | NSIS `.exe` | `Alpha-<version>-x64-setup.exe` |
| `linux-x64` | `ubuntu-24.04` | `x86_64-unknown-linux-gnu` | AppImage | `Alpha-<version>-x86_64.AppImage` |
| `linux-arm64` | `ubuntu-24.04-arm` | `aarch64-unknown-linux-gnu` | AppImage | `Alpha-<version>-aarch64.AppImage` |

Each asset is accompanied by `<asset>.sha256` in `shasum` format, so a user verifies a download with `shasum -a 256 -c <asset>.sha256`. The version comes from `src-tauri/tauri.conf.json`, and the workflow's `install-notes` job appends the Chinese [install-notes.md](install-notes.md) to the release body once, without touching text the publisher wrote. The notes cover the Gatekeeper and SmartScreen prompts, the quarantine attribute, and the checksum verification steps.

The Windows NSIS installer installs for the current user. The macOS DMG carries the ad-hoc signed application described above. The Linux AppImage needs only that the FUSE layer or the `--appimage-extract-and-run` fallback is available; the runner installs the WebKitGTK and AppImage toolchain before building.

### Release versions

`src-tauri/tauri.conf.json` is the version authority: artifact names, release asset names, and the client build badge all read it. A release advances the date component alone, so the build after `1.0.20260922` is `1.0.20260923` and never `1.0.20260922-1`. Publishing the tag starts the packaging jobs, so `Cargo.toml` and the workspace manifests carry the same version before the release goes out.

## Known limitations

- Release artifacts are unsigned outside macOS's ad-hoc DMG: Gatekeeper and SmartScreen prompt on first run, and no notarization or publisher signature is performed.
- The release assets are the only distribution channel; the legacy Electron packaging and update-feed scripts remain in the worktree but are not part of release automation.
- Cross-OS artifact qualification runs only in CI; local verification covers the build host's own target.
- The desktop shell shares sessions, settings, credentials, workspaces, and storage under `$DSH_HOME` with CLI dsh, while executable packages, plugin activation, and lockfiles remain separate.
