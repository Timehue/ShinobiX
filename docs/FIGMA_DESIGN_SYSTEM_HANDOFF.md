# Figma design-system handoff

The source of truth remains [`shinobij.client/src/styles/tokens.css`](../shinobij.client/src/styles/tokens.css). `docs/generated/design-tokens.json` is a generated, reviewable handoff—not a second token authority.

## Regenerate and verify

```powershell
npm run export:tooling-handoffs
npm run check:tooling-handoffs
```

The exporter reads every CSS custom property from the canonical token file, retains `var(...)` aliases, categorizes tokens, records source lines, parses the documented responsive ranges, and inventories actual width/height media-query use across client CSS. Commit the JSON whenever its source changes. CI or release certification can call the check command to reject drift.

## Figma import mapping

Create one Figma Variables collection named **ShinobiX Core**. Import groups in this order so aliases resolve:

1. `color`, including palette, semantic, village, rarity, and status variables.
2. `spacing`, `radius`, and `layout` as number/dimension variables.
3. `typography`; use font-family tokens in text styles, and size/line-height/weight tokens as variables where the chosen importer supports them.
4. `motion`, `shadow`, and `z-index` as documentation/developer handoff variables if the plugin cannot represent those natively.

Token names map directly: JSON key `sj-surface` ↔ CSS `--sj-surface`. The `com.shinobix` extension records the category and exact CSS source location. Do not flatten semantic aliases such as `accent → gold-500`; recreate the alias so later palette changes propagate.

The JSON follows the Design Tokens Community Group shape (`$value`, `$type`) but includes a wrapper for collections and breakpoint metadata. If a plugin expects bare DTCG groups, select `collections["ShinobiX Core"]` before import. Breakpoints are documentation and component-frame presets, not Figma variables.

## Component workflow

- Build components from semantic tokens, not raw palette values.
- Use village colors only for affiliation; status always retains text/icon semantics.
- Use the documented frame ranges (`xs` through `xxl`) and verify at the exact boundary values inventoried in `observedQueries`.
- Figma is downstream. A proposed visual change returns as a CSS-token/source change first, then the export is regenerated.

## Component and state inventory

Treat `shinobij.client/src/components/ui` plus `src/styles/ui.css` as the reusable primitive set:

| Component | Figma variants/states |
|---|---|
| Button | `sm/md/lg`, primary/secondary/danger/ghost/success/info, default/hover/active/focus-visible/disabled, inline/block |
| Close and back controls | default/hover/focus-visible/disabled; 44 px touch-target wrapper on touch layouts |
| Panel | ordinary/interactive/selected/disabled plus empty/loading/error content states |
| Modal | `sm/md/lg/bare`, open/closing, scrollable body, destructive/ordinary action footer |
| Badge | semantic status and rarity variants; always pair color with text/icon |
| Progress bar | determinate/indeterminate, ordinary/success/warning/danger, labelled/unlabelled |
| EmptyState and LoadingState | title/body/action, compact/full-panel |
| GameAlert/GameToast | notice/success/warning/error, queued/dismissing, live-region behavior |

`AdaptiveGameShell`, desktop rails, `MobileNav`, `MobileProfileSheet`, `MobileStatusHUD`, and notification bars form the shell family. Feature-scale surfaces such as combat HUDs, Central Hub cards, visual novels, maps, and pet arenas should be represented as compositions of primitives, not promoted into generic components merely because they appear in Figma.

Desktop uses two rails and a bounded content stage; compact/tablet layouts collapse rail content; mobile replaces rails with bottom navigation and sheet/HUD surfaces while respecting safe-area insets and the exported mobile-nav clearance tokens. The code and `docs/ui/adaptive-layout-authority-map.md` decide which authority owns each viewport—not a detached Figma frame.

Accessibility annotations are required on component frames: keyboard focus order, visible focus, accessible name, disabled semantics, modal focus containment/return, live-region priority, non-color status cue, minimum touch target, text reflow/overflow, reduced-motion behavior, and decorative-image marking. Validate final implementation with the existing axe, keyboard, overflow, image, and viewport Playwright suites.
