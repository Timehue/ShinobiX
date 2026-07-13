# UI Route and Component Inventory

Audit date: 2026-07-13.

## Frontend architecture

- React 19 + TypeScript 6 + Vite 8.
- Route-level state uses the canonical `Screen` union in `src/types/core.ts`; `App.tsx` lazy-loads most major screens.
- Global shell: `LeftProfileCard`, `RightMenu`, `MobileNav`, `MobileStatusHUD`, journey banner, notifications, alert/confirm hosts, and per-screen error/suspense boundaries.
- Styling: one large legacy `index.css`, feature skins, tokens/UI primitives, a late normalization layer, and the final `veiled-steel.css` migration layer.
- Icons: `react-icons` Game Icons for the main shell; older screens still contain text symbols and emoji requiring incremental replacement.

## Screen inventory

| Group | Screens |
| --- | --- |
| Entry and account | start, villageLore, profile, userHub, userView, messages |
| Core journey | village, centralHub, worldMap, logbook, missions, hunting, training, jutsuTraining |
| Character systems | inventory, bloodlineMaker, professions, professionPicker, pets, petArena, petLadder |
| Combat | arena, battleArena, arenaDistrict, pvpBattle, storyBoss, weeklyBoss, eventPetBattle, sectorPet |
| Village and economy | townHall, bank, shop, grandMarketplace, hospital, cafeteria, tavern, clan, shinobiCouncil |
| World conflict | villageWar, villageWarMap, sectorCard, tilecardsDuel |
| Dungeons and towers | dungeon, hollowGateShrine, hollowGateTiles, endlessTower, battleTowers |
| Cards and story | shinobiTiles, eventTiles, cardClashFreePlay, storyHall, sunscarFestival, hallOfLegends, guides |
| Administration | adminLogin, adminPanel |

## Rendered route coverage

The overhaul was visually inspected in the running game, not only from source.

- Entry and shell: landing/start, character entry, Stormveil village, Daily Briefing, desktop rails, mobile status/nav, and the mobile menu.
- Core journey: Missions, Training Grounds, Jutsu Training, Logbook, Tavern, and World Map.
- Character systems: profile/dossier, Inventory and Equipment (including the shared item inspection sheet), Pet Yard, Bloodline Forge, and Professions.
- High-priority feature surfaces: Battle Arena lobby, an active AI practice battle, Story Hall dialogue, and Town Hall status/management.
- Additional desktop route checks: village, Pets, Bloodline, Professions, Logbook, Tavern, Missions, and Jutsu Training.

## Responsive verification matrix

| Viewport | Representative routes verified |
| --- | --- |
| 360 x 800 | Inventory and Equipment |
| 390 x 844 | Inventory sheet, World Map, Pet Yard, Tavern, Professions, Arena lobby and active combat, Story Hall, Town Hall |
| 430 x 932 | Inventory, Professions, and mobile menu |
| 768 x 1024 | Professions and Training |
| 1024 x 768 | Inventory and Training compact desktop/tablet-landscape layout |
| 1440 x 900 | Village, Profile, Inventory, Training, Missions, Jutsu Training, Logbook, Pets, Bloodline, Professions, Tavern, World Map, Arena, Story Hall, Town Hall |
| 1920 x 1080 | Inventory, Training, and Professions wide-desktop containment |

All listed responsive checks had zero horizontal document overflow. Phone interaction checks use a 44px minimum for the controls touched in this pass.

## Shared-component inventory

| Capability | Shared implementation |
| --- | --- |
| Screen context | `ScreenContextHeader` |
| Buttons | `ui/Button` |
| Panels/materials | `ui/Panel` |
| Modal / mobile sheet behavior | `ui/Modal` |
| Badges | `ui/Badge` and legacy `Pill` styles |
| Resource/progress bars | `ui/ProgressBar`, `MobileStatusHUD`, combat HUD resources |
| Loading and empty | `ui/LoadingState`, `ui/EmptyState`, `ScreenLoadingFallback` |
| Alerts and confirmation | `GameAlertHost`, `GameConfirmHost` |
| Navigation | `RightMenu`, `MobileNav`, `BackToVillageButton` |
| Notifications | `NotificationBar`, `MobileNotificationBar`, `ToastStacks` |

## Audit findings

- 203 player-facing TSX/CSS source files were scanned.
- 4,870 hex color occurrences, 2,684 inline style blocks, and 1,139 raw `<button>` elements remain in the legacy codebase.
- 68 files contain modal/overlay/dialog patterns.
- The largest risk is cascade debt in the monolithic legacy stylesheet, including repeated shell breakpoints and very high historic z-index values.
- The migration boundary is deliberate: all routes receive the Veiled Steel tokens and shell layer immediately; feature markup moves to shared primitives when touched.
- Legacy player and admin feature files outside the rendered matrix still contain hardcoded colors, inline styles, and text-symbol icons. They inherit the shared shell/material layer, but their internal markup is documented migration debt rather than falsely claimed as individually art-directed.

## Priority migration order

1. Combat HUD and target/action confirmation.
2. Inventory inspection drawer and rarity labels.
3. Missions, training, and cooldown/reward cards.
4. Story/visual-novel controls and dialogue surfaces.
5. Village economy and dense ranking tables.
6. Admin inputs, tables, and modal consolidation.
