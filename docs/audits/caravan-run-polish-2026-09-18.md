# Caravan Run polish and mobile verification

Implemented in the working tree; no deployment performed.

- Phones and tablets open on the next decision, with a separate route-map view. Resources remain above the decision controls, and saved actions bring the next encounter into view.
- The map fits its available width at 100%, keeps 48px stop targets, supports zoom and keyboard selection, and allows scrolling back onto the page at its vertical boundary.
- Larger mobile text, 16px select inputs, aligned resource meters, explicit low-resource colors, and a way to return from inspecting a road to the other available roads.
- Travel previews share the server's cost calculation, including every-third-leg heat/morale costs and supply-shortage damage. Travel rules and rewards are unchanged.
- Pending departure/choice state prevents conflicting actions. Errors focus and scroll into view; interrupted mutations retain their original request ID for retry. Initial and reset-day reads now also have a timeout.
- Memoized map rendering and indexed road endpoints remove repeated map work during unrelated updates. Caravan battle code loads on battle entry.

## Verification

- `node --import tsx --test shared/sunscar/caravan.test.ts`: 13 tests passed, including 192 travel-cost/resource combinations.
- Client TypeScript build and ESLint for the three changed client TypeScript modules passed.
- `npm run build` in `shinobij.client`: passed. `node scripts/check-build-size.mjs`: passed.
- `sunscar-caravan-polish-qa.mjs`: 42 layout checkpoints across Chromium and WebKit at 320×568, 390×844, 844×390, 768×1024, and 1440×900. No page overflow, controls smaller than 44px, or JavaScript errors. Both automated accessibility scans passed. Touch navigation, keyboard map reselection, lazy battle loading, and recovery from a lost travel response passed.
- `sunscar-caravan-browser-qa.mjs`: completed all nine legs, resumed after reload, retried a lost choice response, opened the real mobile battle screen, and verified supply-cap messaging against saved state.
- `sunscar-caravan-resource-qa.mjs`: six entry/map/exit cycles returned to the same timer/listener baseline. Collected heap moved from 3,346,752 to 3,903,524 bytes; one-second idle task samples were 0.267ms before and 0.114ms after. These are local samples, not device benchmarks. One earlier sweep timed out on re-entry; the rerun completed all six cycles without JavaScript errors.

Browser checks use disposable in-memory saves and emulated touch viewports, not physical devices. Existing unrelated working-tree changes were preserved.

## Local evidence

- [Phone decision](../../.tmp/caravan-polish-qa/chromium-390x844-decision.png)
- [Small-phone map](../../.tmp/caravan-polish-qa/chromium-320x568-map.png)
- [Desktop road inspection](../../.tmp/caravan-polish-qa/chromium-1440x900-inspection.png)
- [Layout and accessibility report](../../.tmp/caravan-polish-qa/report.json)
- [Journey report](../../.tmp/sunscar-caravan-flow-qa/report.json)
- [Resource-cycle report](../../.tmp/sunscar-caravan-resource-qa/report.json)

Run the browser scripts sequentially against `scripts/sunscar-modes-qa-server.mts`; they reset the same isolated QA save. Build that harness with `vite build --config scripts/vite.sunscar-modes-qa.config.mjs --mode sunscar-modes-qa` from `shinobij.client`.
