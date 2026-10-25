# 桌面拖入启动修复与微信客服授权页

## 范围与原因

- 用户正式公钥授权文件已只读核验：签名有效、keyId 与正式公钥一致、绑定本机。未读取私钥或保险库。
- 原桌面包没有任何 capability，编译生成的 capabilities.json 为 `{}`。
- 前端 `getCurrentWebview().onDragDropEvent` 调用事件插件的 listen/unlisten，被 ACL 拒绝，进入启动失败提示分支。
- 在实际应用使用的 `app_context()` 上调用 Tauri 的运行时权限解析器，新增回归测试；补权限前明确失败：`main window is missing plugin:event|listen`。

## 改动

- 只为本地主窗口 main 添加 `core:event:allow-listen` 与 `core:event:allow-unlisten`。不开放远程页面、其他窗口、事件发送或通用文件系统权限。
- 提取拖入监听生命周期管理，释放异步完成但已卸载的订阅，抑制失效回调，避免 StrictMode 重挂载产生重复导入。
- 保留原生路径导入、授权校验、图片类型校验、分组和题型选择管线。失败时提供点击「收录截图」的可用替代入口，不再一味要求重启。
- 授权页右侧加入用户提供的微信二维码原图，文案为「添加客服微信」「将机器码发给客服，获取授权文件」。保持原有机器码复制、激活申请导出、授权导入与资料只读导出入口。
- 二维码作为本地静态资源打包，深浅主题均保留白底和原始比例，不滤镜染色，不联网加载。

## 验证

- `npm test`：75 Vitest + 30 Node 测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked --offline`：18 测试通过。包含真实编译 context 的 main 允许监听/解绑、其他窗口/远程来源拒绝、emit 仍拒绝的回归测试。
- `npm run build` 与 Tauri release app 构建成功。原有主 JS chunk >500 kB 提示仍存在，不是构建失败。
- `node scripts/qa-activation-drop.mjs`：隔离 Chrome + 模拟 native IPC，通过单图、多图拆分、混合文件跳过、连续导入、分题型保存、StrictMode 最终只有四条事件订阅检查。
- 浏览器检查墨青 1380px、夜读 900px、彩绘 390px 无横向溢出；二维码加载成功、原始字节哈希一致、白底且无滤镜；截图已人工查看。
- 打包后 `codesign --verify --deep --strict` 与 `hdiutil verify` 均成功。

## 本地交付

`local-deliverables/错题本-拖入修复与客服授权版-0.1.10-Intel-Mac/`

- `错题本-0.1.10-Intel-Mac.app`
- `错题本-0.1.10-Intel-Mac.dmg`
- `构建校验.json`
- `先看这里.md`

正式标识 `local.mistake.notebook`，正式公钥 keyId `a6989c8778c6d947` 不变，兼容已有正式授权；不包含个人题库或私钥。不覆盖旧交付物、不自动启动或删除已安装应用、不改用户题目/授权、不推送/发布。

DMG SHA256：`653a8b27820aa482d20251210d03e0cb96377d2af3af5122231862b8cb44eeaf`。

## 验收边界

- 仅当前 Intel Mac 本地包，未生成 Windows/Apple Silicon 安装包。
- macOS ad-hoc 签名，未做 Apple Developer ID 公证。
- 仍需用户实际从 Finder 拖入 PNG/JPEG/混合文件，检查投放提示、分组/题型弹窗及收集箱结果。浏览器 IPC 模拟不等同于 Finder 原生事件验收；Windows 资源管理器未实机测试。
- 微信扫码添加客服需用户用手机实际验收；自动化仅验证二维码原文件和显示，未对二维码发送任何请求。
