# DeepSeek 辅助录题与工作台升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 本计划建议在当前会话直接实施；执行前由用户审阅计划并选择执行方式。

**Goal:** 在离线录题基础上提供用户主动触发的 DeepSeek 图片识别、可检查的字段建议，并升级五个页面的布局与克制动效。

**Architecture:** 本地 OCR 与 DeepSeek 识别为两个独立入口。Rust 管理设备配置、系统凭据及固定官方服务请求；前端负责图片准备、发送确认、结果校验和字段合并。界面复用现有主题并提取必要组件，识别不会直接覆盖正在编辑的内容。

**Tech Stack:** React 19、TypeScript、Zustand、Tauri 2、Rust；沿用 Vitest，Rust 使用 reqwest/rustls、keyring 和可取消任务管理。UI 优先使用 CSS / Web Animations API。

**Spec:** `docs/superpowers/specs/2026-10-22-ai-capture-and-workbench-design.md`

## Global Constraints

- 默认关闭联网 AI；配置完成不代表自动上传，每次发送都展示接收方、模型、图片数并由用户确认。
- 首版仅支持 DeepSeek 官方接口 `https://api.deepseek.com/chat/completions`，默认 `deepseek-flash`；模型高级设置可编辑，服务地址不可编辑。
- JSON 输出使用 `response_format: { type: 'json_object' }`，提示含 JSON 示例；thinking 关闭，max_tokens 为 8192，不自动重试付费请求。
- 单次最多 8 张、长边不超过 2400 像素、压缩后合计不超过 12 MB；90 秒超时。GIF 首帧，BMP 转 PNG/JPEG；不修改原图。
- 密钥只在系统凭据库持久化；网页预览只在会话内存保存。配置不进入工作区及备份。
- 缺失答案保持为空，AI 建议待核对；请求中的手工修改不能被一键采用覆盖。
- 主要状态过渡 150–250ms，按压 80–120ms；支持系统与应用内减少动效，无交互等待动画结束。
- 旧 notebook.json 保持可读；先交付测试预览，本次不自动打包、推送或发布。

## Review Focus

1. 请求期间切题、取消或重试：迟到结果不会污染当前或其他题目；Task 4 用受控 Promise 测试。
2. 多选选项变化使答案引用过期：采用结果时答案不得指向不存在的选项；Task 1 覆盖组级合并。
3. 服务返回 HTML、空内容、截断或超大 JSON：显示错误且保留草稿；Task 1/2 测试边界。
4. 系统凭据库拒绝写入或处于锁定状态：明确失败，无明文回退；Task 2 以可替换凭据实现测试。
5. 200% 缩放、减少动效、请求中离开页面：主要按钮与焦点可达，工作正常；Task 5 验证。

## 文件责任

- `src/lib/ai/schema.ts`：请求结果类型及严格输出校验。
- `src/lib/ai/suggestions.ts`：快照比较、字段建议采用与定向撤销。
- `src/lib/ai/images.ts`：原图副本准备与尺寸/数量/字节限制。
- `src/lib/ai/client.ts`：统一桌面命令及网页会话请求入口。
- `src/hooks/useAiRecognition.ts`：请求生命周期、进度阶段和取消。
- `src/components/ai/`：DeepSeek 设置、发送确认和内嵌建议比较。
- `src/components/Organizer.tsx`、`src/components/SettingsPage.tsx`：从 App.tsx 提取现有对应页面，不改变无关数据逻辑。
- `src-tauri/src/ai.rs`：HTTP 与命令，固定服务地址、取消、超时和错误清理。
- `src-tauri/src/ai_settings.rs`：设备配置与系统凭据管理。
- `src/lib/preferences.ts`、`src/styles.css`：设备级动效偏好与统一视觉变量。

### Task 1: 识别输出与安全采用

**Files:** 新增 `src/lib/ai/schema.ts`、`schema.test.ts`、`suggestions.ts`、`suggestions.test.ts`；修改 `src/types.ts`、`src/lib/notebook.ts`。

**Interfaces:** `parseAiQuestion(raw: string, type: QuestionType): AiQuestionDraft`；`buildSuggestions(snapshot: Mistake, current: Mistake, draft: AiQuestionDraft): FieldSuggestion[]`；`applySuggestions(current: Mistake, suggestions: FieldSuggestion[], selectedIds: string[]): SuggestionChange`。`SuggestionChange` 含字段 patch 和仅恢复该次变更的 undo 数据。题干、选择内容、填空内容、简答内容、通用答案为独立采用组；选择内容原子包含选项和答案引用。

- [ ] 写失败测试：三种题型、空答案、多选、重复选项 ID、无效正确选项引用、空内容、HTML、截断 JSON、超过 256 KiB 文本，错误不产生可采用草稿。
- [ ] 写冲突测试：发起后编辑题干，仅跳过冲突题干；采用选项时答案引用一致；采用后修改其他字段，撤销不会丢失其他修改。若目标字段又被手工修改，撤销提示冲突而不覆盖。
- [ ] 运行 `npm test -- src/lib/ai/schema.test.ts src/lib/ai/suggestions.test.ts`，确认测试先失败。
- [ ] 实现以上接口，识别来源添加可选 `provider/model/recognizedAt` 元数据；解析旧备份时保留兼容。
- [ ] 运行对应测试并提交该任务文件，确认已有题型与备份测试仍通过。

### Task 2: DeepSeek 桌面请求与设备凭据

**Files:** 新增 `src-tauri/src/ai.rs`、`src-tauri/src/ai_settings.rs`；修改 `src-tauri/src/lib.rs`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`。

**Interfaces:** Tauri 命令 `get_ai_settings`、`save_ai_settings({model, apiKey?})`、`delete_ai_key`、`test_ai_connection({requestId})`、`recognize_ai_question({requestId, questionType, images, ocrText})`、`cancel_ai_request({requestId})`。设置只返回 `enabled/model/hasKey`，绝不返回已保存密钥。识别返回原始内容与来源模型供 Task 1 校验。取消以请求 ID 管理，退出时释放任务。

- [ ] 写请求构造与清理测试：固定主机及路径、禁跳转、Bearer 头、图片只在 user 消息、JSON 输出、thinking disabled、8192 tokens；错误输出移除密钥及响应原文。
- [ ] 写凭据失败与生命周期测试：保存失败不提示成功、不写入明文；锁定/不存在/删除失败区别处理。新密钥保存失败保留原有可用配置。
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 确认新测试失败后，添加最小必要依赖并实现命令。前后端都校验图片数量、字节数与模型名长度。
- [ ] 使用本地 mock HTTP 服务测试 401、402、429、500、延迟、取消、重定向、HTML、超过 1 MiB 响应体；生产构造器不可覆盖服务地址，测试注入仅在测试构建启用。
- [ ] 连接测试使用带已知字符的合成测试图，确认视觉与结构化输出；不在测试或仓库中添加真实密钥。
- [ ] 运行 Rust 测试与 `cargo check --release --manifest-path src-tauri/Cargo.toml`，提交该任务文件。

### Task 3: 前端配置、图片准备及请求入口

**Files:** 新增 `src/lib/ai/images.ts`、`images.test.ts`、`client.ts`、`client.test.ts`、`src/components/ai/AiSettings.tsx`；提取 `src/components/SettingsPage.tsx`，修改 `src/App.tsx`。

**Interfaces:** `prepareAiImages(images: ImageAsset[], signal: AbortSignal): Promise<PreparedAiImage[]>`；`getAiSettings()`、`saveAiSettings(input)`、`testAiConnection(requestId)`、`recognizeAiQuestion(request, signal)`。桌面 invoke 与网页 fetch 对外返回一致的类型化结果。网页密钥仅存模块内存，刷新消失。

- [ ] 写限制测试：9 张拒绝，8 张通过，压缩后大于 12 MB 拒绝，2400 像素长边保持比例；图片来源始终为原图，不使用批注预览；损坏和取消失败可理解。
- [ ] 写 client 测试：网页取消使用 AbortController，桌面取消调用对应 requestId；无密钥不发送请求；配置信息不流入 notebook 序列化。
- [ ] 实现图片准备与统一请求，测试连接显式说明会发送合成测试图并可能计费。
- [ ] 设置界面显示密钥保存/清除/测试状态；模型高级设置更改后测试状态清空。桌面凭据失败及网页跨域错误给出可操作提示。
- [ ] 运行相关测试与 `npm run build`，提交该任务文件。

### Task 4: 录题识别、结果检查与合并

**Files:** 新增 `src/hooks/useAiRecognition.ts`、`src/lib/ai/session.ts`、`session.test.ts`、`src/components/ai/AiSendConfirmation.tsx`、`AiSuggestionPanel.tsx`；提取 `src/components/Organizer.tsx`，修改 `src/App.tsx`。

**Interfaces:** `createRecognitionSession()` 提供 `start(itemId)`、`cancel()`、`isCurrent(token, itemId)`；hook 包装 session，公开 `phase/draft/error/prepare/confirm/cancel/apply/undo`。请求快照以当前题 ID、图片 ID、字段内容固定，采用 Task 1 接口合并。

- [ ] 受控 Promise 测试：A 题请求晚于 B 题完成、取消后服务返回、连续重复启动；只有当前且未取消的请求可展示建议。
- [ ] 测试仅配置 API 不发送，只有确认发送才调用 client；取消确认不发送；空 OCR 不阻止直接识图。
- [ ] 实现“AI 辅助识别”入口、内嵌发送确认、真实阶段文字、取消及失败重试；确认只列当前题选定图片，未选图片不发送。
- [ ] 结果逐组采用/一键采用非冲突组/放弃/撤销，补齐来源与待核对状态。切页时中止请求，切题后建议状态重置。
- [ ] 保留自动本地 OCR，并给本地异步结果加入同样的快照冲突保护，避免它覆盖 AI 结果或手工编辑。
- [ ] 全面修正“不上传”文案；保留现有拖入、粘贴、分组及题型选择。运行相关测试和构建，提交该任务文件。

### Task 5: 五个页面的布局与动效

**Files:** 修改 `src/App.tsx`、`src/styles.css`、`src/components/Organizer.tsx`、`SettingsPage.tsx`、`CaptureImportDialog.tsx`、`ActionButton.tsx`；新增 `src/lib/preferences.ts` 和必要的共享布局组件；同步 `PRODUCT.md`、`DESIGN.md`。

**Interfaces:** `getMotionPreference(): 'system' | 'reduced'`、`setMotionPreference(value): void` 仅写设备级独立偏好键；根元素通过 `data-motion` 与 CSS 媒体查询统一控制。页面切换不重建正在保存的数据任务。

- [ ] 统一表面、文字、间距、控件、语义状态和焦点变量；保留墨蓝绿色并实测正文对比度至少 4.5:1。
- [ ] 收集箱宽屏列表/原图/表单分栏，中屏原图折叠，窄屏图片/内容标签；主保存动作固定可达，图片批注入口保留。
- [ ] 实现导航折叠与选中底板、导入阶段切换、AI 建议采用短强调、真实保存成功反馈；主要过渡 150–250ms，按压 80–120ms。
- [ ] 今日复习可折叠队列及答案揭示；全部错题筛选视觉统一；记录按日期分组并可展开查看作答和调度；设置分区清晰。
- [ ] 增加跟随系统/减少动效，所有位移动画有降级；键盘焦点不等待动画，弹层关闭恢复焦点，错误状态有文字。
- [ ] 在 1440px、1024px、窄窗口及 200% 缩放下人工走五页，检查长中文标题、待识别/错误/空状态和连续快速切页；运行构建和原有测试后提交。

### Task 6: 集成验证与测试预览交付

**Files:** 新增 `docs/qa/2026-10-22-deepseek-workbench.md`，按验证中发现的实际问题修复对应文件。

- [ ] 使用独立测试资料目录，不读取或修改用户错题；恢复本地缺失的已跟踪 OCR 资源供离线测试，不提交 iCloud 占位文件或本地 previews。
- [ ] 运行 `npm test`、`npm run build`、Rust 全套测试与 release check，记录命令及真实结果。
- [ ] 模拟三题型、多图、坏 JSON、空答案、取消、切题、冲突采用及撤销；检查工作区和导出备份没有凭据或设备配置。
- [ ] 验证断网本地 OCR、图片编辑、保存、评分及备份恢复；新安装无测试数据。
- [ ] 启动本地预览并验证实际可访问；提供五个页面截图与测试入口。没有真实 DeepSeek 密钥时明确标记真实 API 待测，不声称通过。
- [ ] 桌面端检查系统凭据、原生拖入和真实 DeepSeek；只记录实际可运行平台，Windows 未测试就列为待测。
- [ ] 交付预览地址、已验证项、待测项，不触发 GitHub 发布或打包。
