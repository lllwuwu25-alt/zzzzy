# Sidebar wordmark and expansion regression

- User-approved final styling: original footer position, no background plate or outline. White lettering on ink/plum/night sidebars; black lettering on mist/paint sidebars. Original image bytes remain unchanged.
- Reproduced expansion bug with requestAnimationFrame measurements: restoring display before the 72→216 px width transition wrapped footer text; footer height briefly reached 395.6 px instead of 178.4 px and the toggle moved vertically by over 200 px.
- Fix: reserve the expanded footer's layout geometry, clip/fade hidden content instead of removing it from layout, animate the toggle's horizontal position with sidebar width, and prevent generic hover transforms from adding vertical movement.
- `node scripts/qa-sidebar-motion.mjs`: failing before fix, passing after fix; per-frame footer size and toggle vertical position, rapid toggling, keyboard focus and reduced-motion behavior checked.
- `node scripts/qa-brand-logo.mjs`: five-theme screenshot pixel checks verify correct solid letter color, no opposite-color outline, unchanged image hash, transparent surroundings, original placement, collapse and narrow/short-window behavior.
- `node scripts/qa-themes.mjs`: five skins / eight surfaces passed contrast, persistence, keyboard, reduced motion, narrow/200% layout and original-image preservation checks.
- `npm test`: 71 Vitest + 10 Node tests passed. `npm run build` and `git diff --check` passed. The existing production chunk-size warning remains.
- Chrome screenshots for plum and mist visually inspected. Only local preview/source changed; no packaging or publishing.

## Follow-up: dark rectangle during logo fade

- Reproduced a distinct rendering issue not covered by geometry-only frame checks: at opacity 0.378, the ink-theme logo corner became RGB 10/29/33 instead of the sidebar's 16/47/53. The opacity group isolated the blend operation, revealing the opaque source background during the fade.
- Replaced screen/multiply blending with a small SVG filter that derives actual alpha from the supplied wordmark. Light themes apply brightness(0) after alpha extraction; dark themes retain white. No outline or background plate is generated.
- `qa-brand-fade.mjs` fails against the blending implementation and passes after the fix. It freezes three intermediate transition times in each of five themes (15 frames), checking screenshot background pixels instead of only final styles or layout.
- Re-ran the existing brand pixel/position/hash checks, sidebar motion/rapid/keyboard/reduced-motion checks, complete JS tests and production web build. Original image remains unchanged.
