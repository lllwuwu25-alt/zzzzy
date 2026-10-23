# Five Skins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement five complete, persistent local app skins.

**Architecture:** A typed theme registry supplies semantic CSS variables and tiny setting previews. Apply the persisted choice before React mounts; existing styles consume shared tokens instead of fixed light colors. Keep image/canvas pixel rendering untouched.

**Tech Stack:** Existing React, TypeScript, CSS, Vitest and Playwright. No dependencies.

**Spec:** docs/superpowers/specs/2026-10-23-five-skins-design.md

## Global Constraints

- Five skins: 墨青 (ink), 雾白 (mist), 暮紫 (plum), 夜读 (night), 彩绘 (paint).
- Preserve layout, system fonts, original images, annotation colors and all data flows.
- Persist locally; invalid preference falls back to ink; initialize before mount.
- No packaging, release, cloud or new dependencies.
- Respect reduced motion; body/secondary/placeholder/button contrast at least 4.5:1.

## Review Focus

- Unavailable localStorage: usable session selection plus visible persistence warning (Task 1/2).
- Previously saved invalid values: fallback to ink, not a blank screen (Task 1).
- Late-loaded component styles: math/table/review styles must use theme variables too (Task 2 browser QA).
- Images/annotation canvases must retain their original colors (Task 2 browser QA).
- Keyboard, narrow windows, and reduced motion must work for all five choices (Task 2 browser QA).

### Task 1: Theme model and startup

**Files:** src/lib/themes.ts, src/lib/themes.test.ts, src/main.tsx

**Interfaces:** ThemeId; themes registry with names, preview colors and semantic tokens; getThemePreference(): ThemeId; applyTheme(id: ThemeId): void; setThemePreference(id: ThemeId): boolean.

- [x] Add failing tests for exact five IDs/default, invalid and blocked storage, immediate document application and contrast pairs.
- [x] Run tests and observe missing implementation failure.
- [x] Implement registry/persistence with guarded browser access; set root data-theme, color-scheme, semantic properties, and meta theme-color. Apply before hydration.
- [x] Run entire Vitest suite; commit theme model and tests.

### Task 2: Full themed UI and verification

**Files:** src/components/ThemeSettings.tsx, ThemeSettings.test.tsx, theme-settings.css; src/themes.css; existing style files; src/components/SettingsPage.tsx; scripts/qa-themes.mjs; docs/qa/2026-10-23-themes.md.

**Interfaces:** ThemeSettings consumes Task 1 APIs and renders a radio group with five mini previews, current selection and persistence feedback; all existing components use registry semantic CSS properties.

- [x] Add failing render test expecting five labeled radio choices and default selected.
- [x] Implement preview selector and local status; integrate beside motion settings.
- [x] Mechanically convert fixed UI colors to semantic variables, preserving annotation canvas/image pixels and dark backdrop controls. Add restrained paint accents only outside task content.
- [x] Create isolated browser acceptance for all skins, reload persistence, keyboard selection, blocked writes, all main pages, import dialog, editor, table/formula review, 390px and reduced motion. Check computed contrast and preserve image data.
- [x] Run npm test, npm run build, git diff --check and browser regressions; inspect screenshots.
- [x] One independent whole-change review; fix important findings with regression tests; commit and hand off preview without packaging.
