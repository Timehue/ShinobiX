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
