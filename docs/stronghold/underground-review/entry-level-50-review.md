# Stronghold level-50 entry and integration review

> Raw evidence files linked from this page (logs, transcripts, screenshots) were removed on 2026-10-16 to cut repository weight. Retrieve one with `git show 5124ba3f2:<path>`.

October 12, 2026. Stronghold exploration now unlocks at level 50. Anbu treasury raids remain level 100, as requested.

| Activity | Minimum level | Admission |
| --- | --- | --- |
| Sector stronghold exploration | 50 | Actual sector presence and an active interior tab lease |
| Obsidian Stronghold exploration | 50 | The same entry policy, for all villages |
| Enemy Anbu treasury raid | 100 | Enemy-held war sector, adjacent vault position, cleared patrol, existing raid limits |
| Own-village Anbu treasury raid | Unavailable | Own treasuries remain protected |

Client and server use the shared level requirements in `shared/sector-stronghold.ts`. Both server entry branches read the authoritative save; missing, invalid, and non-finite levels fail closed. Re-entry retains exploration and owed threat. The world-map landmark and entrance button use the same minimum, including Obsidian and paused-capability handling. Remote sector scouting retains its read-only guard.

The review found an existing UI/server mismatch: the server admitted village defenders, while the world map hid their own stronghold entrance. The entrance now appears for eligible defenders. The friendly Anbu marker and dialog describe a protected village vault, with no treasury-raid action. Enemy Anbu challenges explain the level-100 requirement and keep exploration available to levels 50–99. The server still rejects self-raids and validates current captured ownership, with the existing home-village fallback.

Movement remains 4% threat per successful step and a patrol at step 25. Solid architecture still blocks movement without charging threat. Patrol scaling remains saved level minus ten. Territory conquest, village/sector-war scoring, garrisons, raid economy caps, cache turn-in, PvP multipliers, and Hollow Gate's private expedition/event rules retain their existing authorities.

## Verification

- **696 regression tests passed** across [89 recorded test files](entry-level-50-test-files.json): stronghold entry/re-entry, collision, patrols, leases, PvP/Obsidian rewards, Anbu ledgers and receipts, war/garrison/Card/Pet connections, missions, Hollow Gate/Rift encounters and recovery, wanderers, gifts, and WorldMap wiring. Regression log.
- **36 additional combat-recovery tests passed** for held-fight admission, garrison/vault health settlement, and rejected raid starts. Recovery log.
- **20 actual-component UI checks passed** in Chromium and WebKit at 1366×900 and 320×568. Levels 50 and 99 can explore but cannot start an enemy treasury raid; level 100 can invoke admission. Friendly Anbu dialogs at levels 50 and 100 offer no self-raid action and return to exploration. No page or image errors. [Results](entry-level-50-ui/results.json), [phone enemy Anbu](entry-level-50-ui/webkit-level-50-anbu-320.png), [phone friendly Anbu](entry-level-50-ui/webkit-level-50-defender-320.png).
- **Four authenticated two-browser scenarios passed** at saved/client level 50 in sectors 12 and 99, using actual HTTP handlers and separate 320×568/390×844 browser contexts. The normal-sector defender belongs to its canonical owning village. Checks cover peer movement, exterior isolation, collision refusal, leave/reconnect, offline recovery, stale leases, battle admission, both joins, combat movement locks, KO, correct rewards, and receipt replay. [Results and timings](entry-level-50-multiplayer/results.json).
- **24 concurrent level-50 players per stronghold passed**, with six accepted steps each, 23 visible peers, and retained threat. Each measured batch contained 192 requests. With 120ms artificial response delay, p95 latency was 349ms in the normal stronghold and 191ms in Obsidian. Two-browser walking samples had p95 frame intervals of 16.7ms in Chromium with 4× CPU slowdown and 35–42ms in WebKit; the longest individual interval was 100ms. These remain within the existing harness gates.
- Final client/server builds, focused ESLint, distribution checks, and normal/production-variable size checks passed. Production product JS/CSS is 9,534,153 bytes; initial JS/CSS is 395,342 bytes gzip. Existing budgets were preserved. Client build, server build, lint, distribution, production size.

The API tests use isolated in-memory storage and disposable authenticated identities. Browser tests mount the actual exploration/Anbu components; WorldMap entrance projection is checked by source contracts and the server by executable admission tests. The multiplayer combat board uses a deterministic KO arrangement while admission, joins, attack, reward claim, and replay use real handlers. Timings are local synthetic measurements, not physical-device or deployed-load certification. No production saves or deployments were changed.

## Reproduce

From the repository root in PowerShell:

```powershell
$testFiles = Get-Content docs/stronghold/underground-review/entry-level-50-test-files.json -Raw | ConvertFrom-Json
node --import tsx --import ./scripts/test-asset-hooks.mjs --test --test-concurrency=4 @testFiles
node --import tsx --import ./scripts/test-asset-hooks.mjs --test api/pve/_held-fights-routes.test.ts api/village/war-start-held-fights.test.ts api/village/vault-garrison-free-heal.test.ts
```

From `shinobij.client`:

```powershell
node --import tsx scripts/underground-sector-browser-qa.mjs --entry-levels --output=../docs/stronghold/underground-review/entry-level-50-ui
node --import tsx scripts/stronghold-multiplayer-qa.mjs --output=../docs/stronghold/underground-review/entry-level-50-multiplayer
```
