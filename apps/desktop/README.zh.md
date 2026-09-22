# Alpha 桌面端

[English](README.md) | 中文

Alpha 是完整 dsh Web 应用外的一层 Tauri 壳。壳窗口先打开内置加载页，启动承载私有 Desktop Host 的 Node sidecar，待该 Host 报告就绪后导航到它的地址。Desktop 默认使用端口 `19387`，与 Web 的 `3080` 分开；可通过 `webserver.config.port` patch 覆盖。产品名、版本号和应用 ID 都在 [tauri.conf.json](src-tauri/tauri.conf.json)，所有发布家族共用同一个版本字符串。

## 壳启动

Host 是不带子进程 IPC 通道的 Node sidecar，通过 stdout 和 stdin 上的换行分隔 JSON 报告就绪并接收命令。Host argv 依次指定 staged 运行时目录、以每用户应用数据目录作为工作目录、主运行时、解析模式 `runtime`、内置 pnpm 入口和私有 Node bin 目录。打包后的应用把 sidecar 放在 `Contents/MacOS/node`，staged 载荷放在 `Contents/Resources/runtime`；[lib.rs](src-tauri/src/lib.rs) 的 `resolve_launch` 定位这两者，`node_sidecar` 同时接受开发构建留下的带目标后缀的文件名。

启动按固定顺序进行。主窗口先打开内置加载页。Host 读取线程等待携带引擎地址和启动注入的 `ready` 事件，或携带原因的 `fatal` 事件。就绪后，壳把启动载荷写入窗口槽位和当前文档，等待引擎端口接受 TCP 连接，然后把窗口导航到引擎地址。窗口内每个文档还会收到一个初始化脚本，安装 `dshDesktopBoot` 桥及其就绪门；页面加载钩子会把已持有的载荷再次发布给之后加载的文档。Web 客户端先等待 `dshDesktopBoot.ready()` 再启动，并通过 `alpha-boot-failed` 窗口事件上报自己的启动失败，由壳在 Web 页面之外展示。

Host 在报告就绪前退出、就绪后引擎端口仍拒绝连接、或就绪事件不带启动载荷时，加载页保持可见，并弹出一个说明原因的原生对话框。对话框被确认后壳退出，因为引擎已死无可恢复。没有内容的白色窗口不是可达状态：要么等到引擎应答，要么收到失败报告。

关闭窗口请求会向 Host 的 stdin 发送 `{"type":"shutdown"}`，最多等待十秒后才结束进程。单实例守卫会聚焦已有窗口而不是启动第二个进程，两个 Alpha 进程因此不会争抢同一个 profile。

引擎端口被上次启动留下的 Host 占着，新 Host 在启动前先接管 profile 目录：读取它写在该目录下的 `host.pid`，对仍存活的旧 Host 先发 `SIGTERM`、最多等五秒、再发 `SIGKILL`，进程或端口一消失就继续。端口才是所有权信号：壳先死、子进程未被回收的旧 Host 只剩僵尸表项，而僵尸不持有监听。旧 Host 在强杀后仍存活时，本次启动带着它的进程 id 失败，而不是与它争抢端口。Host 在加载 profile 前还会初始化 profile 目录：manifest、用户 patch 层和 pnpm 工作区设置在缺失时写入，已有文件从不改动。

## macOS 代码签名

内置 Node 引擎运行 V8，在没有 JIT 权限的情况下无法在 macOS 强化运行时下启动。[entitlements/alpha.plist](src-tauri/entitlements/alpha.plist) 授予 JIT、未签名可执行内存、可执行页保护、库加载校验和 dyld 环境变量权限，`bundle.macOS.entitlements` 让 Tauri 打包器使用它。打包器会把该 plist 应用到它签名的每个 Mach-O 文件，包括 Node sidecar：保留自身发布签名的 sidecar 在 ad-hoc 重签名过程中会丢掉这些 entitlement 并立即 trap，因此该 plist 是必需而非可选。

发布构建采用 ad-hoc 签名，因为托管运行器不带签名身份。macOS 构建向 codesign 传入 `-` 身份，并对成品 DMG 再次签名，工作流在上传前验证该签名。Windows 和 Linux 产物保持未签名。因此 Gatekeeper 会在首次启动 macOS 应用时要求用户确认，可通过右键菜单的“打开”，或用 `xattr -dr com.apple.quarantine <path>` 移除隔离属性；Windows 上未签名安装程序会弹出 SmartScreen 提示。

## 内置运行时载荷

Desktop 内置独立的 Python、Node.js 和 pnpm 发行版。Python 包含 numpy、pandas、python-docx、python-pptx、openpyxl、Pillow、lxml 和 XlsxWriter 及其完整依赖。`load_workspace_dependencies` 工具在首次使用时离线安装该载荷到 `$DSH_HOME/dsh-runtimes/dsh-primary-runtime`（通常为 `~/.dsh/dsh-runtimes/dsh-primary-runtime`），返回解释器、pnpm 脚本和库的绝对路径，以及 `pythonDistributions`（内置发行版名称与版本）。版本报告不含用户自行安装的内容。除非用户或工作区指令另选环境，Office 任务优先使用这些库。执行 pnpm 脚本时使用返回的 Node 可执行文件。返回的 Node 库目录预留给内置库，不是 pnpm 的全局安装目录。

Desktop 默认注册 `office-docx`、`office-pptx` 和 `office-xlsx`。这些技能用内置 Python 库进行创建和定点编辑，然后重新打开文件并运行共享结构检查后才交付。PowerPoint 的创建与编辑使用 python-pptx。技能资源被放到可执行文件之外的 `runtime/office-skills`，以便 Python 读取检查器。可用的 `render_document` 工具可以补充目检；缺失它不影响撰写或交付。检查与限制见 [Office 技能包](../../packages/skill/skill-office/README.zh.md)。

载荷跟随 Desktop 发布。`versions.json` 记录组件版本、Python 发行版版本和已准备运行时的载荷身份。身份一致的安装会被复用；依赖变化会替换整个目录。[prepare-tauri-runtime.ts](scripts/prepare-tauri-runtime.ts) 把载荷 stage 进 bundle，并拒绝 Node 主版本与准备该运行时的解释器不一致的 sidecar。

私有 Desktop `runtime/bin` 目录只加入包安装进程，不会进入 PTC 和 agent shell 继承的 Host PATH。该工具不修改 PATH、环境变量或用户的包管理器配置。pnpm 保留自己的默认值和用户设置，包括全局包、可执行入口及其存储，在环境不支持全局安装时也会原样报错。没有独立的依赖更新器。[主运行时决策](../../.agents/notes/implemented/feature/2026-09-14-desktop-primary-runtime.zh.md) 记录了这些选择。

## 图标

原始美术资源在仓库根 `icon.png`；[src-tauri/icons](src-tauri/icons) 下的平台文件由它导出。macOS 使用 `icon.icns`，Windows 应用和安装程序使用 `icon.ico`，Linux AppImage 使用 `icon.png`。其余平台尺寸由 Tauri 在构建时从这些源文件生成。

## 关键决策

| 决策 | 原因 | 直接后果 |
| ---|---|--- |
| 发布身份 | 壳 API、Web 客户端、后端和插件图作为一个组合被验证；独立版本会产生未经测试的组合和含糊的更新判定。 | Alpha 与 `@mutantcat/dsh` 始终携带完全相同的版本。dsh 升级就是一次 Desktop 发布，即使壳代码未变。 |
| 运行时 | 应用必须在没有系统 Node.js 或 pnpm 的情况下运行。 | Node sidecar 以 `--expose-internals` 运行 Host，所有包操作使用内置 pnpm。 |
| 包来源 | 启动时安装核心依赖即使离线也要付出代价。 | staged 运行时携带完整的产品依赖树；profile 只安装外部插件。 |
| 状态归属 | 共享可执行依赖图会让 CLI 和 Desktop 互相修改对方的 dsh、Cordis、插件或原生模块版本，而两个桌面进程可能争抢同一 profile。 | Alpha 在访问任何 profile 前获取进程级单实例锁，独占它的应用数据目录（同时是 profile 根目录）及其包管理器状态。CLI 与 Desktop 共享 `$DSH_HOME` 下的受支持产品数据，但从不共享可执行包、插件激活、lockfile 或 `node_modules`。 |
| 传输 | Web 服务和认证使用同一实现。 | 壳只加载内置 Web 资源作为加载页；引擎文档和认证 API 由 Host 提供。 |

## 安装归属

Alpha 拥有它的应用数据目录，它同时是 profile 根目录：macOS 上为 `~/Library/Application Support/org.mutantcat.alpha`，Windows 上为 `%LOCALAPPDATA%\org.mutantcat.alpha`，Linux 上为 `~/.local/share/org.mutantcat.alpha`。其 `dependencies` 存放 pnpm 安装的包；`dsh.profile.bundles` 依次存放内置 bundle 和启用的插件。staged 运行时提供 dsh、私有 Desktop Host 及其产品依赖。打包后的应用选择运行时 profile 解析，不创建包链接；开发 profile 使用文件系统链接。Host 和插件运行在 Node sidecar 进程中；渲染进程不获得文件系统访问、原始 Tauri IPC、shell 或任意 pnpm 参数。

产品界面保留 Web 操作，包括通过共享认证 HTTP 路由的“Open In...”。插件管理使用 Web 应用的认证 HTTP API 操作 Desktop profile，壳不暴露单独的插件管理 IPC。原生目录选择是唯一的桌面侧交互：打开绑定应用窗口的平台选择器，返回单个路径。

### 插件激活

1. Host 启动前，加载窗口显示内置加载页。
2. Host 启动前，Desktop 移除已准备运行时列出的包在 profile 中的副本和回退链接，清理改变了包状态时丢弃 lockfile。其余插件文件、配置和版本保留。
3. Node 版本、平台或架构变化保留已安装插件。原生不兼容在加载过程中暴露，可通过 pnpm 修复。
4. 主应用的 Plugins 页对 Desktop profile 使用共享 [插件管理器](../../packages/boot/plugin-manager/README.zh.md)，包操作以内置 pnpm 在正常用户和 profile 配置下进行。
5. 共享管理器拥有安装错误、激活和重启要求。Host 无法启动时，原生恢复可以禁用第三方 bundle。

启动失败只弹出一个说明原因的原生对话框；没有自动插件恢复事务，也没有启动超时启发式。对话框点名旧 Host 进程时，表示残留的 Host 拒绝了停止请求；退出 Alpha 并结束残留 sidecar 即可清除。

## 开发

完整发布链先准备整个 monorepo，再 stage 运行时，最后调用 Tauri 打包器：

```sh
pnpm --dir apps/desktop run package:ci:tauri:mac-arm64
```

该命令先跑共享准备（`build:official`、两个包家族、主运行时、入口打包和载荷 stage），再执行 `tauri build --target <triple> --bundles <dmg|nsis|appimage>`。只 stage 不打包可用于检查：

```sh
pnpm --dir apps/desktop run prepare:tauri-runtime
```

要对已 stage 的载荷直接打一个 bundle，在 `apps/desktop` 下带 ad-hoc 签名环境运行 Tauri CLI：

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false APPLE_SIGNING_IDENTITY=- pnpm exec tauri build --target aarch64-apple-darwin --bundles app
```

macOS 本地打 DMG 时会把 [scripts/dmg-tools](scripts/dmg-tools) 前置到 `PATH`。其中的 `hdiutil` shim 会在卷卸载失败时用 `-force` 重试：交互式 Finder 会话可能占着挂载的映像，而 create-dmg 自带的重试会耗尽；托管运行器第一次卸载就成功，所有命令原样透传。

## 打包

`.github/workflows/release-app.yml` 把安装包挂到已发布的 GitHub release；发布 release 会为每个目标启动一个 job，`workflow_dispatch` 可显式指定接收的 tag。每个 job 运行 `package:ci:tauri:<target>`（[ci-tauri-package.ts](scripts/ci-tauri-package.ts)）：重复共享准备、stage 目标的 Node sidecar 和运行时载荷、通过 Tauri 打包器构建一种 bundle、把产物复制为 release 资源名并写入旁边的 `.sha256` 边车文件。脚本拒绝平台与构建主机不一致的目标，并用 `gh release upload --clobber` 上传，重跑会替换已挂上的同名资源而不是失败。

| 目标 | Runner | Rust triple | Bundle | Release 资源名 |
| ---|---|---|---|---|
| `mac-arm64` | `macos-14` | `aarch64-apple-darwin` | ad-hoc DMG | `Alpha-<version>-arm64-mac.dmg` |
| `mac-x64` | `macos-15-intel` | `x86_64-apple-darwin` | ad-hoc DMG | `Alpha-<version>-x64-mac.dmg` |
| `win-x64` | `windows-latest` | `x86_64-pc-windows-msvc` | NSIS `.exe` | `Alpha-<version>-x64-setup.exe` |
| `linux-x64` | `ubuntu-24.04` | `x86_64-unknown-linux-gnu` | AppImage | `Alpha-<version>-x86_64.AppImage` |
| `linux-arm64` | `ubuntu-24.04-arm` | `aarch64-unknown-linux-gnu` | AppImage | `Alpha-<version>-aarch64.AppImage` |

每个资源都带 `<资源名>.sha256`，为 `shasum` 格式，用户可用 `shasum -a 256 -c <资源名>.sha256` 校验下载。版本号取自 `src-tauri/tauri.conf.json`。工作流的 `install-notes` job 会把中文 [install-notes.md](install-notes.md) 追加到 release 正文一次，且不触碰发布者自己写的文字。安装说明覆盖 Gatekeeper 与 SmartScreen 提示、隔离属性和校验和验证步骤。

Windows NSIS 安装程序为当前用户安装。macOS DMG 携带上述 ad-hoc 签名的应用。Linux AppImage 只需要 FUSE 层可用，或使用 `--appimage-extract-and-run` 回退；runner 在构建前安装 WebKitGTK 与 AppImage 工具链。

<a id="release-versions"></a>

### 发布版本

版本号以 `src-tauri/tauri.conf.json` 为准：产物名、release 资源名和客户端构建徽标都读它。迭代时只递增日期部分，`1.0.20260922` 之后是 `1.0.20260923`，不会是 `1.0.20260922-1`。发布 tag 才会启动打包 job，因此发布前 `Cargo.toml` 与各 workspace 清单要保持同一个版本号。

## 已知限制

- macOS 的 ad-hoc DMG 之外的产物均未签名：Gatekeeper 和 SmartScreen 会在首次运行时提示，不进行公证或发布者签名。
- release 资源是唯一分发渠道；遗留的 Electron 打包和更新 feed 脚本仍在工作区中，但不属于发布自动化。
- 跨操作系统产物验证只在 CI 进行；本地验证只覆盖构建主机自身的目标。
- 桌面壳与 CLI dsh 共享 `$DSH_HOME` 下的会话、设置、凭据、工作区和存储，而可执行包、插件激活和 lockfile 保持独立。
