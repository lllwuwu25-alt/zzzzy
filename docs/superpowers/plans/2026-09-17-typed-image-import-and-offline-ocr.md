# Typed Image Import and Offline OCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a preview-ready import flow that groups dropped images, collects a question type for every new mistake, creates records atomically, performs improved offline OCR, and presents type-specific organization and review controls.

**Architecture:** Keep all file entry points converged on `ImageAsset[]`, then feed them into a pure import-flow model before the Zustand store persists records. Add pure question-type and OCR parsing modules around the current Tesseract.js worker so compatibility and parsing are testable without a browser. Keep React components focused by extracting the import dialog and type-specific fields from `App.tsx`.

**Tech Stack:** React 19, TypeScript 5.9, Zustand 5, Tesseract.js 7, Vitest 3, Tauri 2, Rust.

**Spec:** `docs/superpowers/specs/2026-09-17-typed-image-import-and-offline-ocr-design.md`

## Global Constraints

- OCR is offline-first and must never upload an image.
- A multi-image import must choose merge or split before selecting question types.
- Missing printed answers remain empty; the application must not solve questions or generate answers.
- Old mistakes without `questionType` migrate to `short-answer` without losing fields.
- The three file entry points—drop, paste, and picker—must share one flow.
- Do not bump the application version, create a tag, build installers, or publish a release.
- Preserve existing uncommitted OCR placeholder files and `previews/`; do not stage them.

---

### Task 1: Question-type schema and backward-compatible migration

**Files:**
- Create: `src/lib/question-types.ts`
- Create: `src/lib/question-types.test.ts`
- Modify: `src/types.ts`
- Modify: `src/lib/notebook.ts`
- Modify: `src/store.ts`

**Interfaces:**
- Produces: `QuestionType`, `ChoiceContent`, `FillBlankContent`, `ShortAnswerContent`, and `RecognitionState` types.
- Produces: `defaultTypeContent(type: QuestionType)` and `normalizeMistakeType(item: Mistake): Mistake`.
- Produces: `answerTextFor(item: Mistake): string` for search and legacy review output.
- Consumes: current `Mistake`, `Notebook`, and backup parsing conventions.

- [ ] **Step 1: Write migration and answer-sync tests**

```ts
import { describe, expect, it } from 'vitest'
import { answerTextFor, normalizeMistakeType } from './question-types'

describe('question type compatibility', () => {
  it('migrates an old mistake to short answer without losing its answer', () => {
    const migrated = normalizeMistakeType({ question: '旧题', answer: '旧答案' } as never)
    expect(migrated.questionType).toBe('short-answer')
    expect(migrated.answer).toBe('旧答案')
  })

  it('formats choice and fill blank answers for legacy search', () => {
    expect(answerTextFor({ questionType: 'choice', choice: { mode: 'multiple', options: [], correctOptionIds: ['A', 'C'] } } as never)).toBe('A、C')
    expect(answerTextFor({ questionType: 'fill-blank', fillBlank: { blanks: [{ id: '1', answer: '甲' }, { id: '2', answer: '乙' }] } } as never)).toBe('甲\n乙')
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --run src/lib/question-types.test.ts`

Expected: FAIL because `question-types.ts` and new fields do not exist.

- [ ] **Step 3: Add the new schema and pure compatibility helpers**

```ts
export type QuestionType = 'fill-blank' | 'choice' | 'short-answer'
export type ChoiceContent = { mode: 'single' | 'multiple'; options: ChoiceOption[]; correctOptionIds: string[] }
export type FillBlankContent = { blanks: Array<{ id: string; answer: string }> }
export type ShortAnswerContent = { keyPoints: string[] }
export type RecognitionState = { status: 'idle' | 'processing' | 'done' | 'error'; confidence?: number; reviewed: boolean; message?: string }
```

Implement `defaultTypeContent`, `normalizeMistakeType`, and `answerTextFor` in `question-types.ts`. Preserve old `answer` text when migrating. Extend the notebook validator so the new fields are optional for legacy input and strictly validated when present.

- [ ] **Step 4: Normalize all loaded notebooks and new capture records**

Map `normalizeMistakeType` over `items` in `normalizeNotebook`, and make newly created records include `questionType: 'short-answer'`, default type content, and idle recognition state.

- [ ] **Step 5: Run schema tests and the existing notebook suite**

Run: `npm test -- --run src/lib/question-types.test.ts src/lib/notebook.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the schema change**

```bash
git add src/types.ts src/lib/question-types.ts src/lib/question-types.test.ts src/lib/notebook.ts src/store.ts
git commit -m "feat: add typed mistake data model"
```

---

### Task 2: Pure import grouping model and atomic batch creation

**Files:**
- Create: `src/lib/import-flow.ts`
- Create: `src/lib/import-flow.test.ts`
- Modify: `src/store.ts`

**Interfaces:**
- Consumes: `ImageAsset`, `QuestionType`, and `defaultTypeContent` from Task 1.
- Produces: `ImportGroup = { id: string; images: ImageAsset[]; questionType?: QuestionType }`.
- Produces: `groupsFor(images, mode)` and `assignGroupType(groups, groupId, questionType)`.
- Produces store action: `addTypedCaptures(groups: Array<{ images: ImageAsset[]; questionType: QuestionType }>): Promise<string[]>`.

- [ ] **Step 1: Write grouping tests**

```ts
describe('import grouping', () => {
  it('merges images into one group', () => {
    expect(groupsFor([imageA, imageB], 'merge')).toHaveLength(1)
  })

  it('splits images in their original order', () => {
    expect(groupsFor([imageA, imageB], 'split').map((group) => group.images[0].id)).toEqual(['a', 'b'])
  })

  it('does not report ready until every group has a type', () => {
    const groups = groupsFor([imageA, imageB], 'split')
    expect(importReady(groups)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --run src/lib/import-flow.test.ts`

Expected: FAIL because the import-flow module does not exist.

- [ ] **Step 3: Implement the pure grouping helpers**

Use stable image order, generated group IDs, immutable updates, and `importReady(groups)` that requires a valid type on every non-empty group.

- [ ] **Step 4: Write an atomic batch store action**

`addTypedCaptures` must create all `Mistake` values in memory, call `queuePersist(core(next))` once, and call `set(next)` only after persistence succeeds. Each record receives the selected question type and corresponding empty type content. Keep `addCapture` temporarily as a compatibility wrapper or replace all callers in Task 4.

- [ ] **Step 5: Run import and full store-adjacent tests**

Run: `npm test -- --run src/lib/import-flow.test.ts src/lib/notebook.test.ts src/lib/fsrs.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the import model**

```bash
git add src/lib/import-flow.ts src/lib/import-flow.test.ts src/store.ts
git commit -m "feat: add atomic typed capture imports"
```

---

### Task 3: Offline OCR preprocessing, candidate selection, and typed parsing

**Files:**
- Create: `src/lib/ocr-parser.ts`
- Create: `src/lib/ocr-parser.test.ts`
- Create: `src/lib/ocr-preprocess.ts`
- Modify: `src/lib/ocr.ts`
- Modify: `src/lib/ocr.test.ts`

**Interfaces:**
- Consumes: `QuestionType`, `ChoiceContent`, `FillBlankContent`, and `ShortAnswerContent`.
- Produces: `parseRecognizedQuestion(text, type): ParsedQuestion`.
- Produces: `scoreOcrCandidate(candidate, type): number` and `selectBestCandidate(candidates, type)`.
- Produces: `preprocessForOcr(dataUrl): Promise<Array<{ kind: 'enhanced' | 'binary'; dataUrl: string }>>`.
- Replaces `recognizeImage` return value with `RecognizedImage = { text: string; confidence: number }` while keeping progress callbacks.

- [ ] **Step 1: Write typed OCR parsing tests**

```ts
it('splits Chinese choice options and leaves the answer empty', () => {
  const parsed = parseRecognizedQuestion('下列说法正确的是\nA. 甲\nB、乙\n（C）丙', 'choice')
  expect(parsed.question).toBe('下列说法正确的是')
  expect(parsed.choice?.options.map((option) => option.text)).toEqual(['甲', '乙', '丙'])
  expect(parsed.choice?.correctOptionIds).toEqual([])
})

it('extracts an explicitly printed answer from a fill blank question', () => {
  const parsed = parseRecognizedQuestion('中国的首都是____。\n答案：北京', 'fill-blank')
  expect(parsed.question).toContain('____')
  expect(parsed.fillBlank?.blanks[0].answer).toBe('北京')
})

it('separates a short-answer reference answer', () => {
  const parsed = parseRecognizedQuestion('说明光合作用的意义。\n参考答案：储存太阳能。', 'short-answer')
  expect(parsed.question).toBe('说明光合作用的意义。')
  expect(parsed.answer).toBe('储存太阳能。')
})
```

- [ ] **Step 2: Run the parser tests and verify they fail**

Run: `npm test -- --run src/lib/ocr-parser.test.ts`

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement conservative text cleanup and typed parsers**

Recognize option prefixes with anchored multiline patterns, answer headings only when they begin a line, common blank markers (`_{2,}`, `（\s*）`, `( )`, `□+`), and numbered key points. Never synthesize an answer when no answer heading is present.

- [ ] **Step 4: Implement browser-canvas OCR preprocessing**

Load the image, cap the long edge to avoid excessive memory, scale small text up to 2x, crop uniform white margins conservatively, and generate enhanced grayscale plus binary variants. Return the original input as a recognition fallback from `ocr.ts`; do not mutate `ImageAsset.dataUrl`.

- [ ] **Step 5: Run Tesseract sequentially over candidates**

Set page segmentation per question type, collect `data.text` and `data.confidence`, score results using confidence, meaningful character count, and type structure, then return the best normalized result. Reuse one worker and serialize recognition to prevent concurrent worker parameter changes.

- [ ] **Step 6: Run all OCR tests**

Run: `npm test -- --run src/lib/ocr.test.ts src/lib/ocr-parser.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the OCR engine improvements**

```bash
git add src/lib/ocr.ts src/lib/ocr.test.ts src/lib/ocr-parser.ts src/lib/ocr-parser.test.ts src/lib/ocr-preprocess.ts
git commit -m "feat: improve offline typed OCR"
```

---

### Task 4: Shared import controller and grouping/type dialog

**Files:**
- Create: `src/components/CaptureImportDialog.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `groupsFor`, `assignGroupType`, `importReady`, and `addTypedCaptures`.
- Produces: `CaptureImportDialog({ images, skipped, onCancel, onComplete })`.
- Produces: one `beginImport(images, skipped)` callback used by drag, paste, and picker entry points.

- [ ] **Step 1: Replace immediate capture with queued import requests**

Define `PendingImport = { id: string; images: ImageAsset[]; skipped: number }`. `beginImport` appends valid imports to a FIFO queue. Render the dialog for the first request and remove it only after cancel or successful save.

- [ ] **Step 2: Build the multi-image grouping stage**

Show ordered thumbnails and two explicit actions: “合为一题” and “拆成多题”. A single image skips this stage. Closing cancels without calling the store.

- [ ] **Step 3: Build the type stage**

For a merged group show one three-option selector. For split groups show each thumbnail with its own selector. Use native radio inputs, visible focus rings, Escape to cancel, and disable confirmation until every group has a type.

- [ ] **Step 4: Connect atomic save and navigation**

On confirm, call `addTypedCaptures` once, navigate to the inbox, focus the first returned ID, remove the completed request, and start the next queued request. On write failure, keep selections visible and show a retryable inline error.

- [ ] **Step 5: Remove the old post-save grouping bar**

Delete `CaptureGrouping`, `grouping`, and `splitCapture` usage from `App.tsx`. Keep existing drag overlays and supported-format feedback, but change the copy to “松开后选择分组与题型”.

- [ ] **Step 6: Verify keyboard and responsive behavior**

Run: `npm run build`

Manually verify at 100% and 200% zoom that no dialog content clips; Tab reaches every type and action; Escape cancels; mobile-width content scrolls inside the dialog.

- [ ] **Step 7: Commit the import UI**

```bash
git add src/components/CaptureImportDialog.tsx src/App.tsx src/styles.css
git commit -m "feat: add grouped type selection before capture"
```

---

### Task 5: Type-specific organizer and automatic OCR application

**Files:**
- Create: `src/components/QuestionTypeFields.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `src/lib/question-types.ts`
- Test: `src/lib/question-types.test.ts`

**Interfaces:**
- Consumes: the type-specific content types and `parseRecognizedQuestion`.
- Produces: `QuestionTypeFields({ item, onPatch })` with fill, choice, and short-answer editors.
- Produces: `applyParsedQuestion(current, parsed): Partial<Mistake>` that does not replace non-empty user-edited fields.

- [ ] **Step 1: Test that late OCR does not overwrite user edits**

```ts
it('keeps non-empty user text when OCR completes later', () => {
  const patch = applyParsedQuestion({ question: '我已修改', answer: '' } as never, { question: '识别题干', answer: '识别答案' } as never)
  expect(patch.question).toBe('我已修改')
  expect(patch.answer).toBe('识别答案')
})
```

- [ ] **Step 2: Implement safe parsed-result application**

Only fill empty common fields and empty type-specific arrays. Always update recognition status, confidence, and message. Set `reviewed: false`; manual edits in typed fields set it to `true`.

- [ ] **Step 3: Build the three typed editors**

Fill blank supports add/remove blank answer rows. Choice supports single/multiple mode, add/remove option rows, editable labels/text, and correct-answer selection. Short answer supports reference answer plus add/remove key points. All changes use the existing automatic `patch` path.

- [ ] **Step 4: Start OCR automatically for newly created records**

When Organizer opens an item with `recognition.status === 'idle'` and images, mark it processing, recognize images sequentially, save per-image text, parse the combined result, then apply it safely. Keep a visible “重新识别” action for error/done states and prevent duplicate StrictMode runs with an in-flight item ID ref.

- [ ] **Step 5: Make type changes explicit and safe**

Add a compact type selector near the organizer heading. Changing type preserves images, question, common answer, taxonomy, notes, and tags; it resets incompatible structured fields after a confirmation prompt rendered inside the page rather than a system alert.

- [ ] **Step 6: Run focused and full frontend tests**

Run: `npm test -- --run src/lib/question-types.test.ts src/lib/ocr-parser.test.ts`

Run: `npm run build`

Expected: all pass.

- [ ] **Step 7: Commit the organizer change**

```bash
git add src/components/QuestionTypeFields.tsx src/App.tsx src/styles.css src/lib/question-types.ts src/lib/question-types.test.ts
git commit -m "feat: add typed organization workflow"
```

---

### Task 6: Type-specific review interactions and detail compatibility

**Files:**
- Create: `src/components/QuestionAnswerInput.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `src/lib/question-types.ts`
- Test: `src/lib/question-types.test.ts`

**Interfaces:**
- Consumes: `Mistake`, typed content, and existing review `answerText` storage.
- Produces: `QuestionAnswerInput({ item, value, onChange, disabled })`.
- Produces: `serializeResponse(item, responseState): string` so existing review records remain unchanged.

- [ ] **Step 1: Add response serialization tests**

```ts
it('serializes choice and blank responses into the legacy review text', () => {
  expect(serializeResponse(choiceItem, { selectedOptionIds: ['A', 'C'] })).toBe('A、C')
  expect(serializeResponse(fillItem, { blanks: ['甲', '乙'] })).toBe('甲\n乙')
})
```

- [ ] **Step 2: Build review inputs by type**

Choice renders accessible radio/checkbox rows. Fill blank renders one labeled input per blank. Short answer renders the existing textarea. The component emits one serialized string to the current `rate` action.

- [ ] **Step 3: Render structured answers after reveal**

Show correct choices with labels and text, fill answers in blank order, and short-answer reference plus key points. Preserve annotated image masks and the existing four rating actions.

- [ ] **Step 4: Update the detail drawer**

Reuse `QuestionTypeFields` so library edits do not flatten type-specific content. Keep the old answer textarea only for legacy fallback if a malformed record is encountered.

- [ ] **Step 5: Run tests and build**

Run: `npm test`

Run: `npm run build`

Expected: all tests and TypeScript/Vite build pass.

- [ ] **Step 6: Commit review support**

```bash
git add src/components/QuestionAnswerInput.tsx src/App.tsx src/styles.css src/lib/question-types.ts src/lib/question-types.test.ts
git commit -m "feat: add typed review interactions"
```

---

### Task 7: Rust regression checks, visual QA, and preview handoff

**Files:**
- Modify only if tests expose an issue: `src-tauri/src/lib.rs`
- Modify: `README.md` only if preview instructions are missing.

**Interfaces:**
- Consumes: final web and Tauri application.
- Produces: a running local Vite preview URL for user testing.

- [ ] **Step 1: Run the complete automated verification suite**

Run: `npm test`

Run: `npm run build`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Run: `cargo check --release --manifest-path src-tauri/Cargo.toml`

Expected: all commands exit 0.

- [ ] **Step 2: Verify the clean diff and protect unrelated files**

Run: `git status --short`

Confirm the iCloud-offloaded OCR model deletions, `.icloud` placeholders, and `previews/` are not staged or modified by this work. Run `git diff --check`.

- [ ] **Step 3: Perform browser visual QA**

Start: `npm run dev -- --host 127.0.0.1`

Check review, inbox empty state, single-image type selection, multi-image merge/split, three organizer variants, library detail, and 200% zoom. Verify visible focus, dialog scrolling, long Chinese text, error states, and reduced motion.

- [ ] **Step 4: Commit any QA-only fixes**

```bash
git add src/App.tsx src/styles.css src/components/CaptureImportDialog.tsx src/components/QuestionTypeFields.tsx src/components/QuestionAnswerInput.tsx
git commit -m "fix: polish typed capture preview"
```

- [ ] **Step 5: Hand off the preview without packaging**

Keep the Vite server running and provide the localhost URL. Explicitly report that no application version, tag, installer, or release was created.
