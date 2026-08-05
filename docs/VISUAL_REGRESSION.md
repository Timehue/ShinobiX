# Visual regression pilot

The pilot protects four high-value, deterministic release surfaces: the desktop and mobile landing heroes, the desktop character-creator entry, and the authenticated Central Hub shell. It intentionally does not snapshot combat canvases, generated content, or long pages with lazy-loaded media.

## Canonical environment

- Windows, Chromium, 1366×768 unless the test sets the 390×844 mobile viewport.
- Reduced motion and dark color scheme.
- A fixed wall clock, disabled CSS animation/transition timing, hidden carets, and loaded web fonts.
- Canvas and video regions are masked because GPU output is not pixel-stable.
- API data is a small deterministic fixture; this suite is visual-only. Real Express authority is covered by `e2e-live`.

## Commands

Build the client first, then run:

```powershell
npm run test:e2e:visual
npm run test:e2e:visual:size
```

Baseline updates are reviewable and explicit:

```powershell
npm run test:e2e:visual:update
npm run test:e2e:visual:size
```

Never use the update command merely to make a failure green. Inspect the diff images under `test-results/visual`, confirm the product change is intended, then review the PNG change like source code. The baseline budget allows at most eight PNGs and 3 MiB total.

The GitHub workflow is manual (`workflow_dispatch`) and runs on `windows-latest`, the canonical snapshot platform. It is separate from default pull-request CI so browser/font rendering differences cannot become an accidental merge gate.
