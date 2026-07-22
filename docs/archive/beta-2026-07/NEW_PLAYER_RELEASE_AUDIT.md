# New Player Release Audit

Date: July 7, 2026

Scope: source inspection plus local validation of the Part 2 polish changes. A live fresh-account browser pass is still required against the deployed save store.

## Verdict

New-player onboarding is beta-viable with monitoring. The game has a clear landing page, a multi-step character creator, an Academy path, starter gear, starter jutsu, a starter companion, first training guidance, mission guidance, and a persistent next-goal pin.

Do not call the game fully public-release-ready until a real staging/live fresh account completes registration through first mission claim without save-store or mobile layout issues.

## First 30 Minutes Checklist

| Step | Status | Notes |
| --- | --- | --- |
| Landing page | Ready | Real game art, Play/Log In/Guides/Leaderboard are visible. |
| Registration | Ready | Character creator explains village, bloodline, avatar, and account identity. |
| Login | Ready | Session restore notice and password visibility controls exist. |
| Character creation | Ready | Village choice explicitly says it has no hidden stat bonuses. |
| Village selection | Ready | Each village has flavor copy and a preview. |
| Specialty/bloodline choice | Ready | Bloodline cards show combat type, element, and starter jutsu. |
| First save | Needs live smoke | Creation pushes to server; must verify against production save overlay. |
| First tutorial flow | Ready | Academy path guides companion, training, jutsu, loadout, inventory, spar, heal, mission, logbook, sector return. |
| First training action | Ready | Guided coach points to Training Grounds. |
| First mission | Ready | Academy Trial and Mission Hall copy are clear. |
| First hunt/explore | Monitor | World Map hint now tells players to return before pushing too far. |
| First combat | Ready with monitor | Academy spar explains AP, Basic Attack, Jutsu, Wait, and HP win condition. |
| First reward | Ready | Trial/checklist rewards exist; combat reward trust is gated for higher tiers. |
| First item/equipment | Ready | Inventory is part of the Academy path. |
| First PvP/PvE prompt | Monitor | PvE is guided first; PvP should remain a later opt-in. |
| Major menus | Improved | One-time hints now cover bank, arena, jutsu, missions, pets, professions, shop, town hall, marketplace, and card hall. |

## Fixes Implemented

- Added public-beta notices for risky or soft-launch systems.
- Expanded contextual first-open hints for major player-facing screens.
- Kept player AI image generation admin-only by default unless `ENABLE_PLAYER_AI_IMAGE_GENERATION=1`.
- Added release-readiness metadata tests and release-flag tests.

## Launch Issues

| Severity | Issue | Recommendation |
| --- | --- | --- |
| P0 | Fresh-account save path has not been verified against live/staging `saveStore`. | Run registration through first mission claim on the deployed URL. |
| P1 | Brand naming still mixes repository/game language: ShinobiX versus Shinobi Journey. | Decide the public brand before wider invites. |
| P1 | Major systems are dense for new players if opened early. | Keep beta notices and one-time hints; do not push war/creator modes in first-session CTAs. |
| P2 | Some late systems are likely desktop-first. | Treat Hollow Gate and dense war views as desktop-first until mobile checks pass. |

## Manual Staging Required

1. Create a brand-new account.
2. Complete character creation and first server save.
3. Choose starter companion.
4. Start stat training.
5. Unlock/equip jutsu.
6. Equip starter item.
7. Complete Academy spar.
8. Heal.
9. Claim Academy Trial.
10. Open Logbook.
11. Visit a sector and return to village.

