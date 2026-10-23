# Offline license preview verification

Scope: permanent offline device-bound certificates, encrypted seller issuer, two-active-record ledger, native enforcement, activation/read-only UI, native JSON export and public-key-only release preflight. Worktree: `codex/deepseek-workbench`. No installers, merge, push or release.

## Automated results

- `npm test`: 71 Vitest tests across 23 files, plus 10 Node issuer/config tests passed.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib --offline`: 16 passed, including signature/device/product/key validation, failed import preserving existing activation, temporary identity retry, actual macOS hardware probe returning only a hash, and backup filtering/destination/atomic replacement.
- `npm run build`: TypeScript and production web build passed. Existing >500 KB chunk warning remains; not a build failure.
- `node scripts/qa-license-native.mjs`: random temporary Node issuer → Rust signature verification passed. The actual compiled build script rejected release with empty public trust configuration. Project public configuration remained unchanged. Temporary synthetic vault removed afterward.
- `node scripts/qa-offline-license.mjs`: isolated Chrome with mocked desktop IPC passed activation → read-only table/view/export → bad import → successful import → stale focus-status race → reload → settings, 390 px layout and night/paint themes. Native export commands were invoked before activation and returned simulated user-chosen paths; no notebook write was made while inactive.
- `node scripts/qa-workbench.mjs`: one-click AI, no local OCR, suggestion apply/undo/cancel, failed-save retry, navigation and motion passed. DeepSeek responses were intercepted; no real paid API calls.
- `node scripts/qa-web-storage.mjs`: 6.6 MB synthetic image, legacy migration, reload, failed/aborted save, corrupt/denied/blocked storage recovery and concurrent mutations passed.
- `node scripts/qa-review-deck.mjs`: three review records and modal/deck interactions passed without page errors.
- `node scripts/qa-themes.mjs`: five skins across eight surfaces, text contrast, persistence, keyboard, reduced motion, narrow/200% layout, original image invariance and denied preference storage passed.
- `node scripts/qa-question-tables.mjs`, `qa-review-math.mjs`, `qa-question-diagram.mjs`: tables/options, legacy one-line recovery, editable source, formulas, compact card viewports and non-destructive figure crop passed.
- `git diff --check`: passed. Source/public-config/dist scan found no production private key, vault or issuer password in the distributed frontend. Seller tool remains outside frontend imports and bundle resources; no tracked vault/certificate files.

Activation screenshots visually inspected: default, night, painted theme. Output stays under `/tmp`; existing untracked `previews/` is untouched.

## Important limits of this verification

Chrome IPC mocks are not proof of an installed Tauri app or an actual OS save dialog. Rust filesystem, signature and actual Mac identity tests are real; Windows registry lookup, Intel Mac/Apple Silicon packaged activation, OS save dialogs and installation must still receive native-machine smoke testing before sale. Release CI now runs JS/native/interoperability checks, but was not triggered in this task.

No production private key was initialized. `src-tauri/license-public-key.json` intentionally has an empty key; official packaging is blocked until the seller personally initializes the vault and configures its exported public key. The developer preview is explicitly non-production.

Offline constraints remain: manual replacement cannot revoke an old certificate; cloned system identifiers, modified/recompiled clients, older unlicensed releases and ledger rollback are not prevented. These limitations are stated in `LICENSE-GUIDE.md`.

## Independent review and verified fix

One independent fresh-context read-only reviewer identified one Important issue: release checks rejected the RFC public fixture key but accepted this repository's deterministic Rust fixture roots. No other Important findings or deferred minor issues were reported.

Added a Node regression deriving the public keys from the published test seeds, and a regression invoking the actual compiled Rust build script with both fixture public keys. Observed both fail before the fix; added the fixture public keys to both release denylists; reran the full 71 Vitest + 10 Node + 16 Rust suite and the native interoperability/preflight script successfully. The latter now reports `fixtureKeysRejected: true`. No production key was created.

## Implementation decisions

- Seller tool is a Chinese-menu local Node CLI, not an HTTP service: strict serverless operation and separate seller ownership; tradeoff is requiring Node/terminal use on the seller computer, not the buyer's.
- Use the available maintained ed25519-dalek 2.2.0; project compiler minimum declaration moves to Rust 1.81, and existing dependency graph/CI uses stable. This is a developer toolchain change, not an end-user OS requirement.
- Use the Rust Tauri dialog plugin for user-selected JSON exports because WKWebView can cancel unhandled HTML downloads. Tradeoff: a native dependency and real OS dialog smoke tests before shipping.

Branch remains local in its existing worktree for preview testing; no integration or distribution action was taken.
