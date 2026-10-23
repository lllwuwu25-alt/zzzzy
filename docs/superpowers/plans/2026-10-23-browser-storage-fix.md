# Browser Notebook Storage Fix Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline for this confirmed bugfix. Steps use checkbox syntax for tracking.

**Goal:** Allow large images to be saved reliably in the web preview without losing existing questions.

**Architecture:** A native IndexedDB adapter stores the existing serialized notebook as one transactional record. Store hydration migrates validated legacy data and startup blocks unsafe fallback to an empty notebook after a read failure.

**Tech Stack:** TypeScript, IndexedDB, React, Zustand, Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-browser-storage-fix-design.md`

## Global Constraints

- Preserve original images and existing localStorage backup.
- Do not fall back to small-quota localStorage for new saves.
- Desktop native persistence remains unchanged; no package or publication.

## Review Focus

- Database transaction abort after put success must not report a successful save.
- Migration failure must retain old data and offer retry.
- Invalid stored JSON must not be replaced with a fresh empty notebook.
- An already migrated database must take precedence over stale legacy data.
- Browser database denial/blocking must show recoverable UI, not a blank screen.

### Task 1: Transactional browser persistence and safe hydration

**Files:** Create `src/lib/web-notebook-storage.ts`, `src/lib/storage-errors.ts`, `src/components/StorageRecovery.tsx`, `scripts/qa-web-storage.mjs`; modify `src/store.ts`, `src/main.tsx`, `src/components/CaptureImportDialog.tsx`, `src/components/Organizer.tsx` and existing browser QA scripts.

**Interfaces:** `readWebNotebook(): Promise<string | null>`, `writeWebNotebook(contents: string): Promise<void>`, `storageErrorMessage(error: unknown, fallback?: string): string`. Existing `hydrateNotebook(): Promise<void>` hydrates both runtimes before rendering App.

- [x] Write and run browser regression against the old implementation; large image import must fail.
- [x] Implement IndexedDB reads/writes resolving only on transaction completion; close connections and reject blocked, aborted or denied operations.
- [x] Migrate only validated legacy data, prefer existing database record, and never delete the old backup.
- [x] Add startup recovery UI with retry and specific storage errors; preserve import state on save failure.
- [x] Update browser QA fixtures, persisted-data reads and injected failures to use IndexedDB.
- [x] Verify real-image import/reload, aborted commits, migration retry, corrupt data, stale legacy, blocked/denied storage, then all existing QA and `npm test`, `npm run build`.
- [x] Review the change, address data-safety findings, and commit locally without publishing.

## Verification and review

- RED: real PNG import failed with the old localStorage implementation. GREEN: original 6,606,610-byte PNG persists unchanged across reload.
- Independent reviewer reproduced autosave/trash state divergence. Fixed by queuing mutation functions over committed state and projecting pending synchronous changes; rejection rolls back only the failed mutation. Browser test covers editing then immediately deleting, concurrent imports, catalog/settings changes and failure recovery.
- Structurally invalid `{}` now fails strict IndexedDB validation rather than becoming an empty notebook. Initial migration uses transactional insert-if-absent to preserve a racing tab's existing record.
- `npm test`: 47/47 passed. `npm run build`: passed; existing bundle-size warning remains.
- All five browser QA scripts passed: web storage, AI workbench, review deck, diagrams, and math rendering. Storage QA also covers real blocked-open recovery, denied access, transaction abort after request success, migration retry and stale legacy precedence.
- Scope decisions: existing multi-tab last-writer-wins behavior, fire-and-forget background-error reporting, native desktop fallback semantics and browser eviction policy are not expanded by this fix. Use one editing window and export backups regularly.
