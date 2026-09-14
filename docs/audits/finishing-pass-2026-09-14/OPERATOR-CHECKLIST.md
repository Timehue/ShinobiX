# Final safe-target and Android certification

**Status: HUMAN CERTIFICATION REQUIRED.** This file is a procedure, not evidence that it was executed. Local memory-store tests and Playwright emulation do not certify production recovery or an Android device. Do not attach passwords, tokens, raw saves or database connection strings to the report.

## Staging / release-health checklist

Record operator, UTC time, source commit, deployed image digest, exact safe hostname, distinct storage-project identity, active flags, expected store, and two disposable player aliases. Preserve redacted command output and receipt identifiers for every step. Stop on a mismatch; do not compensate by overwriting production or deleting uncertain receipts.

| Step | Execute / observe | Required evidence / pass condition |
|---|---|---|
| 1. Target identity | Select an isolated staging deployment and record production denylist. Compare `/health` commit with the built image and expected full SHA. | Exact commit, image and target agree. Unknown commit fails readiness; this audit base is `ecd8d6ccaba017a6791ec0ec94f822c10658984d`, plus only the reviewed patch. |
| 2. Storage identity | Inspect deployment config and authenticated `/health/db`; run `scripts/release-health-check.mjs` with `EXPECTED_COMMIT`, `EXPECTED_SAVE_STORE`, `REQUIRE_KNOWN_COMMIT=1`, `REQUIRE_FRESH_BACKUP=1` and `HEALTH_DEEP_TOKEN` supplied securely. | Correct project/store and healthy reads/writes/backup. Current runbook's normal target is **base-store**; do not configure an empty disk overlay that hides restored saves. |
| 3. Topology/cache | Verify one deployed replica, compiled server entry, correct cache headers for shell/versioned assets, no stale client after a release. | Deployed configuration matches topology gate; old shell refreshes cleanly. A local config check alone is insufficient. |
| 4. Fresh login / first save | Create disposable new account through normal client, complete character creation, record returned `_saveVersion` and initial balances, refetch and relog. | Expected baseline and authoritative save survive; no loop, silent lost save or unnecessary refresh instruction. |
| 5. Existing save compatibility | Load representative early/mid/endgame and legacy-timer fixture accounts in staging, preserving anonymous before snapshots. | Inventory, jutsu, titles/cards, pets, training, clan membership and current run are retained. |
| 6. Representative rewards | Complete Academy/Solo mission; test Scholars member, no-clan and other-doctrine controls. Complete PvP/ranked, Tower, Hollow Gate, Chronicle, companion and boss representative approved paths. | Record admission ID, exact terminal, player/run binding, before/after resources and receipt. Each amount is server-derived and agrees with intended display. Separate fresh pools from continuous-vitals modes. |
| 7. Lost response | Drop only the response after a confirmed commit using a staging proxy/harness, then resend the **same** request identity; repeat simultaneous duplicate. | Exactly one cost/payout, same receipt or repaired current authoritative state; no fresh roll or new token. |
| 8. Interrupted process | At documented pre-write, post-save/pre-marker and between-participant boundaries, terminate/restart only the isolated instance. Retry same identity. | Both sides converge once, or expose a durable unresolved state that the operator can find. C3/C4 remain unresolved; C5 is patched locally and still needs verification on the target deployment. |
| 9. Negative proofs | Wrong player/run/mission/sector/engine, old/expired token, forged amount/winner and repeated success. | Request rejected or harmless replay; balances/items/rating/control unchanged. Valid retry must not be rejected merely because the live session row expired if durable recovery permits it. |
| 10. Reconnect | Background/resume, transport loss and relog during ordinary PvE, PvP, Hollow Gate and a Clan Boss party. | Resume correct authoritative turn/run; no relocated player, refunded consumable, duplicate reward or blank route. |
| 11. Receipts / operator roles | Use existing Battle Receipts with PvP battleId and HG `hgcombat-…`; use Economy Settlements state list and source audit records. Try ordinary player and content-admin credentials against full-admin tools. | Correct allow/deny policy, correlation player→activity→transaction→applied value. Record gaps in search filters; do not weaken auth or claim a universal search exists. |
| 12. Scheduled ownership | Inventory actual scheduled jobs, enabled flags, primary identity and lease records. Trigger two contenders on staging for a representative season/weekly payout/snapshot job. | One winner/one payout; skipped contender reported; rerun does not duplicate awards. No replica increase or scheduler redesign. |
| 13. Fresh backup | Follow current `docs/BACKUP_RESTORE_RUNBOOK.md`. Export fresh base-store backup; include a retired overlay only for an explicitly reviewed legacy rollback capture. | Backup timestamp, manifest/hash, counts, source identity and coverage known. Historical “hybrid” wording in #20 does not authorize re-enabling retired storage. |
| 14. Isolated restore | Restore into a **different, empty** project. Exercise same-target and nonempty-target refusals; verify checksums/counts before commit. | Refusal guards work; `applicationValidation` dictates base-store versus intentional legacy overlay settings. No overwrite override. |
| 15. Record verification | Authenticated reads of representative new/mid/endgame saves, pets/images, clan treasury/members, territory, pending+committed receipts, ranked and Hollow Gate state. | Match redacted source hashes/selected fields; no missing base-only row, phantom overlay duplicate or lost pending claim. Measure restore duration, RPO and RTO. |
| 16. Service restart | Restart isolated restored service with scheduled jobs disabled, then health/login/read/reconnect checks. | Same data and identity; no unexpected scheduled rewards or stale cache. |
| 17. Retained-image rollback | Retain current image and compatible previous image. Freeze isolated activity while switching to prior image **without rolling back schema/data**. | Prior image boots, reads newer saves without destructive normalization, preserves unknown receipt/timer fields and pending transactions. |
| 18. Forward deploy | Redeploy reviewed current image; resume previously pending run/claim and repeat a successful claim. | No replay payout, lost data or reset progression. Health/cache/commit agree again. |
| 19. Load/reconnect | Follow `docs/staging-load-and-reconnect-runbook.md`; exact target confirmation + production denylist + disposable credentials for mutations. | Existing gates: 5xx < 0.1%, normal p95 < 500ms, save/reward p95 < 1000ms, reconnect 100% and p95 < 5s; generator AND server memory assessed separately. Do not raise thresholds. |
| 20. Closeout | Attach redacted evidence, active flags, timings, failures and final disposition; revoke temporary credentials and remove only verified isolated resources after review. | #10/#20/#15/#18/#16/#9 closure based on actual owner/staff evidence, never on this checklist alone. |

The existing `npm run certify:release -- --url=<verified-staging>` creates accounts and completes reward-bearing combat. Use only that verified safe target. The default command boots a disposable local memory server and proves API behavior, not Postgres NX/CAS, cache or restore durability.

## Actual Android / Google Play build smoke

Record package name, versionName/versionCode, build SHA, install channel, device model, Android/WebView version, RAM, display density, navigation mode, orientation and network. Use one supported lower-end device and one representative current device if available. Check both clean install and update with an established save. Do not mark boxes from desktop Chromium emulation.

- [ ] Install/update: launch, asset load, session/save retained, no blank screen or unintended first-run reset.
- [ ] Login and character creation: keyboard/autofill, validation, submission, first save and return login work.
- [ ] Village, Training and Missions: primary actions reachable; start/complete/claim matches server state after background/resume; Scholars display and payout agree.
- [ ] Inventory/jutsu: tabs, long lists, scroll, equipment, consumables and dialogs reachable; no hidden primary action or accidental horizontal page scroll.
- [ ] World map: pan, zoom, double tap, sector selection/travel, drag cancellation and portrait→landscape→portrait retain position and a usable next tap. No stuck hover or unintended travel.
- [ ] Hollow Gate: enter, traverse, fight, use item, reconnect with sealed encounter, retreat/finish; costs/rewards once; no stale physical state.
- [ ] Celestial Tower entry: open/close modal and visit Endless Tower, Battle Towers, Echoes of War and First Pact where unlocked; test one representative run and return route. Exercise Endless Spire separately through its current entry.
- [ ] PvP/ranked: fighter/AP HUD, action tray/jutsu board, turn clock, result and reconnect; opponent result cannot be covered by an uncloseable layer.
- [ ] Pets: Home/Yard training, breeding/hatch, pet roster, Showdown/Coliseum, Ladder, Warfront and Gauntlet where enabled; essential art and controls load. Verify custody/claim after resume.
- [ ] Chronicle/Card: owned deck selection, touch placement, result, Echoes/First Pact progression and recovery; no persistent touch-hover overlay.
- [ ] Clan Hall: roster, roles, chat/notices, treasury/Exchange/mission tabs, war/boss entry, scroll and leave control. Do not deliberately test C3–C5 with ordinary players.
- [ ] Messaging/social: long list and conversation scrolling, keyboard send/close, profile return and back history.
- [ ] Store: village shop, premium storefront and approved payment sandbox return/cancel flow; correct balances, no double buy from one gesture.
- [ ] Android back: closes the intended local dialog/keyboard before exiting or navigating; no accidental loss of an active run.
- [ ] Keyboard: focused field and its required submit action remain reachable; closing keyboard restores geometry.
- [ ] Portrait/landscape: supported orientations retain reachable actions and scroll position; system bars/cutout/gesture area do not collide with controls.
- [ ] Touch/scroll: primary tap works once, drag does not activate a button, scroll is not trapped, hidden/invisible hit targets remain functional.
- [ ] Background/resume and reconnect: short/long suspension, Wi-Fi↔mobile data and transport loss restore authoritative run/save without duplicate claim or login loop.
- [ ] Performance: measure cold/warm startup, map/combat frame responsiveness, long-session memory/thermal behavior and essential image/audio load on real hardware. Record observations, not invented pass thresholds.

No global breakpoint, navigation, HUD scale, font, padding, overflow or control-size change is approved by this checklist. A reproduced blocker gets an existing/failing test, a local cause/fix, required gates and before/after evidence.
