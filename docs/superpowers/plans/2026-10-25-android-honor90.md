# HONOR 90 Android Test APK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build the existing notebook as an arm64 Android test APK for HONOR 90 / Android 15, without publishing a release or changing main.

**Architecture:** Keep React, Tauri, Notebook v1 and the existing sync protocol. Add an Android-native bridge for Keystore-encrypted credentials, system browser and document export; retain the same server-enforced device admission. Android test identity is separate from the commercial desktop identity. No App Secret or signing private key is embedded.

**Tech Stack:** React 19, TypeScript, Tauri 2, Rust, Kotlin, Android Keystore, GitHub Actions.

**Spec:** User-approved Android APK approach in this conversation; `docs/feishu-sync/README.md` and existing Feishu V1 plan remain the sync constraints.

## Global Constraints

- Branch `codex/android-honor90-test` only; no main writes, tag or public Release.
- Test-only application ID `local.mistake.notebook.androidtest`; Android release builds fail closed until mobile commercial admission is defined.
- Test sandbox may edit offline; cloud reads/writes still require server session and confirmed device. It does not unlock desktop licensing.
- Keep all existing data, queued mutations, original images and desktop trust keys.
- Missing HTTPS service/Feishu credentials must be reported, not replaced by a mock successful connection.
- Do not install SDK/NDK on this low-space host. Generate Android project and compile in CI.

## Review Focus

- A pasted/scanned foreign QR URL must not open arbitrary sites or change account scope.
- Android native initialization must not use desktop drag listeners or shell commands.
- A failed Keystore read must not fall back to plaintext or discard credentials silently.
- Closing OAuth browser without completion must preserve the local notebook.
- APK signing/install success is not evidence of real phone or Feishu sync success.

### Task 1: Android platform and native storage boundary

**Files:** `src/lib/platform.ts`, platform tests, `src-tauri/src/android.rs`, `src-tauri/android/NotebookMobilePlugin.kt`, Android configuration and preparation script/tests.
**Interfaces:** `nativeAndroidBuild(): boolean`; native `android_runtime_info`, secure read/write/delete callable by Rust only; existing notebook read/write commands keep schema and atomic commits.

- [ ] Write tests for Android build discrimination, allowlisted binding URLs and deterministic Android project preparation.
- [ ] Run targeted tests; expect missing implementation failures.
- [ ] Implement test-only identity, guarded Android local write policy, native Keystore bridge and desktop-safe cfg boundaries.
- [ ] Run tests, TypeScript and existing Rust tests; expect pass.

### Task 2: Mobile workflow and Feishu pairing

**Files:** CloudApplication, CloudSettings, sync controller, mobile CSS, Android scanner/capabilities and native export.
**Interfaces:** scanner returns a validated binding intent; controller uses existing OAuth/pending/confirm API; desktop license remains unchanged.

- [ ] Add failing tests for binding validation and mobile device metadata; run to observe failure.
- [ ] Add scan/paste pairing, Android system browser, private secure sessions, offline test sandbox and mobile-safe workspace UI.
- [ ] Add native document export and gallery/camera entry using existing import pipeline; no new data format.
- [ ] Verify frontend, gateway and Rust suites; document untested physical-device paths.

### Task 3: CI APK and handoff

**Files:** `.github/workflows/android-test.yml`, Android test guide, Feishu acceptance record.
**Interfaces:** Actions uploads arm64 debug APK plus SHA256 and test instructions, no release/tag operation.

- [ ] Add build-contract tests proving no release/main trigger and correct ABI/config.
- [ ] Configure JDK/SDK/NDK and compile current code in CI; read actual compiler results and fix failures.
- [ ] Verify APK package ID, SDK/ABI and signing in CI, upload artifact; report exact run URL.
- [ ] Record local test evidence separately from HONOR 90 / Feishu real tests (not yet executed).

## Execution record

User explicitly requested execution after choosing APK, target phone and CI approach. Reuse the existing isolated worktree. Preserve unrelated `previews/`. No additional architecture approval loop is needed.
