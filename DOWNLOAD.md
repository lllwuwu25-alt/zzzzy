# 错题本下载与安装说明

打开 [GitHub Releases 下载页](https://github.com/lllwuwu25-alt/zzzzy/releases)，进入最上方的最新版本，然后展开 **Assets** 文件列表。

## 一眼选对安装包

| 你的电脑 | 应下载的文件 | 不要选错成 |
| --- | --- | --- |
| Mac，Apple M1 / M2 / M3 / M4 芯片 | 文件名含 `aarch64` 的 `.dmg` | `x64.dmg`、`.tar.gz` |
| Mac，Intel 芯片 | 文件名含 `x64` 或 `x86_64` 的 `.dmg` | `aarch64.dmg`、`.tar.gz` |
| Windows 10 / 11（绝大多数电脑） | 文件名含 `x64-setup` 的 `.exe` | `.sig`、源码压缩包 |
| Ubuntu / Debian Linux | 文件名含 `amd64` 的 `.deb` | `.sig` |
| 其他常见 Linux | 文件名含 `amd64` 的 `.AppImage` | `.sig` |

## Mac：怎么查看芯片类型

1. 点击屏幕左上角的苹果图标。
2. 点击“关于本机”。
3. 查看“芯片”或“处理器”一栏：
   - 显示 **Apple M1、M2、M3 或 M4**：下载 `aarch64.dmg`。
   - 显示 **Intel**：下载 `x64.dmg` 或 `x86_64.dmg`。

下载后双击 `.dmg`，把“错题本”拖进“应用程序”文件夹。

当前版本使用测试签名。如果 macOS 第一次打开时提示无法验证开发者：

1. 打开“系统设置”。
2. 进入“隐私与安全性”。
3. 向下找到被拦截的“错题本”，点击“仍要打开”。
4. 再确认一次“打开”。

## Windows

下载文件名含 `x64-setup` 的 `.exe`，双击后按照安装向导操作。若 Windows SmartScreen 提示风险，请先确认文件来自本仓库的 Releases 页面，再选择“更多信息 → 仍要运行”。

## Linux

- Ubuntu、Debian 及其衍生发行版：优先下载 `.deb`。
- 不确定发行版时：可以下载 `.AppImage`，为文件添加执行权限后运行。

## Assets 里其他文件是什么

- `.dmg`：Mac 安装包，Mac 用户下载这个。
- `.exe`：Windows 安装程序，Windows 用户下载这个。
- `.deb`：Ubuntu / Debian 安装包。
- `.AppImage`：可直接运行的 Linux 应用文件。
- `.app.tar.gz`：应用自动更新使用的压缩包，普通用户不需要下载。
- `.sig`：安装包签名校验文件，普通用户不需要下载。
- `Source code.zip` / `Source code.tar.gz`：源代码，开发人员使用，不是安装包。

