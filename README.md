# 错题本

一个本地优先的桌面错题整理与复习应用。支持截图收录、离线图片文字识别、连续整理、图片标注、分层题库和自定义复习周期。

图片可以直接从 Finder 或 Windows 资源管理器拖入。批注器支持画笔、荧光笔、文字、箭头、形状、局部擦除、答案遮挡、裁剪、旋转、缩放和平移，所有操作均非破坏式自动保存。

图片文字识别使用随应用打包的简体中文与英文识别文件，不上传题目图片。复习周期可选择自适应安排，也可为“重来 / 困难 / 良好 / 简单”分别设置固定天数。

## 下载与安装

前往 [Releases 下载页](https://github.com/lllwuwu25-alt/zzzzy/releases)，按照设备选择安装包：

| 你的设备 | 下载这个文件 |
| --- | --- |
| Mac，Apple M1 / M2 / M3 / M4 芯片 | 文件名含 `aarch64` 的 `.dmg` |
| Mac，Intel 芯片 | 文件名含 `x64` 或 `x86_64` 的 `.dmg` |
| Windows 10 / 11 | 文件名含 `x64-setup` 的 `.exe` |
| Ubuntu / Debian Linux | 文件名含 `amd64` 的 `.deb` |
| 其他常见 Linux | 文件名含 `amd64` 的 `.AppImage` |

> 普通用户不需要下载 `.tar.gz`、`.sig`、`Source code.zip` 或 `Source code.tar.gz`。

不知道自己的 Mac 是哪种芯片，或遇到系统拦截时，请查看 [完整下载与安装说明](DOWNLOAD.md)。

## 本地开发

需要 Node.js LTS、Rust stable，以及对应系统的 Tauri 开发依赖。

```bash
npm ci
npm run dev
```

启动桌面应用：

```bash
npm run desktop:dev
```

本地构建安装包：

```bash
npm run desktop:build
```

## GitHub 自动打包

仓库包含 `.github/workflows/release.yml`，会为以下平台生成安装包：

- macOS Apple Silicon
- macOS Intel
- Windows x64
- Linux x64

发布新版本时，先同步修改 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 中的版本号，然后任选一种方式：

1. 在 GitHub Actions 中手动运行 `Build desktop installers`。
2. 推送版本标签，例如 `v0.1.0`。

构建完成后，安装包会进入一个 GitHub Draft Release。检查无误后再手动发布。

macOS 当前使用 ad-hoc 签名，适合内部测试和个人分发；若要面向公众稳定分发，建议配置 Apple Developer ID 与公证。

## 数据

应用不需要登录。绑定本地工作区后，数据会写入用户选择文件夹中的 `notebook.json`，同时保留设备内副本。
