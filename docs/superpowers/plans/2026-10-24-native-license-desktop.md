# 本地测试包与独立离线发码器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可双击运行的商家发码窗口与隔离的 Intel Mac 错题本本地测试包，并记录真实原生验证结果。

**Architecture:** 买家端保持 React + Tauri，商家端独立 Electron 应用复用 `tools/license-admin/core.mjs`。受限 preload 只暴露业务方法；主进程管理保险库、系统对话框和输出文件。测试打包脚本在临时目录生成随机测试密钥，只向编译器传公钥，不修改正式配置。

**Tech Stack:** Node.js 内置加密与文件 API、Electron、HTML/CSS/JavaScript、现有 React/Tauri/Rust、Node test、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-24-native-license-desktop-design.md`

## Global Constraints

- 仅在现有 `codex/deepseek-workbench` 工作树实施；不更改未跟踪的 `previews/`。
- 本轮先交付当前这台 Intel Mac 可直接运行的两个本地程序；不自动推送、发布 GitHub Release。
- 不启动 HTTP 服务、不联网、不加载远端脚本；发码器不进入买家的错题本安装包。
- 保险库密码至少 12 位；不静默覆盖已有保险库，不把私钥明文导出。
- 取消签发前的保存选择不占名额；证书必须先可靠记账再输出。
- 测试包使用独立应用标识、数据目录和明显的“本地测试版”名称，不覆盖已有题库。
- 不修改留空的正式公钥配置，不替用户生成正式生产私钥；正式发行缺公钥仍失败关闭。
- 仅可清理本任务工作区内可重新生成的构建缓存；空间不足时停止，不删除个人数据或唯一交付物。
- 只把真实运行过的路径记为通过；浏览器 IPC mock 不能替代真机结论。

## Review Focus

1. 系统保存对话框取消、文件冲突或磁盘写入失败，不丢账、不多占设备名额。Task 1 测试取消、故障后幂等重导。
2. 快速双击、锁定与签发交错，不出现同时打开两份保险库或后台签发。Task 1 测试串行执行与锁定。
3. 非法 IPC、超大激活申请、符号链接指向受保护目录，不能绕过业务限制。Task 1/2 测试输入、真实路径及发送方校验。
4. 旧备份恢复和手工换机不能远程撤销旧证书；Task 3 验证提示、确认与历史保留。
5. 打包资源意外混入测试秘密、题库或发码核心；Task 4 检查买家与卖家资源白名单及隔离标识。

## File Structure

- `tools/license-desktop/service.mjs`：可注入对话框/文件输出的业务服务，无 Electron 依赖。
- `tools/license-desktop/service.test.mjs`：真实临时保险库及故障测试。
- `tools/license-desktop/security.mjs`、`security.test.mjs`：IPC 参数、路径和发送方约束。
- `tools/license-desktop/main.mjs`：Electron 窗口、原生对话框、业务 IPC、退出清理。
- `tools/license-desktop/preload.cjs`：固定方法的 contextBridge。
- `tools/license-desktop/ui/{index.html,app.js,styles.css}`：独立离线商家界面。
- `tools/license-desktop/package.json`、lockfile：独立锁定运行时与打包依赖，不进入买家依赖。
- `scripts/build-license-desktop.mjs`：仅打包白名单文件、生成 Intel Mac 商家 `.app`，可用时生成 `.dmg`。
- `scripts/build-local-test.mjs`、`scripts/local-package.test.mjs`：隔离买家构建、临时测试材料生命周期、资源审计。
- `scripts/qa-license-desktop.mjs`：启动真实 Electron 的合成数据 GUI 流程。
- `docs/qa/2026-10-24-native-license-desktop.md`：自动化、真实原生及待人工项目的分离报告。
- `LICENSE-GUIDE.md`：双击使用、正式初始化、公钥打包、备份和两台设备限制说明。

---

### Task 1: 安全的商家桌面业务服务

**Files:** Create `tools/license-desktop/service.mjs`, `service.test.mjs`, `security.mjs`, `security.test.mjs`.

**Interfaces:**
- Consumes: `IssuerVault.create(path, password)`, `.open(path, password)`, `.createPurchase(label)`, `.issue(purchaseCode, machineCode, label)`, `.replace(purchaseCode, oldCode, newCode, label, reason, acknowledged)`, `.list()`, `.publicConfig()`, `.close()`.
- Produces: `createIssuerService({ dialogs, protectedRoots })` with async methods `createVault({password, confirmation, acknowledged})`, `openVault({password})`, `snapshot()`, `createPurchase({label})`, `readRequest()`, `issue({purchaseCode,machineCode,label})`, `replace({purchaseCode,oldMachineCode,machineCode,label,reason,acknowledged})`, `exportPublicConfig()`, `backupVault()`, `lock()`.
- Dialog adapter: `chooseVault({create}): Promise<string|null>`, `chooseRequest(): Promise<string|null>`, `chooseOutput({kind,defaultName}): Promise<string|null>`; kind is `certificate|public-config|backup`.
- Snapshot: `{unlocked:boolean, vaultName:string|null, purchases:Array}` containing only sanitized core `.list()` data. Operation results: `{cancelled:true}` or `{cancelled:false,snapshot,outputPath?}`; request import returns `{cancelled:false,machineCode}`.
- `validateCall(method,args)` rejects unknown methods/keys, wrong types and length bounds; `isTrustedSender({frameUrl,isMainFrame,expectedUrl})` accepts only the application's exact local main frame. `assertSafeDestination(path,protectedRoots)` resolves existing ancestors to prevent symlink bypass.

- [ ] **Step 1: Write failing service/security tests.** Assert mismatched/short passwords never create a file; canceled vault/output selection leaves state untouched; two devices issue, third rejects; same-device output failure then retry returns the same certificate and one active record; replacement requires reason/ack and retains history; backup opens and has the same public key/orders; lock releases the file lock; interleaved actions serialize. Assert malformed/oversized requests (32 KiB limit), unsafe/symlink destinations, unexpected IPC keys and non-main/remote senders reject. Assert no private key, password or certificate payload appears in snapshots/errors.
- [ ] **Step 2: Run `node --test tools/license-desktop/*.test.mjs`.** Expected failures for missing modules/exports, not unrelated core failures.
- [ ] **Step 3: Implement the declared service and security interfaces.** Use existing core crypto unchanged; native path choices remain main-process-only. Output files use private temporary files, fsync and no-clobber publication, preserve conflicting files, and clean partial temporary output. Choose certificate destination before core mutation; retain committed record if output fails. Cap input lengths, reject protected roots, sanitize filesystem errors, and serialize service operations.
- [ ] **Step 4: Run new tests plus `npm run test:license`.** Expected all pass with real temporary vaults, including fault cases; delete synthetic secrets in test cleanup.
- [ ] **Step 5: Commit only the four new service/security files.** Message: `feat: add safe desktop issuer service`.

### Task 2: 独立 Electron 窗口与受限桥接

**Files:** Create `tools/license-desktop/main.mjs`, `preload.cjs`, `package.json`, lockfile, initial `ui/index.html`, `ui/app.js`, `ui/styles.css`; extend `security.test.mjs`; modify root `package.json` scripts only.

**Interfaces:**
- Consumes: Task 1 service, validation and sender rules.
- Produces: `window.issuer` exposes individually named async methods matching Task 1, returning `{ok:true,value}` or `{ok:false,error:string}`. No generic invoke/read/write/shell methods. Root `license:desktop` launches the separate app.
- UI assets are loaded from a packaged local file URL; only that exact main frame may call the fixed IPC channels.

- [ ] **Step 1: Add failing security configuration tests.** Assert `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, strict local-only CSP, denied navigation/new windows/permissions, explicit preload methods, and IPC sender checks. Include child-frame, remote URL and unknown-method attempts.
- [ ] **Step 2: Run `node --test tools/license-desktop/*.test.mjs`.** Expected new configuration assertions fail before implementation.
- [ ] **Step 3: Verify the current supported Electron release using official Electron information; install and lock an exact version in the standalone package.** Do not add Electron to buyer runtime dependencies; inspect disk first and stop if insufficient.
- [ ] **Step 4: Implement window/IPC/adapter setup.** Name app “错题本发码器”, ID `local.mistake.notebook.issuer`; local-only renderer with CSP `default-src 'none'`, local script/style and no network capability. Close/quit locks the vault; reject calls when window/frame is untrusted. Default vault chooser to user Documents, not repo/resources/install directory. Initial shell shows create/open buttons and no production initialization is performed by automation.
- [ ] **Step 5: Run service/security tests and launch actual Electron window.** Expected safe settings and exact bridge available without HTTP server; record actual runtime version.
- [ ] **Step 6: Commit standalone app shell and dependency lockfile.** Message: `feat: add isolated offline issuer desktop shell`.

### Task 3: 商家发码完整操作界面

**Files:** Modify `tools/license-desktop/ui/*`; create `scripts/qa-license-desktop.mjs`; update `LICENSE-GUIDE.md`.

**Interfaces:**
- Consumes: fixed `window.issuer` methods from Task 2; no direct Node/Electron APIs in renderer.
- Produces: usable create/unlock flow; order/device workbench; issuance/re-export; request import; replacement with explicit warning/acknowledgement; public-key export; encrypted backup; lock. UI never renders passwords/private material in status messages.

- [ ] **Step 1: Add failing real-Electron UI scenarios.** Use synthetic vaults and deterministic native-dialog adapters selected only by the QA launcher, never a production renderer bypass. Assert create confirmation/password validation, cleared password inputs, wrong-password recovery, order creation, request import, two-device cap, idempotent re-export, canceled output, failed output recovery, replacement confirmation/history, backup and restart/open persistence. Test keyboard focus, narrow window, disabled busy buttons and readable errors.
- [ ] **Step 2: Run `node scripts/qa-license-desktop.mjs`.** Expected missing UI scenarios fail; distinguish runtime launch failure from assertions.
- [ ] **Step 3: Implement restrained Chinese UI using the project's existing design conventions.** Unlock panel then two-column order/details view; visible 0/2 count, clear primary action, inline non-secret errors, live status announcements. Provide visible “旧离线授权不能远程撤销” warning in replacement and backup guidance not to issue from multiple copies. Pending actions cannot double-submit. Password state clears on completion and lock.
- [ ] **Step 4: Run actual Electron GUI QA and Node tests.** Expected all scenarios pass; screenshots/test outputs go to a new ignored QA directory, not existing `previews/`. Document any OS permission constraint explicitly.
- [ ] **Step 5: Update merchant instructions and commit.** Explain this is seller-only, no terminal/Node requirement after packaging, vault/password separate backup, personal production initialization, public key safe to export. Message: `feat: complete offline issuer graphical workflow`.

### Task 4: 隔离买家测试包与商家本地安装包

**Files:** Create `scripts/build-license-desktop.mjs`, `scripts/build-local-test.mjs`, `scripts/local-package.test.mjs`; modify root scripts and `.gitignore`; update `LICENSE-GUIDE.md`.

**Interfaces:**
- `build-license-desktop.mjs`: packages standalone runtime, service/core and UI via an explicit file whitelist to ignored `local-deliverables/`; never includes vaults, tests or local state.
- `build-local-test.mjs`: temporary random signer, public-key environment, temporary Tauri config overrides: productName `错题本本地测试版`, identifier `local.mistake.notebook.localtest`; synthesizes certificate for the local machine and deletes temporary private materials in `finally`. Does not mutate `src-tauri/license-public-key.json` or source version. Writes public test certificate/guide separately, never inside buyer resources.
- Output names: `错题本-本地测试版-0.1.10-Intel-Mac.app` / `.dmg`, `错题本发码器-0.1.10-Intel-Mac.app` / `.dmg` when supported. Package contents retain valid internal bundle structure; the output name is not a license/production claim.

- [ ] **Step 1: Add failing package policy tests.** Assert buyer identifier/name differs from formal config, blank formal key remains unchanged, no vault/password/private-key PEM/seller core/test fixture/user notebook in buyer resource manifest, seller whitelist excludes secrets, temporary secrets removed on both success/failure, formal missing-key guard unchanged. Assert scripts abort clearly when disk preflight fails.
- [ ] **Step 2: Run `node --test scripts/local-package.test.mjs`.** Expected missing build policy exports fail.
- [ ] **Step 3: Implement testable package helpers and scripts.** Read-only inspect disk/output locations first. Reclaim only reproducible caches if necessary, preserve existing unique bundles. Use locked dependencies; no real production key or notebook included. Keep offline licensing fail-closed. If `.dmg` creation is unavailable, deliver runnable `.app` and report that boundary.
- [ ] **Step 4: Run policy tests, `npm test`, `npm run build`, Rust tests and `node scripts/qa-license-native.mjs`.** Expected all pass; inspect actual resource manifests after both local builds.
- [ ] **Step 5: Build both Intel Mac packages locally.** Do not generate other-platform tested claims or publish. Commit build scripts and docs, never generated apps or certificates. Message: `build: add isolated local notebook and issuer packages`.

### Task 5: 原生冒烟、自查与交付

**Files:** Create `docs/qa/2026-10-24-native-license-desktop.md`; update guide with actual output paths and limitations.

**Interfaces:**
- Consumes: actual packaged apps and synthetic test certificate from Task 4.
- Produces: evidence-backed report separating automated service/GUI, actual packaged native checks, and manual checks still required.

- [ ] **Step 1: Launch the packaged issuer, not the development entry.** Verify orders/issuance/lock/restart using temporary synthetic vault only; inspect packaged resources for secret leakage. Record launch paths and result.
- [ ] **Step 2: Launch the packaged customer local test app.** Verify independent empty data directory/native machine code; exercise unactivated readonly/export, invalid import, valid import, activation after restart, image import/save/reopen, and sidebar/logo behavior wherever native automation permits. Never alter existing production app data. Mark unavailable native interactions as requiring user testing, not passing via Chrome mocks.
- [ ] **Step 3: Run the full fresh verification suite.** `npm test`, `npm run build`, Node desktop/policy tests, `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked --offline`, native interop and issuer GUI QA; check `git diff --check`, formal blank key, secret scans and resource manifests.
- [ ] **Step 4: Request one independent whole-change code review.** Use requesting-code-review; address blocking correctness/security issues with regression tests and rerun affected suites. No per-task implementer agents.
- [ ] **Step 5: Commit final guide/report and hand off local artifact links.** Explain which app is customer versus seller, test-only buyer status, personal production vault initialization, exact tested OS/architecture, unsigned/notarization limitations and remaining native manual items. Do not merge/push/release without new user authorization.

## Self-review

Spec sections map to service (two-seat/persistence/output), shell (IPC/private boundaries), UI (merchant flows), packaging (key/data isolation and disk), native report (actual runtime evidence). All five Review Focus inputs have explicit tests above. Existing certificate/core interfaces are reused unchanged. No task initializes the user's production vault or claims Windows/Apple Silicon validation.
