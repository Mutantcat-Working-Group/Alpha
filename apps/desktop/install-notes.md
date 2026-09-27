<!-- alpha-install-notes -->

## 安装与下载

- macOS（Apple Silicon）：`Alpha-__VERSION__-arm64-mac.dmg`
- macOS（Intel）：`Alpha-__VERSION__-x64-mac.dmg`

两个镜像均带 ad-hoc 签名，首次打开如遇 Gatekeeper 提示，请 **右键点击 → 打开**。
- Windows：`Alpha-__VERSION__-x64-setup.exe`

如遇 SmartScreen 提示，点 **更多信息 → 仍要运行**。
- Linux：`Alpha-__VERSION__-x86_64.AppImage`（x86_64）或 `Alpha-__VERSION__-aarch64.AppImage`（arm64）

先执行 `chmod +x <安装包>`，再双击运行。

每个安装包均附带 `.sha256` 校验文件，例如：

```sh
shasum -a 256 -c Alpha-__VERSION__-arm64-mac.dmg.sha256
```

安装包由公开 CI（GitHub Actions）构建，可重复验证。
