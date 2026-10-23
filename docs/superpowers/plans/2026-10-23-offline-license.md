# Offline License Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a testable, offline two-device signing workflow without generating production keys or installers.

**Architecture:** A separate Node built-in-crypto issuer owns encrypted private keys and a durable two-seat ledger. Rust verifies domain-separated Ed25519 certificates against a build-time public key and current machine; React presents activation/read-only access without carrying authority.

**Tech Stack:** React/TypeScript, Rust/Tauri, ed25519-dalek, sha2, target-specific winreg; Node built-ins only for issuer.

**Spec:** docs/superpowers/specs/2026-10-23-offline-license-design.md

## Global Constraints

- Permanent offline licenses; two active issuer records per purchase; repeat device issuance is idempotent.
- Preserve original notebook data, read/export access and five themes. No production private key generation, installer build, push or release.
- Exact v1 envelope and signed domain/payload fields are defined in the spec; no frontend unlock booleans accepted by Rust.
- Release builds fail without a configured public key; development preview must be explicitly labeled.
- Seller tool stays separate from src/dist and never starts a server or logs private key/password material.

## Review Focus

- Two issuer processes or a crash after ledger commit must not create an unrecorded extra seat (Task 1).
- Corrupt/forged/cross-device certificates must not overwrite the prior valid activation (Task 2).
- Frontend-only bypass must not authorize native writes; blank startup must not destroy or migrate data unsafely (Task 2/3).
- Lost authorization, bad machine identity or storage failure must leave read/export usable (Task 3).
- Build/test fixtures must not become a production trust root or leak issuer secrets into dist/CI (Task 4).

### Task 1: Issuer protocol and durable local seller tool

**Files:** tools/license-admin/core.mjs, cli.mjs, *.test.mjs, launcher scripts; package.json; .gitignore.
**Interfaces:** IssuerVault.create/open(path,password); createPurchase(label); issue(purchaseCode,machineCode,label); replace(purchaseCode,oldMachineCode,newMachineCode,label,reason,acknowledged); list(); publicConfig(); close(); export certificate after durable commit. Machine-code helpers and protocol constants shared within issuer only.

- [x] Write Node tests for password encryption, two-seat cap, idempotency, replacement audit, lock conflict, corrupt vault, write failure and recovery; observe RED.
- [x] Implement Ed25519 certificate generation, encrypted vault validation, process lock and atomic encrypted persistence; add Chinese interactive CLI with hidden password prompts and explicit output locations.
- [x] Add npm license:admin / test:license and run Node tests plus full Vitest; commit.

### Task 2: Native trust, machine identity and enforcement

**Files:** src-tauri/src/license.rs, license_tests.rs, Cargo.toml/lock, build.rs, src-tauri/license-public-key.json, src-tauri/src/lib.rs, ai.rs.
**Interfaces:** get_license_status() → {state,canWrite,machineCode?,platform,purchaseCode?,licenseId?,message}; import_license(contents) → same; require_write(app) → Result; pure verify(contents,publicKey,deviceId) and machine fingerprint helpers.

- [x] Add failing Rust tests for valid signed certificate, altered fields/signature, wrong product/device/key, strict size/schema and unauthorized write policy.
- [x] Implement native identity and strict verify; persist valid activation atomically only; compile-time trust config and release fail-closed check.
- [x] Guard native writes/image import/AI recognition; register commands; verify Node-issued fixtures in Rust and preservation after invalid import.
- [x] Run Rust suite plus existing frontend and issuer tests; commit.

### Task 3: Activation, safe read-only access and settings

**Files:** src/lib/license.ts, license context/activation/readonly/settings components + tests/styles, main.tsx, SettingsPage.tsx.
**Interfaces:** typed LicenseStatus adapter; LicenseBoundary loads native status, opens activation/read-only, refreshes on activation; LicenseSettings shows current state and activation action.

- [x] Write failing UI/adapter tests for required/active/development/preview/error states and readable export without write actions.
- [x] Implement machine-code copy/request export, bounded file import, clear errors, live status, and read-only notebook viewer/export; no native activation in browser preview.
- [x] Integrate root boundary and settings preserving normal App and all themes; test with mocked native IPC in isolated browser, not real keys or data.
- [x] Run all local tests/build and browser regressions; commit.

### Task 4: Distribution safeguards, seller instructions and final audit

**Files:** release.yml, LICENSE-GUIDE.md, README.md, security fixture/interoperability scripts, docs/qa.

- [x] Make release CI require the public configuration and run issuer/Rust validation before packaging; never add a private-key secret to CI.
- [x] Document seller init/backup/create/sign/re-download/manual replacement and public-key setup, user activation/read-export, irreversible private-key loss and offline limitations.
- [x] Run cross-language and fail-closed release preflight checks, full JS/Rust/build tests, isolated activation and existing theme/table/AI flows; inspect activation screenshots.
- [x] Request one independent final read-only security review; fix important findings with RED→GREEN tests, then commit and hand off preview without packaging.
