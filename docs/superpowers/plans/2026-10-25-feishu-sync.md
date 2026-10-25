# Feishu local-first sync implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the specified OAuth → automatic library → approved device binding → local-first synchronization flow to the existing notebook, not a demo.

**Architecture:** Preserve the current Notebook v1 and existing atomic JSON/IndexedDB persistence. Add a versioned sync envelope to the same durable notebook commit, with a backup and stable UUID mapping before first attachment. A single-instance Node 24 TypeScript-compatible ESM gateway with SQLite WAL serializes library commits, stores encrypted tokens and coordination metadata, and uses the user's Feishu Bitable as business storage. Browser mobile uses the existing React application with same-origin HttpOnly sessions; native sessions use OS credential storage. No developer secret is shipped to clients.

**Tech Stack:** Existing React 19, TypeScript 5.9, Zustand, Vite 7, Tauri 2, Rust; gateway Node >=24.13 with built-in SQLite and node:test.

**Spec:** `/Users/qichen/Desktop/错题本_飞书云同步_Codex需求文档_V1.md` (693 lines, fully read). The user explicitly requests executing its default design without further generic design approval; only substantive platform/repo conflicts are grounds for alternatives.

## Global Constraints

- Work only on `codex/feishu-sync-v1`; do not merge, push, package, publish, or touch `previews/`.
- Preserve local functionality and native offline sales licensing. Mobile cloud access is independently admitted by gateway, not a local flag bypassing desktop licensing.
- `account_id + library_id + environment` partitions local sync data. Ordinary login never uploads a previous account's data.
- Single-instance gateway, durable SQLite. App Secret and Feishu tokens only on backend; browser session HttpOnly+CSRF, native session Keychain/Credential Manager.
- First active device server-controlled; later OAuth sessions pending until confirmation. All data and attachment routes enforce this.
- No real OAuth/two-device PASS without actual credentials, reachable HTTPS, and physical device evidence.
- Existing simplified stability/difficulty scheduler remains unchanged; concurrent divergent scheduling is a conflict, never silently replayed as exact FSRS.
- Never upload workspace paths, credentials, offline licenses, theme or UI preferences.

## Review Focus

1. Crash after remote create/update before SQLite finalization: reconcile by stable ID, mutation ID and content hash before any retry.
2. Delayed acknowledgments while local edits continue: never clear newer outbox mutations or replace their images.
3. OAuth on an existing account from a blank browser must remain pending on every data route.
4. Account/environment switching with queued data must preserve old partition and never enqueue it in the new account.
5. Partial image/review groups, tombstones and snapshot replay must not report complete or discard local changes.

## P0 — inspected baseline and design choices

React/Zustand Store persists whole Notebook v1 JSON, Tauri app copy and optional workspace copy; web IndexedDB. No server, mobile entry, identity or sync exists. Images retain original data URL, editorVersion=2, original-coordinate annotations, crop, rotation, source dimensions, diagrams. Taxonomy is a nested name hierarchy. Reviews store before/after schedules and answer text. IDs are prefixed UUIDs; preserve editor image IDs and local item IDs, maintain stable cloud UUID mapping rather than breaking diagrams/review references. `fsrs.ts` is a project-specific simplified scheduler, not the official FSRS package. Production web currently cannot pass native license gate; mobile must have a separate restricted gateway-authenticated entry.

### Task 1: Gateway security and persistence (P1/P2)

**Files:** `tools/sync-gateway/{config,db,crypto,auth,bindings,server}.mjs`, tests, SQL migrations.
**Interfaces:** Gateway ESM HTTP application, node:sqlite DatabaseSync; session `{accountId,deviceId,status}`. Public endpoints `/v1/status`, `/v1/auth/feishu/start`, callback, exchange; authenticated me/devices/bindings and data routes. Feishu adapter passed as dependency in tests, real adapter in startup.
- [ ] Write and run failing tests for config fail-closed, one-time state/exchange, first/pending devices, wrong-account/expired/replayed binding, revocation and CSRF.
- [ ] Implement persisted encrypted credentials, hashed session/binding tokens, fixed callbacks and allowlisted origins; no secrets or payload logs.
- [ ] Run `node --test tools/sync-gateway/*.test.mjs`; use real SQLite temporary files, remote API doubles only at HTTP boundary.

### Task 2: Feishu adapter and commit protocol (P1/P3)

**Files:** `tools/sync-gateway/{feishu,sync}.mjs` and tests.
**Interfaces:** OAuth code/refresh/userinfo; Bitable create/meta/tables/fields/record list-search-create-update; media upload/download. Bootstrap+sync via `SyncService(db, providerForAccount)` with stable per-library revisions, SQLite intents and changes.
- [ ] Verify current official endpoint/scope contracts, write failing transport tests.
- [ ] Implement idempotent bootstrap with persistent stages; unknown remote creates stop for reconciliation rather than blind retries.
- [ ] Write failing crash/retry/conflict/account-isolation tests; implement serialized commits, tombstones, high-water snapshots, recoverable intent finalization and bounded payload limits.
- [ ] Implement immutable content-addressed assets before question publication, append-only reviews, external-change detection and explicit unsupported capabilities.
- [ ] Run gateway tests and retain local-vs-live distinction.

### Task 3: Existing Notebook adapter and durable outbox (P3)

**Files:** `src/sync/{model,protocol,engine}.ts`, tests; `src/types.ts`, `src/store.ts`, `src/lib/notebook.ts` (parent integration).
**Interfaces:** JSON-serializable `SyncState`; pure prepare/ack/apply operations consume existing Notebook types; whitelist business entities, stable UUID migration mapping, asset dependency ops. Existing persistence writes Notebook+outbox together.
- [ ] Write failing tests for source image/editor preservation, UUID stability, sensitive-field exclusion, queued edits/acks, conflicts, tombstones, account isolation and review undo.
- [ ] Implement backup-before-attach and explicit initial preview/confirmation; neither account switches nor remote snapshots erase pending local data.
- [ ] Preserve original scheduler, append review facts, conflict divergent schedule state.
- [ ] Run new tests plus existing `npm test` and `npm run build`.

### Task 4: Integrated cloud settings, mobile and native session (P1/P2/P3)

**Files:** `src/components/sync/*`, `src/sync/client.ts`, mobile CSS/service worker; `src-tauri/src/sync_session.rs`; existing main/settings entry.
**Interfaces:** Same-origin web API/cookie, native gateway bearer from system secure storage; deployment-only public gateway URL. QR one-time URL only. UI derives status from persisted queue and server confirmation.
- [ ] Test API error/pending admission and UI state transitions before implementation.
- [ ] Add existing settings section, connect/poll/bootstrap/first-sync controls, binding approve/reject, pause/disconnect, conflicts and diagnostics.
- [ ] Adapt existing app for mobile camera/file input and sync entry; offline cached bundle, no gateway response caching and no token localStorage.
- [ ] Verify build, browser widths/focus/reduced-motion and Rust tests where environment permits.

### Task 5: Deployment, migration and honest acceptance record (P4)

**Files:** `docs/feishu-sync/{README,developer-setup,user-guide,data-mapping,production-checklist,verification}.md`, `docs/feishu-permissions.md`, gateway `.env.example`, Docker/reverse proxy and backup materials.
- [ ] Provide exact ordered self-built-app setup and real scopes/official links; ordinary users never configure developer credentials or table IDs.
- [ ] Execute full local suite/build/security checks; record A01–A25 individually with local evidence versus real tests not executed.
- [ ] Fresh-context whole-change review, fix substantive findings with regressions.
- [ ] Report code delivered / local tests / real Feishu / real devices / platform approval separately, with concrete remaining blockers.
