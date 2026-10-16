# Underground integration audit — October 11, 2026

> Raw evidence files linked from this page (logs, transcripts, screenshots) were removed on 2026-10-16 to cut repository weight. Retrieve one with `git show 5124ba3f2:<path>`.

This review covers the stronghold and Hollow Gate presentation, room furnishing, cave travelers, movement, combat and their existing sector integrations. Verification uses the actual client components, real API handlers with isolated in-memory storage, and local browser fixtures. It does not certify a deployed multiplayer environment or physical-device performance.

## Integration coverage

| System | Verified behavior |
| --- | --- |
| Shared strongholds | Twelve connected chambers retain authoritative geometry, presence leases, interior/exterior isolation, 4% step threat and the 25-step patrol. Furnishings reserve the center travel lanes and avoid doorways and gameplay nodes. |
| Village and sector wars | Stronghold peer attacks use the same selected-sector admission path as the exterior. Combat, Pet and Card contests retain their distinct routing; the sector contest and garrison callbacks reach the stronghold host. Server holder rules, war eligibility and rewards remain authoritative. |
| Anbu raid and defense | The Anbu remains at the reachable vault objective. Proximity, target-village, admission, settlement and recovery checks use the existing raid system. The active fight's sealed target village selects the Anbu portrait. The map pin matches the player size, including overview mode. |
| Death's Gate | Obsidian retains its Blood Altar, shared presence, patrol rules, authorized PvP multiplier and isolation from unrelated saved village Anbu encounters. |
| Hollow Gate and event Rifts | Standard expeditions remain solo and five floors. Rifts retain sealed variants, dimensions, depth, signal encounter, bosses, loot and augment restrictions. Hunters replace ordinary battle nodes and do not add a new reward pool or turn the expedition into village PvP. |
| Travelers | Server-sealed floor rosters govern movement, proximity and human enemy profiles. Medic, key and torch gifts remain limited to one gift per source and use existing receipt, save and ledger authority. Treasure Sense blocks both traveler and Keeper healing. |
| Recovery and economy | Replay, lost-reply, reconnect, expired-run, receipt, pending combat, admission rollback and settlement coverage includes the existing 50,000-operation reconnect soak. |

## Corrections made during this audit

- Stopped an already-captured movement batch when an encounter opens. Clearing only the shared queue previously allowed the local batch to continue behind a dialog. Rejected steps now restore position and recover the server's pending or sealed encounter.
- Bound delayed movement, tile resolution, hidden-chamber rewards, gifts and combat-start adoption to the requesting account, run token and floor. Step requests include the floor, and the API rejects a mismatched floor before applying movement.
- Kept gift dialogs open through request failure, with a retryable error and a visible pending state. Duplicate clicks are blocked. The original Shrine Keeper now resolves after a successful gift, so skipping or a failed request leaves it available.
- Added native modal focus containment to cave events, hidden chambers, introductions and boss presentations. Keyboard input inside a dialog cannot walk the player. Native encounters yield to the actual application confirmation and session-expiry portals, then resume after cancellation or login recovery.
- Matched the Anbu overview marker to the player's current marker size and repainted cave pins before a tile-scale resize reaches the screen.
- Anchored wall-art sampling to world coordinates, preventing adjoining faces from restarting the same texture crop. Reviewed the furnishing plans for all twelve rooms and retained the open vault approach.
- Moved the cave movement drain into an on-demand chunk and separated the small NPC range check from gift/API code. The final production-fixture startup graph passes its unchanged size limits. The documented aggregate feature allowance is 9,550,000 B; startup, chunk, CSS and asset limits are unchanged.

## Verification evidence

- **685 regression checks** across 88 files, covering client movement/recovery and actual API integration for Hollow Gate, Anbu, sector contests, war holders, PvP, saves and receipts. The exact scope is in [test-files.json](test-files.json).
- **88 underground browser checks** across Chromium and WebKit, desktop, phone and landscape: movement, fog, circle-pin sizing, all twelve room plans, raid trigger, contest routing, gifts, focus containment, intros and recovery prompts. [Results](browser-results.json).
- **50 existing stronghold browser checks**, including dismissal during pending admission, patrol triggering, actual Arena mounting and settlement, recovery, mobile controls and Obsidian isolation. [Results](stronghold-results.json).
- **24 additional Chromium checks** after the final continuous-wall correction, including desktop/phone traversal, gifts and modal recovery. [Results](final-browser-results.json).
- Browser runs report zero page errors; the underground runs also report zero missing or failed image requests.
- Final movement, NPC range, gift and API caller checks: **23 passed**. Client/server TypeScript, focused lint, production client build, distribution and normal/production-fixture bundle checks all passed. Regression log, client build, server build, distribution, normal size check, production-fixture size check.
- The production-fixture startup graph is **1,422,667 B raw / 395,216 B gzip**. Budgeted product JS/CSS is **9,525,282 B**, below the documented 9,550,000 B aggregate allowance. The 31 optimized underground WebP assets total **1,384,662 B**.

Room review sheets: [rooms 1–4](rooms-1.png), [rooms 5–8](rooms-2.png), [rooms 9–12](rooms-3.png). Final presentation: [Anbu treasury](anbu-treasury.png), [Hollow Gate desktop](hollow-gate-desktop.png), [Hollow Gate phone](hollow-gate-phone.png), [cave traveler](hollow-gate-travelers.png), [stronghold desktop](stronghold-desktop.png).

## Reproduction

From the repository root, run the test files listed in `test-files.json` with Node's `--import tsx --import ./scripts/test-asset-hooks.mjs --test --test-concurrency=4` options. From `shinobij.client`, run:

```text
node --import tsx scripts/underground-sector-browser-qa.mjs --output=.tmp/underground-audit
node --import tsx scripts/stronghold-browser-qa.mjs --output=.tmp/stronghold-audit
npm run build
```

Run `npm run build:server`, `npm run verify:dist` and `npm run sizecheck` from the repository root. Production-image size verification must additionally use the public `VITE_*` fixtures in `.github/workflows/production-image.yml`; an environment-free build exercises a smaller product graph.

## Remaining release validation

Local checks establish the reviewed gameplay bindings and browser behavior. Live concurrent players, deployment configuration, real network latency and disconnect patterns, physical controller/touch hardware, accessibility assistive technology and sustained performance on low-end devices require release-environment testing. AAA quality is a production standard involving those conditions, art direction, audio and extensive playtesting; these checks support the current upgrade without claiming that certification.
