# Village leadership audit — 9 September 2026

The council, Village Orders, exams, and war actions now resolve leadership from actual village seats. AI elder contacts provide no focus. Player titles and old browser state do not establish authority.

## Role rules

| Behavior | Kage | Elder | ANBU | Other villagers |
| --- | --- | --- | --- | --- |
| Appointment | Authoritative Kage succession system | First: Kage-appointed; Second: term PvP winner; Third: term PvE winner | Three appointed seats plus seven earned seats | No office |
| Appoint or clear First Elder / appointed ANBU seats | Yes | No | No | No |
| Post Village Orders | Yes | Yes | Yes | Read only |
| Pin/delete orders | Any order | Own orders while holding office | Own orders while holding office | No |
| Purchase village upgrades, hire war mercs, set sector win conditions | Yes | No | No | No |
| Set home-sector terrain | Three sectors; may override another leader within quota | One sector per player; cannot override another leader | No | No |
| Toggle own village's garrison feed in a participating war | Yes | Only if also ANBU | Yes | No |
| Guard village territory outside own clan | Only if also ANBU | Only if also ANBU | May toggle own guard entry | Own clan's applicable permissions |
| Garrison / infiltration defender selection | Fallback when no ANBU is available | Only if also ANBU/Kage | Current roster participates in defender rotation | No leadership defender slot |
| Special Jonin leadership requirement | Satisfied | Satisfied | Does not satisfy it by itself | Not satisfied |
| War role: win contribution / loss penalty | 30 / 50 | 20 / 20 | 15 / 0 | 5 / 0 |

Rank exams still require their other existing progression requirements. Village intel remains shared with village members; seeing intel does not grant an office.

Focus remains a personal selection from the occupied doctrine seats. A player-held defense, trade, or training seat makes that focus available to village members. An AI/vacant seat supplies no focus or bonus. Each player can select one available focus; simply selecting it never makes the player an Elder. The occupied seat checks also govern the shop, XP, jutsu training, and wartime defense integrations from the council fix.

## Appointment and succession lifecycle

- Each office is backed by a real player in that village. Invalid, missing, duplicate, or out-of-village appointees are rejected or excluded. The Elder council has three fixed slots; appointed ANBU retain their three slots.
- Kage succession preserves the current council term and appointments. The incoming Kage can replace the First Elder and appointed ANBU; earned Elder seats remain fixed until term expiry. The outgoing Kage immediately loses appointment authority.
- Holding multiple roles is allowed. War scoring and order author labels use Kage, then Elder, then ANBU, without adding role bonuses together.
- War role evidence is sealed when a fight starts. Later appointments cannot inflate its settlement rewards.
- Appointed ANBU seats persist across months. Earned seats follow current UTC-month PvP results, excluding appointed ANBU. At least one kill is required; ties use lifetime PvP kills, level, then normalized player name.
- Clearing an appointed ANBU seat removes that appointment. The player can still qualify for an earned seat, which Town Hall now explains.
- The existing Kage challenge rules remain: level 90, seven-day account age, 250 Village Merit, and a 250,000-ryo stake; a 30-minute online overlap obligation, 48-hour challenge expiry, 24-hour post-defense grace, and three-day loss cooldown. The existing ten-day inactivity vacancy and challenge stake refund paths retain their regression coverage.

The ANBU choice follows Town Hall's existing **3 appointed + 7 earned** presentation. The one-kill minimum prevents zero-kill players from becoming ANBU merely because their village is small. This is a rule alignment pass, not a simulation of long-term PvP balance.

## Elder elections and 30-day terms

- The First Elder occupies the defense seat and is appointed by the Kage. The Second Elder occupies the trade seat and wins on PvP performance. The Third Elder occupies the training seat and wins on PvE performance. Each term lasts exactly 30 days, beginning at UTC midnight when the village council is initialized.
- Both performance seats use verified wins earned during the **completed term**, never lifetime totals. Winners hold office during the following term. The First Elder expires at the same boundary and must be reappointed; changing that appointment midterm does not extend the deadline.
- Each player may hold only one Elder seat. PvP is selected first; if the same player leads both categories, the next eligible PvE player receives the Third Elder seat. Ties use normalized player name. At least one qualifying win is required; otherwise the seat remains AI with zero focus.
- On first initialization, only a valid existing First Elder is preserved. The first two earned winners are selected after the first tracked 30-day term. Historical PvE totals cannot establish a trustworthy past-term score, so they are not backfilled.
- The server keeps a protected daily win ledger by village. Ordinary eligible PvP/AI kill rewards and combat missions update it atomically with existing reward receipts. Verified ranked PvP also has an atomic match receipt. Story boss wins, Endless Tower waves, player Hollow Gate encounters, and rewarded live-player Battle Tower/Spire clears contribute through their own settlements. Practice, academy sparring, pet/card battles, borrowed AI tower assists, losses and duplicate claims do not contribute. Existing reward eligibility restrictions still apply.
- The daily scheduler catches up elections, and council reads and protected actions also resolve an expired term immediately. A village returning after several missed cycles selects only from the most recently completed term. It does not accumulate the entire offline gap into one election.
- Every seated player must still have a save in that village. Leaving or deleting the player disables their seat, role, and focus availability. Earned seats wait for the next election instead of being refilled midterm.
- Authority lives in `village:elder-council:<village>`, separately from generic village blobs. Council writes use a dedicated lock and exact compare-and-set. Shared frames project the current seats; old blobs cannot reinstate an expired council. Orders, exams, terrain, war roles, shops, and training read the same council.

## Wiring repaired

1. Added `/api/village/anbu` and registered it in the server router. Appointments validate the current Kage and target membership, serialize writes, preserve other seats, and return the authoritative roster. Generic village blobs cannot restore removed appointments or forge earned members.
2. Town Hall, orders, war scoring, territory guards, raid defense, garrison rotation, and infiltration now consume the same ANBU roster. The seven earned seats were previously only a client display.
3. Public player index entries include the monthly kill count and month. Old entries backfill from saves. Committed PvP mutations and sleeper rewards refresh the index before a client autosave. The month is server-owned, preventing a client from relabeling old kills as the current month.
4. Special Jonin now checks the actual Elder ledger and authoritative Kage seat. It previously treated appointed ANBU as Elders and trusted the cached Kage mirror.
5. Elders now receive the existing 20/20 war role and terrain authority. The war map exposes Elder terrain controls while keeping win-condition controls Kage-only.
6. Shared frames project the authoritative Kage record, including an empty/reset seat. Town Hall and war screens refresh role state; cached titles and the premature local liberation seat no longer grant role effects.
7. Village upgrades and Hollow Gate purchases use the authoritative Kage record with current membership checks. Hollow Gate extension must use the paid endpoint: ordinary village writes can no longer bypass the 10,000 personal Honor Seal cost per 30 days. Village upgrades continue spending treasury seals.
8. Kage membership checks cover the changed structure, win-condition, mercenary, and garrison paths. Village identity is already protected against ordinary client edits.

## Follow-up integration audit

The second review found and repaired these cross-system gaps:

1. Terrain ownership from former leaders could indefinitely block new Elders. A terrain change now retains current officeholders up to their current role quota and releases former assignments. Existing terrain stays in place. A Kage demoted to Elder keeps only one assigned sector, while current Kage authority remains three.
2. Shared game frames previously enumerated only generic village-state rows. A separately appointed council could be invisible elsewhere until another village action created that row. Frames now include every configured village and project its Kage and council directly, even before its first shared-state save. Reads still use one combined batch and preserve ETags.
3. Browser council caches lacked term expiry. Focus bonuses, Logbook Elder standing, war-role previews, and Town Hall controls now require a live term deadline. Expired or undated cached rows cannot keep powers visible when the next network poll is unavailable.
4. Older anonymous roster and opponent-combat projections omitted the new private win ledger fields. They now remove daily council history and ranked settlement receipts while keeping the public profile and required combat data.
5. Delayed ranked recovery could add a win to a term whose winners were already selected. It now counts once when the server first credits the reward, consistently with field/PvE settlements. It never rewrites an already-elected council. Town Hall explains when wins count.

## Validation and limits

- **617 tests passed in the final follow-up suite.** Coverage includes council rollover, actual order/exam/focus authorization, stale and forged state, concurrency, win ledger ownership, combat replay recovery, Kage succession/inactivity, ANBU, territory authority, training, and client regressions.
- Server and client TypeScript checks passed.
- `git diff --check` passed.
- API interaction tests use isolated in-memory storage. The release browser checks also use a disposable local server; no production player data was changed during verification.
- Roster changes update on the existing polling cadence; cached Elder authority expires at the term deadline even without a successful poll. Protected actions independently check server authority. The derived public ranking index uses the existing best-effort refresh/backfill approach; a storage failure can delay earned ANBU display until that index refreshes. Elder elections read authoritative saves for scores and persist the selected winners for the full term.

Primary regression coverage: `api/village/elder-elections.test.ts`, `shared/elder-elections.test.ts`, `api/village/leadership-interactions.test.ts`, and `shared/village-anbu.test.ts`.

## Release verification on current main

Prepared on `663bcd30025c5df83bf7680a0c98d7e6a58174fd`, which matched the healthy production `/health` revision before release.

- Reran all 617 integration tests on an isolated checkout of that main revision plus only these leadership changes: all passed.
- Client lint passed with zero errors (nine existing warnings). Removed an unused import, typed the order test capture, and bound the war screen's fetched Kage identity to its village so changing village cannot retain the prior seat's controls.
- Server and client TypeScript builds, story-content verification, production client build with public deployment-length test values, dist verification, and bundle-size checks passed.
- Refreshed the generated design-token source locations; tooling-handoff, deployment-topology, and rollback compatibility contracts passed.
- Two real Express/Chromium checks passed. The Town Hall journey confirms that all AI seats show zero bonus and have no focus button; ordinary villagers have no appointment/order composer; direct focus, Elder/ANBU appointment, and order-post attempts return 403. Treasury donations and the existing supply-log journey still complete.
