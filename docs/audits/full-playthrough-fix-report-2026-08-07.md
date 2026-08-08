# Full Playthrough and Fix Report — August 7, 2026

## Bottom line

The game now passes the strongest local release check available without connecting to production services. I used disposable QA accounts—not the owner's account—against the built Express game server with realtime enabled. The main Academy journey completed successfully, the full automated suite passed, and the security/economy issues found during the audit were repaired or made safely unavailable.

This was a real local account playthrough, not only a code review. The account used an isolated in-memory QA database and disappeared when the temporary server was stopped, so no real player data was touched.

## Rank and exam ruling

The original concern was rechecked against the shared rules, client behavior, server enforcement, and tests. The existing mechanics are intentional:

- Level 15 automatically awards the **Genin** display rank.
- Level 20 is a **Genin Advancement Exam** hold.
- Level 30 automatically awards the **Chunin** display rank.
- Level 39 is a **Chunin Advancement Exam** hold.
- Passing an exam releases the progression hold and preserves banked stat points; the exam does not award the already-held display rank.

Therefore, rank levels and exam gates were not moved. The real problem was player-facing wording that made the later exam sound as if it awarded the earlier rank. The Guide, Logbook, and shared labels now explain the distinction directly.

## Disposable-account playthrough

The fresh account completed this route on the production-built client and authoritative Express API:

1. Registered and created a ninja.
2. Selected Stormveil, Ashen Eyes, an avatar, and the Ripple Seal starter companion.
3. Reached the village and checked the rank/exam and combat-resource Guide text.
4. Started Strength training and confirmed the stamina debit and active timer.
5. Unlocked Flicker, equipped it, and confirmed the fair 15-slot loadout message.
6. Equipped the starter Kunai and Vest.
7. Entered an Academy battle, moved, used Flicker and a normal attack, won, and received the expected rewards.
8. Ate Small Ramen, confirming healing and the Ryo debit.
9. Claimed the Academy Trial reward.
10. Traveled to Sector 1 and returned to the village.
11. Reached the **Academy complete—choose your next path** state.

The browser reported no application errors. It only logged an upstream Three.js `Clock` deprecation warning; this did not affect play and comes from the current stable React Three Fiber dependency.

## Repairs completed

### Progression, fairness, and clarity

- Clarified automatic ranks versus later advancement holds.
- Corrected the Guide: Ninjutsu/Genjutsu spend Chakra; Taijutsu/Bukijutsu spend Stamina under the live resource system.
- Gave every player the same 15-slot PvP combat loadout; the subscription no longer sells extra combat slots.
- Made the four-pet Tactical ladder reachable on the free pet allowance.
- Prevented bloodline data from being silently erased during saves.
- Fixed training selection synchronization, stat-control accessibility, Town Hall Kage wording, Clan Hall XP wording, morale messaging, and profession-respec state.
- Corrected Sennin-set combat values and generated catalogs, and added authored battle text for built-in bloodlines.
- Smoothed PvE levels 91–99 so difficulty ramps into the level-100 opponent instead of jumping abruptly.

### PvP and reward security

- Added authoritative, single-use server receipts for challenges, ranked matches, world fights, and Clan War 1v1.
- Required both combatants to join before AFK or settlement logic can award anything.
- Made reward, bounty, mission, raid, Vanguard, Kage, clan-war, and sector-war consumers fail closed when authority is missing.
- Enforced exact challenge identities, block lists, rate limits, collision-safe IDs, and safe challenge delivery.
- Removed client-side fallback reward grants.
- Fixed ranked matching so its level band widens every 15 seconds without immediately falling back to any level.
- Restored secure Clan War 1v1 launch and settlement.

Clan War 2v2 is explicitly unavailable for now. The existing engine and record format represent one duel, so allowing one 1v1 result to settle four players would be dishonest and exploitable. Safe 2v2 support needs fixed pairings, two battle IDs, and aggregate server settlement.

### Pets, fees, and social systems

- Made the server generate Pet Coliseum seeds and report keys and seal strength-based rewards.
- Prevented seed shopping by allowing one resumable outstanding pet-battle receipt.
- Moved Battle Tower and Pet Gauntlet entry debits to locked server-owned transactions.
- Enforced village membership for village-chat reading and posting.
- Added reversible player blocking in Mail and enforced it for DMs, inbox/chat filtering, and challenges.
- Defined the Gauntlet allowance as one free run per UTC day instead of resetting when the page is reopened.

### Village war and combat consistency

- Replaced the old loser tax with a modest overexpansion tax on villages holding more than eight territories.
- Corrected tax messaging so taking more land is not presented as the way to lower an overexpansion tax.
- Added capped spoils and a temporary comeback rally for the losing village; a later win now clears a stale rally.
- Protected home gates at declaration, settlement, automated capture, and normal direct-write boundaries.
- Prevented normal users from clearing ownership, claiming for another village, or planting mismatched clan banners. Authenticated admins retain a manual repair route.
- Aligned PvE ground effects with the canonical lifecycle: DDG/Recoil last one round and Poison lasts two under Resources V2, with symmetric ownership timing.

### Development and release reliability

- Corrected the README: the Vite server on port 50891 is a partial mock API, while the built Express server is required for authoritative full-game QA.
- Redirected live-test screenshots to test output so checks no longer overwrite documentation assets.
- Updated release certification for authoritative challenge receipts and mutual joining.
- Reduced/checked build output and verified the distributable contains its required runtime assets.

## Verification results

- Full automated suite: **5,224/5,224 tests passed** across 800 suites.
- Full client ESLint: **passed**.
- Server TypeScript: **passed**.
- Client TypeScript: **passed**.
- Production build and distribution integrity: **passed**.
- Built-server release certification: **87/87 passed**.
- Live desktop/mobile Playwright checks: **9 passed, 1 intentional skip**.
- 24-player local concurrency smoke: **24/24 accounts, 161 calls, 0 errors**.
- Focused PvP hardening tests: **48/48 passed**.
- Focused village-war protections: **87/87 passed**.
- Pet/social authority checks, ownership parity, and related focused tests: **passed**.
- Final whitespace check: **passed**.

The final client bundle passed its hard size gate, but it remains close to that ceiling. The initial graph was about 1.31 MB raw/351.7 KB gzip, and the full budgeted JS/CSS was about 6.92 MB. This is a maintenance warning, not a release failure.

## What this cannot prove locally

- Real Postgres/Supabase persistence, contention, backups, and Supabase row subscriptions were not exercised because production credentials were not present.
- External OAuth/Patreon integrations were not used.
- Multi-instance MMO scaling was not tested. Presence and Socket.IO currently assume one server replica without a shared adapter.
- A local 24-player smoke test cannot reproduce months of economy behavior, hostile traffic, or a large real community.
- If the Legacy interface is meant to be public, the deployment must set `ENABLE_LEGACY=1`; otherwise those routes intentionally remain disabled.
- Clan War 2v2 still needs the larger authoritative two-duel design described above.

## Release assessment

The repaired tree is substantially safer and more internally consistent than the starting version. Core onboarding, combat, saving, rewards, travel, progression wording, and representative multiplayer settlement all work in local authoritative QA. Before a public production release, run the same certification once against a staging environment using the real database and production-style realtime configuration, then perform a staged multiplayer load test.
