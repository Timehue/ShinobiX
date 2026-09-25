# MMORPG behavior pass — 2026-09-24

The owner asked that every behavior in the game make sense for an MMORPG, and named
four rules as examples:

1. When your HP hits 0 you go to the hospital — **unless it is a spar or a ranked match.**
2. When you are in the hospital, you **show up there for other players to heal.**
3. If you **flee or leave** a game mode, it **counts as a loss.**
4. Every **back button goes to the right place** — after an explore AI fight you are back
   in the same sector you were in.

This pass mapped every combat mode against those four rules (server and client), fixed
what broke them, and records what was checked and found correct so nobody re-opens it.
It builds on `docs/MMORPG_BEHAVIOR_RULINGS.md` (2026-09-08), which audited the server
*rules*; that pass deliberately left client flow out, and most of what broke here lived
in the seam between the two.

---

## What was wrong, and what changed

### 1. A spar put you in the hospital

Ranked and player-vs-player spars already honoured the rule: both fight on a fresh pool
and write nothing back (`api/pvp/_vitals-settlement.ts`). The AI side did not. A practice
bout and the Academy spar settled through the same function as a real fight, so a
knockout in one admitted the player for 60 seconds.

**Now:** a spar writes **no physical consequence** — no hospital and no damage.

- `sessionIsSpar()` (`api/missions/_ai-fight-outcome.ts`) reads the answer off the SEALED
  session: the Academy spar by its encounter kind, a practice bout by a `spar` flag that
  `api/missions/ai-fight-start.ts` stamps on the encounter at creation
  (`api/solo-pve/_ai-encounter.ts`). A caller cannot opt a real fight into it.
- `applyAiFightOutcomeToCharacter(…, spar)` returns the character untouched. Both
  settlement paths pass it — the report (`report-ai-fight.ts`, which also honours the
  token's sealed `practice` kind for sessions sealed before the flag) and the shared PvE
  settlement (`api/pve/_fight-outcome-settlement.ts`), which also serves the lapse
  reconciler. So walking away from a spar does not cost HP either.
- **What counts as a spar:** the Arena "Spar" bout vs AI, the Dojo Circuit, Logbook exam
  bouts, the non-paying creator-event practice preview, and the Academy spar. That is the
  codebase's own definition of `practice` — "a consensual spar, which also pays nothing"
  (`api/missions/_ai-fight-token.ts`).
- **Why no damage either, not just no hospital:** otherwise losing a spar would cost less
  than winning one. It also matches ranked and PvP spars exactly.
- Consumables used in a spar are still spent, and the token still settles exactly once.
- **Deploy window:** a practice session sealed before this change carries no `spar` flag.
  Its report still settles as a spar (the token's sealed `practice` kind), but if the
  player abandons it and it lapses, the reconciler reads only the session and applies the
  old rule once. Only a bout already in progress at deploy can do this, and only if its
  player then walks away from it.
- The Academy spar's WIN keeps its scripted post-spar HP (the tutorial's Noodle Den beat).
  A lost Academy spar now sends the beginner straight back onto the mat.
- Copy: the AI result card (`lib/ai-fight-result.ts`) now says "You lost this spar… you
  keep your HP" instead of "You left the fight", and the Academy card and onboarding
  coach no longer send a beaten beginner to the Hospital.

Tests: `api/missions/_spar-never-hospitalizes.test.ts` (pure rule, both settlement
paths, and a real `ai-fight-start` → `report-ai-fight` knockout).

### 2. "Hospitalized" still did not mean the same thing at every door

The 09-08 pass wired `isIncapacitated()` into the entry points it found. Nine more fight
entry points had no gate, so a player lying in a hospital bed could walk into:

| Entry point | Why it mattered |
|---|---|
| `api/missions/ai-fight-start.ts` (World branch) | ambushes, hunts, raids, wanderers, bounty hunters and crises seal from the save's CURRENT vitals, so an admitted player entered at 0 HP. Only the generic branch was gated. |
| `api/clan-boss/assault-start.ts` | Tower engine seals fighters at FULL vitals; spends a weekly attempt |
| `api/world-crisis-80/combat-start.ts` | Tower engine, full vitals |
| `api/story/boss-start.ts` | a chapter boss from the hospital bed |
| `api/story/spar-start.ts` | the Academy spar |
| `api/endless/wave-start.ts` | a new wave seeded at the save's zero HP |
| `api/missions/combat-start.ts` | a combat mission seeded at zero HP |
| `api/village/sector-war.ts` (garrison) | burns the garrison window on an unplayable fight |
| `api/village/anbu-infiltration.ts` | a vault raid while admitted |

Each refuses with 409 `errorCode: 'hospitalized'` (the World branch uses `reason`, like the
generic branch of the same endpoint) and a sentence the client already shows verbatim,
placed **after** its resume/replay branch — a fight already paid for still resumes (the
Hollow Gate rule from 09-08).

**Ratchet:** `api/_hospital-fight-entry-gates.test.ts` scans every non-test `api` file that
creates a fight (`buildTowerEncounter`, `claimTowerBattleLeases`, or a NEW
`writeSoloPveSession`) and fails unless it calls `isIncapacitated` or is listed as exempt
with its reason. A new fight endpoint fails this test until someone decides on purpose.
The scan is per FILE, which is how the World branch slipped through: `ai-fight-start.ts`
already called `isIncapacitated` in its generic branch, and both branches seal through one
shared helper. An independent review of this pass found it. Each branch of a multi-branch
endpoint now has its own handler test in the same file, and the World test was checked
against the code with its gate removed (it fails).
Exempt on purpose: the ranked-2v2 and Team Arena match formers (their queues refuse an
admitted player) and the Clan War 2v2 match (four players already accepted; it fights on
a fresh pool like ranked, and refusing one member would strand the other three).

### 3. A knocked-out player was invisible to Healers

The ward list came from the public roster, which could not show it:

- An **online** patient's roster row is built from their presence frame, and presence
  deliberately omits `hospitalized`. Nearly every patient is online — they were just
  knocked out while playing — so they were invisible for their whole stay. Only
  sleeper-kill victims, offline by definition, ever showed up.
- The roster is cached for up to ~90 s (process + edge) and polled once a minute. An
  admission lasts 60 s, so even a correct row arrived after the patient had left.

**Now:**
- `GET /api/player/hospital-ward` (`api/player/hospital-ward.ts`) reads the SAVES — the
  authority on admission — through a narrow projection, for the caller's own village,
  uncached. Any villager can see the ward; only Healers get the Heal button. An offline
  patient stays listed: their body is in the bed until they check out or are treated.
- `HealerInjuredList` polls it every 10 s. A treated patient stays hidden only for that
  admission, so the same player knocked out again shows up again.
- The roster grafts the save's admission (and its HP) onto an online patient's row, so
  every roster reader agrees.
- The **Village Lifeline** mastery capstone now reaches the world-wide injured list below
  Rank 10. `/api/player/heal` already honoured it, so a capstone holder could heal those
  targets but had no way to find them.

Tests: `api/player/hospital-ward.test.ts`.

### 4. Leaving did not always count as a loss

- **PvP card duels** (Clan War showdowns, Sector War tables, Free Play, the Dojo Circuit
  card trial — all hosted by `CardClashDuelScreen`): "Leave table" walked away and left
  the match running. The opponent had to sit through a 60-second turn clock for every
  absent turn, and if both left, the match expired two hours later with no result.
  Leaving a live match now **forfeits** it through the same server action as the board's
  Forfeit control. Leaving a table still waiting for its opponent is unchanged.
- **Weekly Boss fight:** the fight lives inside the Weekly Boss screen's own state, which
  the navigation lock could not see, so the menus could walk a player out mid-fight — the
  attempt spent, the damage unbanked. The screen now registers its fight
  (`setScreenFightActive`, `lib/screen-guards.ts`) and the lock holds until the result.

### 5. Back buttons that went to the wrong place

- **The roaming Weekly Boss could not be fought at all.** Roaming mode has been
  permanently on since the 2026-08 flag removal, and in it the boss is fought only through
  the World Map's "Stand & Fight" prompt. When Weekly Boss combat moved onto the Solo PvE
  runtime (`3c5094982`), the App handler that started the fight was deleted and the prop
  became a bare `navigate("weeklyBoss")`. So "Stand & Fight" opened the tracker, whose only
  button reads "Hunt it on the World Map" — a loop with no fight in it. No e2e covered it.
  Now the map stages a launch (`lib/weekly-boss-launch.ts`), the Weekly Boss screen starts
  the fight (the server's `startFight` replays a live run and never charges twice), and the
  fight ends with **"Return to the World Map"** — same sector, since the map never moved.
- **The Weekly Boss tracker's Back** always went to Central Hub — a TOWN screen that zeroes
  the player's sector. Opened from the map, it now returns to the map. In roaming mode the
  read-only "Check for interrupted fight" probe is always offered, since that screen has no
  fight button of its own. A knockout in the boss fight exits with "Go to Hospital".
- **Reduced-motion players never met the roaming boss.** Its in-sector figure returned
  early under reduced motion and stood frozen on its home tile in the top row, which a
  phone's board edge mostly clips — the exact bug `SectorWanderer` had already fixed for
  road wanderers ("reduced motion drops the animation, not the encounter"). The boss was
  forked from the wanderer before that fix and kept the bug. It now stalks in discrete
  steps like the wanderers (`SectorWeeklyBossActor.encounter.test.ts`). Found by the live
  browser test below, which runs with reduced motion on.
- **Android hardware Back** (Play app) fell back to a hardcoded village whenever the popped
  entry was a fight screen, e.g. World Map → wanderer pet duel → back on the road → Back.
  It now lands where the player IS (the same `safeFallbackScreen` the in-app back uses).
- **Android hardware Back during an AI fight.** Ambushes, hunts and raids are BODY-PORTAL
  fights: the screen stays on the World Map underneath. The battle predicate Back reads
  (`isPresenceBattleActive`) knew about story fights but not these, and Back sets the
  screen directly, so a press mid-ambush could put the village underneath the fight and
  zero the player's sector — a free teleport home. The predicate now counts every sealed
  fight. The same predicate pauses idle regen and autosaves during combat, which the
  mission fight already did; ambushes, hunts and raids now match.

Tests: `lib/weekly-boss-launch.test.ts`, `lib/screen-guards.test.ts`,
`lib/app-history.test.ts`, `screens/Missions.battle-lifecycle.test.ts`,
`screens/ClanWarTileCardDuel.leave.test.ts`, `lib/ai-fight-result.test.ts`.

**Live browser coverage** — `e2e-live/mmorpg-behaviors-express.spec.ts`, against the real
Express server on desktop and mobile, now a step of its own in the required
`CI / e2e-village-stores` job (its own server: registration allows 25 accounts per IP per
15 minutes, and the recovery matrix already registers 18):
1. an ONLINE player knocked out in the field appears on their village ward — the test
   waits for `/api/player/hospital-ward` itself to return them, since the roster graft
   would show the row too — and a Healer treats them (the patient is discharged, the
   Healer banks profession XP);
2. "Stand & Fight" seals a real Weekly Boss run, the fight mounts, and leaving it returns
   the hunter to the same sector's board with their location unchanged.

`e2e-live/first-defeat-recovery-express.spec.ts` used a practice bout as its "next activity
after recovery" and asserted the OLD practice rule (an abandon costs HP). It now asserts
the spar rule: no hospital, no HP cost, and the result says so.

---

## Verified correct — do not re-flag

**0 HP → hospital** (server `applyAiFightOutcomeToCharacter` / `_vitals-settlement.ts`;
client `useBattleNavigationGuard` redirect + "Go to Hospital" on the AI and PvP result
screens): explore and wandering AI, missions, hunts, raids and village defense, sector
PvP, towers, Endless Tower, story bosses, weekly boss, clan boss, world crisis, dungeon
Warden, Hollow Gate, the Sector War garrison, Sunscar caravan combat, and sleeper kills
(the offline victim is admitted on their next login). Card, tile and pet battles never
touch the player's HP, by design: the player is not the one fighting.

**Ranked is exempt** — `continuousVitals: false`, no write-back. So is the PvP spar.

**Leaving = loss** — AI fights (closing settles a forfeit; `_abandon.ts` lapse = loss),
dungeons (server abandon), story bosses, PvP and ranked (flee = loss; two skipped rounds
let the opponent claim the win; ranked rating is lost), Tower PvP / Team Arena / Clan War
2v2 (Forfeit, two AFK strikes), Endless Tower, Hollow Gate (the map is locked; exit only
via Leave or Forfeit), Pet Arena live PvP (resign = loss), Pet Showdown/Ladder/Coliseum
and First Pact (forfeit = concession). Battle Towers' "Leave view" keeps the run on the
server; it resumes on return and lapses as a forfeit, so the loss is unavoidable.

**Back buttons** — `goBack()` walks real history and falls back to where the player is;
the explore ambush returns to the World Map with the same sector AND tile (`presence-store`
keeps the tile; `sector-return` reopens the sector board); sector PvP returns to the
sector; Dojo Circuit, dungeons, Hollow Gate, story bosses, Sector War tables, Card Clash,
pet modes and event encounters all return to their launcher; the Hospital discharges to
the village (the MMO model: you wake up in your village hospital).

**Other MMO invariants** — no attacks in towns or the hospital; no attack on a
hospitalized, travelling or in-battle target (read from the save, not presence); no
travel mid-fight; menus never move you; no rewards for AI spars; `inBattle` is
server-owned; the sector presence is consistent.

**`<CardHall>` has no `key`**, unlike `Missions`, `DojoCircuit` and `Settings`. A review
flagged that a live showdown's board and menu lock could outlive an account switch. They
cannot: every path to another account goes through the `start` screen, which unmounts the
Card Hall (`endLocalSession`, `logoutFromExpiry`, `unwindToLoginForm`), or through a fresh
page load (the Google redirect). There is no in-game account switcher.

---

## Owner rulings (2026-09-24 follow-up)

The first version of this document left seven items for a ruling. The owner answered:

1. **PvP double walk-out — explained, unchanged.** Players cannot leave a live duel through
   the game: the menus are locked and Flee is a loss. A "walk-out" is both games going
   silent (tab or app closed, connection lost, a phone backgrounding the game). If one
   player stays, their game passes the absent turns and claims the win after two skipped
   rounds or 90 s idle. Only when neither game touches the fight for 15 minutes
   (`SESSION_TTL`) does it lapse as a draw (`api/pvp/_lapse-rules.ts`): no hospital, no
   rewards. Counting that as a loss for both is a small change if wanted.
2. **Ranked "decline" — withdrawn; it was wrong.** Ranked has no accept/decline step: the
   queue pairs two players and the fight is created automatically. The only gap is the
   few seconds before the second player's game learns the fight exists, while its screen
   still says "Searching" and shows no opponent, so nobody can scout and bail.
3. **Clan War returns — explained, unchanged.** An accepted challenge pulls both fighters
   in from wherever they are; the exit opens the Clan screen ("Return to Clan War"; card
   duels open the Shinobi Council). The Clan screen is not a town, so the player's
   location is kept and one Travel press returns them. Returning to the spot the fight
   found them needs the origin stashed by App's `launchClanWarBattle`.
4. **AI Card Hall — leaving now forfeits (implemented, below).**
5. **Card-duel AFK — two missed turns now forfeit (implemented, below).**
6. **The Healer's window — explained, unchanged.** A knocked-out non-Healer is admitted for
   60 s, can pay 2,500 ryo to leave early, and their own client checks them out when the
   timer ends (`screens/Hospital.tsx`, one automatic attempt per stay). The ward shows a
   new patient within ~10 s. The stay length is a balance setting.
7. **Sector on admission — explained, unchanged.** A live-fight knockout marks the save
   admitted but leaves `currentSector` where the player fell; sleeper kills set it to 0
   (`api/player/sleeper-kill.ts`). The client routes the player to the Hospital at once
   and the next heartbeat moves them to the village. Nothing can attack or challenge an
   admitted player meanwhile, so it is harmless; moving them server-side at admission is
   the tidier shape.

### 4. Leaving an AI Card Hall showdown forfeits it

It used to PAUSE: leaving made no server call, the match stayed live for two hours, and an
explicit forfeit recorded nothing, so walking out of a losing showdown kept the record
clean.

- Leaving a live showdown confirms "Leave the showdown? Leaving forfeits it and counts as
  a loss.", forfeits straight to the server and adopts the settled record
  (`screens/CardHall.tsx` `leaveShowdown`). A live duel fills the screen and hides the
  Hall's header, so the board's "Return to Hall" is the way out; the header's Back runs
  the same path if it is ever reachable. A finished duel just closes; a refresh still
  resumes.
- While a showdown is live the menus are locked, like the PvP card duel screens
  (`lib/screen-guards.ts`, `shinobiTiles`).
- A forfeit is a **loss** on the Card Hall record (`api/card-clash/ai-move.ts`). It still
  pays nothing and earns no Legacy or Circuit credit. Nothing reads `cardClashLosses`
  except the Hall's W/L header, so it cannot be farmed.
- **Nobody gets stuck.** If the forfeit cannot reach the server (a closed tab, a lost
  request), the next Card Hall start forfeits the player's previous showdown first
  (`api/card-clash/ai-start.ts`, `cc-ai-active:<player>`), so no match is left without a
  result. A failure there never blocks the new showdown. Event and dungeon card fights
  (external stakes) are never swept up.
- **Waiting it out does not work either.** A match expires two hours after its last
  move, so the pointer lives 30 days and is cleared when a showdown settles. A pointer
  whose match has expired unsettled is settled from the pointer alone, as the same
  forfeit, and the start hands back the updated record and save version. The in-save
  settlement receipt keeps a showdown that settled before it expired from counting twice,
  even if clearing its pointer was lost.
- Echoes of War has the same pause model and was left as it is.

Tests: `api/card-clash/ai-move.test.ts` (each part of the expired-showdown path was
switched off in turn, and each time the test that covers it failed),
`screens/CardHall.leave.test.ts`, `lib/screen-guards.test.ts`, and the live journey in
`e2e-live/mmorpg-behaviors-express.spec.ts` (start a showdown, back out of the
confirm, leave for real, see the loss in the Hall, then walk out through Back).

### 5. Two missed turns forfeit a PvP card duel

All three PvP card hosts (Free Play and the Dojo Circuit trial, Clan War tile duels,
Sector War tables) carried copies of one clock loop that passed an absent player's turns
forever. They now share `advanceExpiredChronicleTurn` (`shared/chronicle-duel.ts`):

- An expired turn strikes the active duelist only if they did nothing all turn. Any real
  action clears their streak, so a present but slow player is passed, never struck.
- The second missed turn in a row forfeits the duel through the engine's own forfeit, so
  every host settles it exactly like a manual forfeit (war damage, contest swing, no Free
  Play credit).
- An expired Snare response is passed as before; it neither strikes nor clears anyone.
- The fields are optional (`afkStrikes`, `actedThisTurn`), so duels in progress keep
  loading with no rules-version bump, and a match without the flag is never struck.
- The board warns: "You missed your last turn. Miss this one too and you forfeit." and
  tells the other player the next miss wins it for them.
- Each host stores and scores what the clock settled **before** it judges a duelist's
  request. An independent review found that a request the host then refused (a late move,
  or any 400) threw the result away. For a refused move that only delayed it to the next
  poll. But a Sector War join **replaces** a finished table, so an attacker opening the
  next battle erased a forfeit the war had never scored. This was checked by switching the
  fix off: all five new host tests fail without it, and the Sector War join test shows no
  battle receipt at all.
- **Only the two duelists (or an admin) move a duel's clock.** A second review caught the
  first version of that fix saving before the participant check in the Clan War and Sector
  War hosts, so any player who could read a table's id (every member of both clans; the
  sector's public id) could force a forfeit onto the war score with a refused request. The
  save now follows the check, as Free Play's always did. A Sector War join, which any
  attacker may send, scores a finished table before replacing it, so an attacker who never
  sat at the old table cannot erase its result either.

Tests: `api/card-clash/_chronicle-engine.test.ts`, `api/card-clash/match.test.ts`,
`api/card-clash/_pvp-card-clock.test.ts`, `api/card-clash/pvp-card-clock-hosts.test.ts`
(Sector War and Clan War handlers), `components/ChronicleDuelBoard.test.ts`.

The weapon ladder (mythic on top, named weapons at most one EP above it) is not part of
this branch: PR #214 carries that work.

## Gates

Run locally on Windows, final pass on 2026-09-25. Every CI gate in
`.github/workflows/ci.yml` that can see this change was run, not only the two e2e suites
CLAUDE.md names. Every row reflects the final code: the client bundle has not changed
since the build these runs used, and the server rows ran on the final server build.

| Gate | Result |
|---|---|
| Root build (`npm run build`: server, client, `verify:dist`, `sizecheck`) | PASS; initial graph 382,536 B gzip (+47 B over the base commit). The server was rebuilt after each later server-only change (`build:server`, then `verify:dist` OK) |
| Root unit suite (`scripts/run-tests.mjs`), on the final tree | 12,023 of 12,023 passed |
| `npm run lint` (client), on the final tree | 0 errors; 14 warnings, all in 11 files this pass did not touch |
| `certify:release` (boots the server, live API journeys) | 90 of 90 checks |
| `check:tooling-handoffs`, `check:deployment`, `check:rollback-readiness`, `test:release-assets`, `test:mission-eligibility` | all pass |
| Live Express CI steps (`e2e-village-stores` job), on the final server | economy 5/5 · defeat recovery 20/20 · MMO behaviors 6/6 (now including the Card Hall journey) · authored missions 8/8 · PvP journeys 8/8 · exchange and Sector War 2/2 |
| `npm run test:e2e` (5 browser projects) | full run at 6 workers: 1,266 passed, 43 failed, 686 skipped. The machine was also running the live steps and builds, and the failures were boot and screen timeouts across unrelated specs. `--last-failed --workers=2`: 40 of 43 passed. The 3 left are `pet-home-visual.spec.ts:905` (compact, mobile, WebKit mobile): one pet pose image never finishes loading. It is the same failure as in the first round, it fails the same way in the base commit's own CI run, and it is green on current `main` |
| Combat layout matrix (`COMBAT_LAYOUT_CAPTURE_PHASE=after COMBAT_LAYOUT_STRICT=1`, all 6 projects) | 20 passed, 10 skipped, 0 failed, 0 flaky (14.6 min) |
| Sector HUD (`playwright.sector-hud.config.ts --project chromium`) | 30 passed, 4 skipped (first round; the card and war-host changes since do not reach it) |
| Stronghold browser QA (`stronghold-browser-qa.mjs`: default, `--dismissal`, `--resources`) | all 3 pass, no page errors (first round, same reason) |
| `npm run test:e2e:warfront` | not run: every spec loads the standalone `/petvfx.html`, whose runtime import graph (179 modules) reaches none of the files this pass changed |
