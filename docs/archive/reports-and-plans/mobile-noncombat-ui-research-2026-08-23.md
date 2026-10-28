# Non-combat mobile UI research and product decisions

Date: 2026-08-23
Scope: authenticated player screens below 980px, excluding every active combat view.

## Competitive patterns

- **Hordes.io** keeps the core in-game surfaces persistent and lets players move,
  lock, and reset panels. The transferable lesson is stable navigation and
  predictable panel ownership rather than forcing every destination into the
  persistent bar. Source: [Hordes.io User Interface](https://hordesio.wiki.gg/wiki/User_Interface).
- **Flyff Universe** keeps chat resumable from a compact preview, uses contextual
  item actions instead of exposing every command at once, and embeds inventory
  where item-dependent tasks need it. Its mobile windows are responsive rather
  than scaled-down desktop canvases. Source: [Flyff Universe Mobile Interface](https://madrigalinside.com/guides/beginners-guide/mobile-interface/).
- **RuneScape Mobile** explicitly enlarged dropdowns, buttons, text, and backpack
  slots; adapted child-window height; kept search usable around the software
  keyboard; and minimized chat while preserving notifications. Source:
  [RuneScape Mobile UI update](https://forums.rs/en/294%2C295%2C386%2C66023934.html).
- **Flyff Universe's technical FAQ** treats modern Android and iOS browsers as
  first-class clients alongside desktop browsers. Source:
  [Flyff Universe device FAQ](https://universe.flyff.com/news/faqtechnicaldevices).

## Applied product decisions

1. Keep five thumb-reachable anchors: character, travel, village, items, and the
   complete menu. Tavern and character-detail duplication moved out of the
   persistent rail without becoming harder to find.
2. Make the complete menu searchable and keyboard-safe. Search receives focus,
   filters destinations immediately, closes on Escape, and restores focus to its
   trigger.
3. Enforce a 44px minimum pointer target and 48px, 16px-text form controls across
   non-combat routes and their dialogs/sheets.
4. Turn large route-family tab sets into readable horizontal rails with stable
   active states. Keep Mission Hall's compact five-tab rail in normal flow.
5. Stack desktop decision grids, contain wide data tables, preserve coordinate
   maps as horizontal stages, and give visually compact map pins a 44px hit ring.
6. Reserve safe-area-aware space for the HUD, bottom navigation, onboarding
   guidance, modal sheets, and the software keyboard.
7. Reduce motion when requested and preserve visible focus throughout the shell.
8. Treat Character as a dossier rather than a long settings page: keep its
   section rail reachable, make the next tab visibly discoverable, and group
   identity, record, build, jutsu, and legacy information by player intent.
9. Turn Training and Jutsu Training into action-first curricula. Training uses
   compact swipeable guidance and stat families before the duration choice;
   Jutsu Training keeps the selected lesson, cost, duration, and unlock action
   ahead of the full archive.
10. Give Healer, Vanguard, and Pet Tamer separate mobile command-center states,
    with role-colored heroes, readable rank progress, profession-specific
    resources/bonuses, and thumb-safe action grids. Do not treat one profession
    fixture as coverage for all three.

## Combat boundary

`AdaptiveGameShell` receives an explicit `data-ui-mode` derived from the same
active-battle decision that controls battle chrome. All authenticated rules in
the new mobile layer require `data-ui-mode="noncombat"`; portaled surfaces require
`body:not(.in-battle)`. No combat board, HUD, action, log, or combat stylesheet is
targeted by this work.

## Verification coverage

The dedicated audit now executes 97 artwork, modal, route, navigation, profession,
Mission Hall, public-profile, and cinematic checks across desktop and 390px mobile
projects (with five intentional project-specific skips). Healer, Vanguard, and
Pet Tamer are booted as separate saves. The audit checks horizontal containment,
clipped controls, broken foreground/background art, meaningful content, runtime
errors, 44px touch targets, map-marker hit rings, menu focus behavior, progress
semantics, and route interactivity.
