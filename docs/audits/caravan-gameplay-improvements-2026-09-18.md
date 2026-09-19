# Caravan Run gameplay and mobile feedback

The five improvements from the gameplay review are implemented locally.

## Resource costs

Fixed stamina and chakra expenditures now require the full amount on both the client and the authoritative server. Percentage costs use the same rounding on both sides, with a minimum cost of one point. A rejected action does not advance the run or consume resources. Heat and bridge encounters have cargo-loss alternatives so exhausted escorts can continue without receiving a free safe crossing.

## Field techniques

Each technique is usable once per mission, in selected encounters. The saved run records its use, and retrying an interrupted response does not charge it twice.

- Scout clone: spend 8% maximum chakra to reveal two additional rows; at the altered patrol marker, also identify the tripwire.
- Cargo seal: spend 12% maximum chakra to protect the load and restore up to 10 cargo at a storm or leaking cargo encounter.
- Tracker reconnaissance: bring an available, owned Tracker companion and spend one pet feed to investigate an abandoned wagon or bypass the roadside raiders. This does not bypass contract bosses. Combat summoning requirements remain separate.

Starter and legacy companions without a saved role use the existing pet-role derivation rules. The client uses the source rules and the server uses the existing generated counterpart; owned instance IDs are resolved to their template identity for this purpose.

## Missions and rewards

The dispatch board displays authoritative base pay. During travel, the mission panel shows numeric objective progress, the current delivery payout estimate, reputation, and whether the objective bonus is included. The estimate and final settlement share the same calculation. The objective adds 10% of cargo-adjusted base pay and five reputation on successful delivery. Purchases still spend the player's Ryo immediately; the estimate describes delivery pay, not net profit.

New help/discovery missions reserve distinct, affordable objective encounters at connected stops. These stops have incoming roads from every node in the preceding row, are marked after scouting, and cannot be replaced by a story follow-up. Random discovery duplication cannot consume the reserved opportunities. Players must still choose the relevant roads and responses, preserve supplies, and finish the mission. Fixed combat checkpoints, the guaranteed rest stop, and bosses are preserved. Existing saved routes are not regenerated.

## Mobile decision feedback

An accessible result strip reports actual changes after a choice or travel leg, including capped gains, spent tools, currency, discoveries, and scouting. These reports are saved in the run and survive reloads. The adjacent objective/payout panel avoids requiring players to compare six resource bars or open the journal. The existing decision/map switch, touch targets, lazy combat loading, and region-specific artwork loading are preserved.

## Verification

- All 23 Caravan state tests pass, including exact-cost boundaries, exhausted alternatives, retry idempotency, companion eligibility, saved feedback, and reward settlement.
- Objective reachability passes for 2,880 generated maps: all four help/discovery contracts, 120 seeds each, and all six weather types.
- The local Vite QA build passes.
- Client and server TypeScript checks and targeted UI ESLint checks pass.
- All ten new gameplay browser scenarios pass across Chromium and WebKit, including rejection of a forged stamina claim, technique costs and limits, starter Tracker support, saved feedback, objective progress, and payout updates. Both accompanying accessibility scans report no violations.
- The complete nine-leg delivery passes, including an interrupted-response retry, reload/resume, mobile combat, supply-cap feedback, and authoritative rewards.
- The existing responsive suite passes all 42 layout checkpoints and two additional accessibility scans, from 320px phones through desktop in Chromium and WebKit. It also verifies 44px touch targets, keyboard focus, retry controls, lazy battle loading, and loading only the current region artwork.

Screenshots: [mobile objective progress](../../.tmp/caravan-improvements-qa/webkit-objective-complete.png), [capped seal recovery](../../.tmp/caravan-improvements-qa/chromium-seal-feedback.png), and [exhausted choice alternatives](../../.tmp/caravan-improvements-qa/chromium-exhausted-choice.png).

Browser evidence is written to `.tmp/caravan-improvements-qa/`, `.tmp/caravan-polish-qa/`, and `.tmp/sunscar-caravan-flow-qa/`. The QA server uses disposable in-memory saves; the tests emulate mobile browsers rather than physical devices.

No deployment was performed.
