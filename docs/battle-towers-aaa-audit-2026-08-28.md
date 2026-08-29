# Battle Towers AAA Audit — 2026-08-28

## Verdict

Battle Towers is functionally complete across Story, Endless Spire, party entry/recovery,
authoritative combat, settlement, responsive presentation, encounter art, and combat VFX.
The audit found and fixed two player-facing boss-mechanic gaps and replaced oversized encounter
boards with a tested adaptive arena ladder. No missing Story floor art,
enemy portrait, biome board, pylon, ward, shrine, font, hazard, obstacle, or required boss VFX
asset remains in the shipped manifests.

## Scope audited

- Central Hub entry, lobby campaign presentation, Ready Room, Story/Spire launch contracts,
  reconnect/AFK recovery, authoritative action handling, and idempotent settlement.
- All 15 authored Story floors, all 20 Endless Spire tiers, Story bosses, Spire bosses,
  clan-boss Tower encounters, delayed waves, objectives, terrain, hazards, board objects,
  phase gates, and boss strikes.
- Enemy template stats, rank caps, tactical roles, authored techniques, target policy,
  art keys, and fail-closed unknown-template behavior.
- Desktop and narrow-mobile combat hierarchy, targeting, accessibility, reduced motion,
  missing-image behavior, console health, and a real interactive action/VFX cycle.

## Issues found and fixed

### Boss protection had two authority leaks

Adds-gated bosses correctly rejected direct damage, but Basic Clear could remove their buffs
and Smoke Bomb could apply its field debuff. The client also highlighted a protected boss as a
legal target, leading to a rejected command. The engine now applies the barrier consistently to
Clear and field debuffs, and the client removes the boss from legal target highlights while
rendering an animated, reduced-motion-safe protection ring with an accessible label.

### Boss mechanics lacked payoff VFX

Boss strikes had a telegraph but no detonation effect. Phase summon/enrage/aegis/pillar beats,
geyser eruptions, closing-ring impacts, and regeneration were log-only, and a later plate could
replace an earlier plate from the same round-end mutation. The engine now publishes and combines
deterministic cosmetic plates for strike impact, phase shockwave, aegis/bulwark, summons, enrage,
erupted pillars, geysers, the closing ring, and regeneration. These reuse the existing reviewed
`heavy`, `shield`, `shadow`, `buff`, `earth`, `magma`, and `heal` assets; no duplicate artwork was
needed.

### Desktop squad rail left tactical space unused

The desktop squad rail ended after its actor cards, leaving a large non-functional block beside
the battlefield. It now carries a live Combat Intel dossier sourced from authoritative encounter
state: objective orders and progress, boss portrait/health/aegis/barrier/phase threshold, plus a
contextual legend containing only the hazards, pylons, wards, fonts, shrines, objectives, and
terrain present in the current fight. The panel is intentionally suppressed below 1024px so
narrow screens keep their full board and action hierarchy.

### Oversized boards diluted encounter readability

Story previously reached 24×18 and Spire bosses reached 24×18, leaving excessive travel and
visually undersized actors on common desktop layouts. The sealed content catalogs now share three
reviewed footprints: 16×10 for early Story encounters, 18×12 for standard Story and Spire fights,
and 20×14 for Story milestones, clan bosses, and upper Spire tiers 11–20. Every procedural system
continues to derive from the sealed map dimensions, including spawn halves, seven-tile feature
flowers, terrain, board objects, vents, reinforcements, telegraphs, phase pillars, pathfinding,
closing rings, zoom, and pan bounds.

The smaller travel distances changed several Spire time-to-kill samples. Six tier-local boss HP
values were minimally recalibrated against the existing deterministic release bands; shared combat
math, player stats, rewards, modifiers, and Story enemy power were not changed. Catalog versions
were advanced so active runs remain sealed to the content version they started with.

### Follow-up integration pass closed two presentation seams

The public lobby catalog was still stored under the pre-adaptive-arena client cache key. Combat
was safe because a fresh start always seals the authoritative floor, but a returning lobby could
retain stale floor metadata for up to five minutes. The cache schema is now `tower-floors:v5`, and
cached map dimensions must be positive integers before the payload is accepted.

The developer lobby harness had also drifted from production: it stopped at Floor 10, described
every encounter as 20×14, omitted required DTO fields, and left the Ready Room in a simulated
reconnect failure. It now mirrors all 15 Story floors, both chapters, the exact adaptive ladder,
valid artwork keys/objectives/round budgets, and the idle party/recovery endpoints. This restores
the harness as a trustworthy visual QA surface without changing live gameplay authority.

## Enemy and encounter assessment

- Chapter 1 enemies form a readable bandit squad: skirmisher/wound, ranged artillery,
  blocker/shield-stun, brute/push, and acolyte/control-poison.
- Chapter 2 advances that grammar with Stormglass lancer displacement, marksman pressure,
  bastion barriers, and weaver seal/recoil/reflect control.
- Story and Spire bosses have distinct multi-technique kits, legal capped stats, clear phase
  identities, and deterministic board pressure. Unknown template IDs fail visibly rather than
  silently spawning a generic or broken enemy.
- The Story sequence mixes clear, timed defense, escort, staged-break, adds-first, and boss
  objectives, with mechanically truthful briefings and unique encounter art.

## Verification evidence

- Complete Tower/Spire automated surface: **582 passed, 0 failed** across 54 isolated test files.
- Adaptive-layout stress: all 15 Story floors, all 20 Spire tiers, and all four clan-boss floors
  built collision-free for full four-player squads across eight deterministic seeds each. Every
  actor and delayed reinforcement remained in bounds and unique; all feature flowers, terrain,
  objects, and hazard vents remained complete and non-overlapping.
- Story real-engine soak: **180/180 terminal clears** (15 floors × 12 deterministic seeds)
  using a coordinated geared four-player squad. Floor 15 averaged 15.3 rounds and remained
  clearable; timed/escort/staged objectives all terminated correctly.
- Endless Spire real-engine balance gate passed its early-tier floor, baseline floors 8–20, and
  all five rotating weekly-blessing sweeps. Floors 13–17 remain `HARD`; floors 18–20 remain
  `WALL`; no geared `BRICK WALL` appeared.
- Client production build, TypeScript build, story-content check, and Vite bundle completed.
- Repository server TypeScript build completed with no errors.
- Browser audit at 1440×900 and 390×844: 10 actors rendered, 33 images loaded, 0 broken
  images, 0 console/page errors, 0 horizontal overflow, action dock visible on mobile, boss
  protection present, and a live Attack emitted two VFX nodes.
- Combat Intel follow-up at 1440×900: the new 593px dossier fills the rail without internal or
  page overflow, explains all seven active field systems in the audit fixture, and loads every
  image. At 390×844 it is hidden as designed and the tactical board remains 369px tall. A scoped
  Axe scan reported 0 violations (17 checks passed), and a live Attack still resolved with VFX.
- Adaptive-grid browser follow-up at 1440×900 rendered the new standard 18×12 footprint as exactly
  216 semantic tiles and 10 actors in a 996×359 board, with 34/34 images loaded, no console errors,
  and no horizontal overflow. The live Attack reduced its target from 300 to 160 HP and published
  a VFX node. At 390×844, the same 216-tile board remained 378×369, the action dock remained visible,
  Combat Intel collapsed as intended, and page width stayed exactly 390px with no broken images.
- Final tie-in pass: **70/70** focused catalog/cache/sealing/engine assertions passed, followed by
  **566/566** assertions across all 54 Tower-related test files. Client TypeScript, scoped lobby/fight
  lint, server TypeScript, story-content verification, and the 2,733-module production client build
  all completed successfully.
- Fresh lobby-harness browser load rendered 15 Story cards in two chapters, 20 Spire rungs, an open
  Ready Room, and 17/17 healthy images with no console warnings or horizontal overflow. A fresh live
  combat load rendered the 18×12 grid as 216 unique coordinates with 10 actors and 34/34 healthy
  images; Attack resolved 300→160 HP and emitted the reviewed impact VFX. At 390×844, page width
  remained exactly 390px, the 368×347 board and 368×243 action dock stayed visible, and only the
  desktop Combat Intel rail collapsed as designed.

## Residual release risks

- Run one authenticated two-to-four-human staging session before release to exercise real
  storage, websocket latency, reconnect timing, and reward settlement against the deployed
  environment. Those external systems cannot be fully certified by a local deterministic run.
- Use production telemetry to validate Story difficulty for real level-30 entrants. The soak
  proves correctness and a viable geared ceiling; it is not a substitute for live cohort tuning.
