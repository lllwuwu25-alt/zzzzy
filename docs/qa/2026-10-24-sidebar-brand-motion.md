# Sidebar wordmark and expansion regression

- User-approved final styling: original footer position, no background plate or outline. White lettering on ink/plum/night sidebars; black lettering on mist/paint sidebars. Original image bytes remain unchanged.
- Reproduced expansion bug with requestAnimationFrame measurements: restoring display before the 72→216 px width transition wrapped footer text; footer height briefly reached 395.6 px instead of 178.4 px and the toggle moved vertically by over 200 px.
- Fix: reserve the expanded footer's layout geometry, clip/fade hidden content instead of removing it from layout, animate the toggle's horizontal position with sidebar width, and prevent generic hover transforms from adding vertical movement.
- `node scripts/qa-sidebar-motion.mjs`: failing before fix, passing after fix; per-frame footer size and toggle vertical position, rapid toggling, keyboard focus and reduced-motion behavior checked.
- `node scripts/qa-brand-logo.mjs`: five-theme screenshot pixel checks verify correct solid letter color, no opposite-color outline, unchanged image hash, transparent surroundings, original placement, collapse and narrow/short-window behavior.
- `node scripts/qa-themes.mjs`: five skins / eight surfaces passed contrast, persistence, keyboard, reduced motion, narrow/200% layout and original-image preservation checks.
- `npm test`: 71 Vitest + 10 Node tests passed. `npm run build` and `git diff --check` passed. The existing production chunk-size warning remains.
- Chrome screenshots for plum and mist visually inspected. Only local preview/source changed; no packaging or publishing.
