# ShinobiX Media Kit

This folder contains GitHub-ready media that shows real app screens.

## Current Assets

Captured 2026-08-30 from the running client at 1440x900, JPEG q92 - the same
frames were 0.6-1.1 MB as PNG and are about a sixth of that as JPEG, with no
visible softening of the UI text at the size the README renders them:

- `docs/screenshots/landing.jpg` - the public landing page (README hero).
- `docs/screenshots/character-creator.jpg` - the Academy Gate.
- `docs/screenshots/village-select.jpg` - the four rival villages.

Older but still current-looking, kept as-is:

- `docs/screenshots/shot-bloodlines.png` - starter bloodline selection.
- `docs/screenshots/shot-village.png` - a visual-novel story scene.

`demo.gif` and `combat.png` were REMOVED. They were captured 2026-07-13 and the
game went through roughly 128 visual commits after that - the Veiled Steel
material pass, real typefaces, the combat HUD redesign - so they showed a build
no player would recognise. The combat shot also had a giveaway: the account in
it is literally named `ReadmeCapture0707`, and the enemy is an unstyled cyan
placeholder. The README claimed visitors "see real app screens"; showing those
made the claim false.

## Refreshing them

```bash
npm run dev --prefix shinobij.client              # one shell
npm run capture:screenshots --prefix shinobij.client -- http://127.0.0.1:5173
```

`shinobij.client/scripts/capture-screenshots.mjs` drives a headless browser
through the public funnel and overwrites the three files above. It exists
because the July pass was manual, and a manual pass is exactly why these went
seven weeks stale while the README insisted they were real app screens.

**It deliberately stops before the account step.** Creation runs Gate -> Village
-> Bloodline -> Avatar -> Preview -> Account, and everything past Preview needs a
real account and password. So combat, the village hub, the Pet Yard and
everything else below still need a human with a throwaway account, the way the
July 2026 pass did.

## Recommended Next Captures

Add these once staging is stable:

- Landing page with the full hero copy visible.
- Village hub after Academy onboarding is dismissed.
- Mission Hall without tutorial overlay.
- Inventory/equipment screen.
- World Map or sector exploration.
- Battle Tower fight.
- Pet Arena or Pet Yard.
- Clan Hall or Clan Boss.

## Short Trailer Shot List

A 45-60 second trailer should show:

- 0-5s: landing page and Play Now click.
- 5-12s: character creation, village, bloodline, avatar.
- 12-22s: village hub, Logbook, and training.
- 22-35s: Mission Hall into tactical combat.
- 35-45s: world map, tower, pets, or clan systems.
- 45-60s: beta call to action, Discord, and GitHub star prompt.

Keep the trailer honest: use real gameplay captures, label beta systems, and do
not imply gated late-game systems are fully polished.
