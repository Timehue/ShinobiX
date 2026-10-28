# Machinations economy-model handoff

`docs/generated/economy-model.json`, `economy-faucets.csv`, and `economy-sinks.csv` are generated from server-authoritative catalogs and constants. They are analysis inputs only; importing or editing a Machinations diagram never changes live balances.

## Regenerate and drift-check

```powershell
npm run export:tooling-handoffs
npm run check:tooling-handoffs
```

Every CSV row includes its authority file. The JSON also captures daily caps, shop currency selection, pet breeding time/uses/odds, war-resource upkeep and tax parameters, shrine limits, and the exclusions/assumptions needed to avoid mistaking the model for runtime authority.

## Suggested model structure

Create resource pools for each JSON `currency`. Import the faucet CSV as source-to-pool flows and the sink CSV as pool-to-drain flows. Use stable `system:id` pairs as node IDs so regeneration can update values without creating duplicates.

Model in this order:

1. Account onboarding and daily login.
2. Separate daily mission and hunt gates, then repeatable combat missions.
3. Ryo/Fate shop drains and one-off service/crafting drains.
4. War Resources: sector daily sources → capped pool → maintenance, declarations, sector wars, and mercenaries.
5. Shrine offering as a pure variable Ryo drain.
6. Pet breeding as a delayed gate with per-pet use depletion; its species/chromatic/apex outputs are probabilities, not currencies.

Use one model tick as one day for cap, login, territory, maintenance, and tax analysis. Treat per-claim/per-purchase flows as player-action converters whose trigger rates are scenario inputs. Run low/base/high activity scenarios rather than inventing a single “average player.” Model discounts and upgrade multipliers as tunable modifiers around the exported base values.

## Validation and round trip

- Compare imported node/flow counts with `economy-model.json` counts and reject unknown currency names.
- Keep formulas in code; the export intentionally records human-readable formulas where the amount is level- or balance-dependent.
- Export Machinations scenario results as a separate CSV under an analysis ticket or report. Never overwrite these generated inputs with tool output.
- Any balance proposal must cite affected stable IDs and return through a reviewed source-code change, authoritative tests, telemetry review, and regeneration. This handoff introduces no balance or schema change.
