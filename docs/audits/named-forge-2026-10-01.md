# Named gear currency, reveal, and probability audit

Date: 2026-10-01. Scope: named weapons and all six named armor selections. Evidence: local source, server integration tests, sampled roll tests, and mocked-API browser journeys. This report does not certify deployment or production economy outcomes.

The owner requested Fate Shards as the sole accepted currency and a pop-out showing the rolled item. The previous 1,000-point price and five points per shard yield **200 Fate Shards per forged item**. The server checks eligibility before generating a roll and checks payment again when forging it. Payment remains at forge settlement. Other currency balances are preserved; retries return the same minted item without another debit. The level-90 gate remains in force.

Authority: [payment policy](../../shared/named-forge-economy.ts), [roll definitions](../../shared/named-forge-roll.ts), [server generator and item builder](../../api/craft/_named.ts), and [settlement handler](../../api/craft/named.ts). UI copy consumes those shared definitions. Existing combat formulas remain authoritative for effect magnitude; the audit does not retune combat.

## Findings and corrections

| Finding | Classification | Correction / evidence |
| --- | --- | --- |
| Mixed currencies could fund named items. | Implementation drift against this request | Fate Shards alone fund both gear kinds; integration coverage includes weapon, head, chest, waist, legs, feet, and gloves. |
| UI advertised EP 30–35 at 16.7% each; server rolled 24–27. | Implementation drift in odds display | UI uses shared EP bounds, 25% per value. |
| UI claimed each tag appeared on about 8.3% of rolls. | Implementation drift in odds display | Per-roll appearance is 12.5%, accounting for the dual-tag branch. |
| Reveal was inline and automatically disappeared after about three seconds. | Implementation drift against this request | Portaled modal animates toward the player, displays sealed stats, and awaits Continue; keyboard focus returns to the correct opener. |
| Shield was described as hit-scaled, Heal as 400/200 HP, and Ignition as the next two attacks. | Implementation drift in effect copy | Descriptions now follow `applyJutsu` and combat formulas: flat mastery-scaled Shield/Heal, and a two-turn Ignition status. |
| Rounded armor percentage values have smaller endpoint probability. | Matches runtime, disclosure gap | Explain uniform sampling before rounding and approximately half-weight endpoints; preserve the existing generator. |
| Economy handoff listed named forging as 1,000 Ryo. | Config/export drift | Export and regenerated economy artifacts now identify a 200 Fate Shard sink. |
| Named weapon offense rolled +168–180 in each discipline, but the generic 420-point hand budget reduced it to +104–105 in combat and non-strict saves (the +169 outcome floors to +104 because of floating-point scaling). | Design ambiguity resolved by owner on 2026-10-01 | Owner explicitly chose to retain rolled offense in combat. Named weapons with valid current/legacy minted IDs and the hand slot now receive a 720-point total budget (`4 × shared offense maximum`). Generic hand items and gloves retain 420; armor retains 280. |

## Probability calculations

For an inclusive uniform integer range, each value has probability `1 / (max - min + 1)`.

| Roll dimension | Current outcomes | Probability |
| --- | --- | --- |
| Weapon EP | 24–27 | 25% each |
| Weapon range | 3, 4, 5 | 1/3 each (displayed 33.3%) |
| Weapon offense, shared across four disciplines | 168–180 | 1/13 each (~7.7%) |
| Weapon tag count | One or two distinct tags | 50% each |
| A particular tag on a weapon roll | Twelve tags, uniform draw without replacement | `0.5 × 1/12 + 0.5 × 2/12 = 12.5%` |
| A particular single-tag result | Twelve possible tags | `0.5/12 = 4.1667%` per roll |
| A particular unordered dual-tag pair | 66 pairs | `0.5/66 = 0.7576%` per roll |
| Non-Poison authored tag percentage | Single: 35–40; dual: 15–20 | 1/6 per value, conditional on the branch and tag |
| Poison potency | 12% | Fixed, conditional on drawing Poison |
| Armor quality for five DR slots | Elite, Legendary, Mythic | 1/3 each; raw DR contributions 6%, 7%, 8% |
| Armor offense and defense | Each independently 25–35 | 1/11 per value (~9.1%) |
| Armor special | Absorb, Shield, Reflect, Life Steal, Increase Damage | 20% each |
| Armor Shield amount | Integer 75–150 | 1/76 each, conditional on Shield (~1.316%) |
| Armor Absorb/Reflect/Life Steal | 0.08–2.00%, rounded to hundredths | Interior bins ~0.5208%, endpoints ~0.2604%, conditional on special |
| Armor Increase Damage | 0.75–1.50%, rounded to hundredths | Interior bins ~1.3333%, endpoints ~0.6667%, conditional on special |

Armor percentage sampling uses one million uniformly selected points before rounding; the bin figures are approximations, not assertions of exact uniform hundredths. The mutually exclusive outcome distributions total 100% before display rounding. Tag appearance probabilities sum to 150%, correctly representing an average of 1.5 tags per weapon rather than an exclusive outcome table. Gloves receive stats and a special but no damage reduction; their unused quality draw is not presented as a benefit.

## Combat interpretation

Authored percentages and effective combat magnitude are different quantities. [Combat formulas](../../api/combat-core/formulas.ts) and [the shared combat resolver](../../api/pvp/move.ts) cap weapon percentage buffs at 35%, Poison at 12%, and unranked weapon Wound at 25%. Single-tag authored values above a cap remain sealed for compatibility; the UI discloses the cap rather than promising the excess. Heal, Shield, and Drain use real combat mastery rather than tag count or the authored percentage. Siphon uses final damage after mitigation and shield absorption. Ignition modifies damage taken for two turns and participates in pooled amplification; armor DR similarly participates in the mitigation pool. Armor Shield contributes starting shield, not maximum HP.

These are verified runtime semantics, not a new accepted combat rebalance. Revisit when the combat caps, flat-effect formulas, named price, tag pool, quality pool, or generator distribution changes. Shared roll definitions and regression tests are the protection against another stale odds display.

Follow-up owner decision: preserve named weapons' +168–180 offense in combat. [The item budget](../../api/_item-budget.ts) now allows their legitimate 672–720 total offense. This applies during save normalization and the shared item lookup used by PvP and PvE/Tower hydration. Existing rank stat ceilings still apply after equipment bonuses; this decision does not remove those ceilings. It does not restore legacy definitions that were already persisted at +104–105, because their original random outcome is not recoverable from that value alone; recovery would require an intact original registry definition or other authoritative evidence.

## Validation

- 55 targeted tests passed: payment, all armor slots, registry failure recovery, retry idempotency, guides, combat formulas, and weapon behavior.
- Roll audit sampled 24,000 weapons and 24,000 armor pieces. It checks tag uniqueness, Poison strength, bounds, item construction, and distribution agreement using a conservative 15% relative tolerance. Formula inspection supplies the exact odds; samples are a regression check, not proof of exact probability.
- Eight Chromium browser checks passed across 1366×768 desktop and 360×640 mobile: shard-only eligibility, persistent weapon reveal, armor and glove reveal, reduced motion, focus restoration, viewport containment, and failed-roll recovery. Screenshots were visually reviewed.
- Server and client TypeScript checks passed, as did ESLint on the changed client components/API helper and the whitespace/error check of the changed tracked files.

## Follow-up integration verification

The route registry mounts `/craft/named`; App passes its versioned save coordinator into CentralHub. Forging accepts the returned character/version before adding the definition to the client item catalog. The dedicated browser fixture now exercises that callback, naming and settlement for weapons, chest armor, and gloves. Fourteen Chromium desktop/mobile checks passed, including these complete journeys.

All 190 cross-system regression tests passed after the budget correction. The suite verifies generated shop catalog parity, registry recording and recovery, stale-save definition preservation, forged gear isolation from shared content, level gates, shared combat hydration, combat tags, EP behavior, and stale/foreign save-version rejection. New real-API integration tests prove full inventory preserves the wallet/token for retry, concurrent forges charge one 200-shard balance only once, and client-authored stats cannot override the sealed roll. Named-weapon budget regression coverage checks every offense outcome through normal player saves and PvP/PvE hydration and retains the other item ceilings.

Final server and client TypeScript checks passed. Targeted ESLint passed without warnings, and the changed tracked files passed `git diff --check`.

Reproduce server audit with `node --import tsx --test api/craft/_named.test.ts api/craft/named-registry.integration.test.ts api/pvp/_weapon-damage.test.ts api/combat-core/_formulas.test.ts shinobij.client/src/data/guides.test.ts`. From `shinobij.client`, reproduce browser checks with `node node_modules/@playwright/test/cli.js test --config playwright.named-forge.config.ts`.

No project context or state index required updating: this report records a bounded implementation audit, while payment and numeric roll truth remain in their shared source files.
