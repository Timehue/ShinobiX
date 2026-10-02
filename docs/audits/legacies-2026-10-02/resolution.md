# Legacy audit corrections — 2026-10-02

The user authorized correcting the acquisition audit. Late-game requirements
remain: reaching level 96+ before finishing a path is acceptable. Existing
accepted identities, earned totals and completed stage receipts are preserved.

The canonical rules remain in `api/_legacy-defs.ts` (qualification),
`api/_legacy-core.ts` (new trials), and the server settlement handlers (deeds).
[The generated roster](../../legacy-roster.md) now includes all qualification
floors and both variants of every stage. The original audit evidence is a
historical before-fix snapshot.

| Finding | Correction |
|---|---|
| F01, PvP raid credit | General combat progression now runs in the committed terminal-effects barrier. The old win report shares the same repair helper and receipts. Both fighters, guard defense and V2 ranked wins receive credit without a browser callback. Guard duty is witnessed at session creation and written to the existing private proof row before battle publication. A later notification cannot overwrite the roles. Input evidence and completion markers outlive the 48-hour terminal recovery horizon. Pending combat receipts also survive later activity receipt churn. |
| F02, upset proof at the cap | The existing five-level upset remains. At character level 96+, defeating a server-sealed player-ranked opponent with a pre-match rating at least 100 higher also earns upset proof. Qualification floors and the level cap were not lowered. |
| F03, PvE attribution | Applied Solo-PvE facts supply specialty damage, healing, shield grants and absorption to AI, combat-mission and story settlements. Hunt combat uses its authoritative embedded Tower. Public Tower clears and active Clan Boss assaults also bank specialty/support deeds through stable run receipts. Practice and existing AI reward caps remain excluded. |
| F04, support meanings | Basic Heal, Siphon, Lifesteal, Absorb and armor healing now report the HP actually restored. PvP parsing recognizes those formats. `damageBlocked` is labeled shield absorption. The old `comebackWins` field is described as a clutch victory ending at 15% HP or less; it does not claim to measure an earlier deficit. |
| F05, dungeon clears | Fully verified Hidden Dungeon Warden/Card/Pet settlements increment `dungeonClears` once. Redeemed-run retries repair a failed Legacy write without paying the Dungeon reward again. Hollow Gate remains a separate producer. |
| F06, surprising later PvP | Paths without a mandatory PvP qualification proof get theme-compatible non-PvP trial secondaries. Village alternate primaries also have a raid route. New and previously stored offers expose activity families through Sage dialogue before acceptance, with the signature’s Bound-stage unlock and reroll terms. |
| F07, repeated offers | The first appearance retains best-fit/alternate/fallback selection. Later appearances prioritize eligible paths never shown, then those least recently shown. A bounded history of at most 100 IDs lives in the existing Sage pity row and survives event-log trimming and declines. Spawn odds and cooldowns remain unchanged. |
| F08, opponent exhaustion and uneven decay | Per-opponent weights renew each UTC day: 1, 1, 0.5, 0.25, then zero. Both fighters’ combat counters and sector-war proof use this policy. Effects from the same battle reuse one weight; overlapping guard/sector defense counts once. Late recovery retains newer day evidence and the original battle weight even after ordinary receipt churn. Ring checks compare opponents from the same day. Existing age/IP/device/level-gap checks remain. |
| F09, stale offer acceptance | Before the first permanent seal, acceptance reads current level, stats, suspicion and overlay availability. Changed eligibility returns a clear refusal. An already-sealed acceptance continues its original replay/repair path even if eligibility subsequently changes. |
| F10, stale roster | `npm run generate:legacy-roster` writes the roster from definitions and trial generation; `npm run check:legacy-roster` and a unit test detect drift. Current hook ownership is reflected in the system plan. |

Compatibility: an already-issued unfinished trial retains its objectives and
baselines. Completing it remains valid; rerolling obtains the current alternate
with fresh baselines. Completed stages and accepted paths are never reset.
Historical unrecorded combat damage/healing cannot be invented from aggregate
save totals. Corrections apply to new deeds and still-recoverable settlements.

Focused validation passed: 125 initial checks, 52 regression checks, 26 combat/
Dungeon/parity checks, 39 settlement/narrative checks, 23 follow-up checks and
48 final recovery/war/mission/Card Clash/roster/client checks.
These runs overlap; they are not a unique-test total. The follow-up includes
Card Clash daily attribution and the regression that shield expiration cannot
earn damage or absorption credit. The final recovery test first reproduced a
winner being credited twice after a failed loser write and 270 later mission
receipts; it now repairs both fighters once and preserves the original war
weight. Dated battle receipts remain in the existing receipt array for three
UTC days plus boundary headroom, then prune on later activity; permanent
milestone and war receipts remain. The main game audit confirmed that the final
combined server typecheck passed after the retention correction and a test-only
observation-namespace typing correction. Its log is
[remediation-server-build-final.log](../full-game-2026-10-02/remediation-server-build-final.log).

The first full runner finished with 12,380 passes and 107 failures. Two old
Card Clash lifetime-key expectations were then corrected and passed their
focused rerun. Guest cleanup and socket hydration assertions overlap fixes in
the main game audit; many remaining workers could not load client packages
during concurrent dependency repair. The `npm test` pretest hit a locked native
DLL, and client lint could not load its formatter from the incomplete tree.
These logs are retained; this is not a passing full-suite result. The Legacy
runtime is frozen. The main game audit has restored dependencies and owns final
combined validation. The required `shinobij.client` `npm run lint` completed
with exit 0 and no findings (`fix-lint-final.txt`). The restored combined runner
then finished with 13,153 passes and 10 failures; the main game audit is resolving
those save/content/fixture failures and owns the final combined rerun and UI
gates. This is not a passing full-game result. Its candidate also receives the
guard integration correction below before final validation.

## Integration readback after the user's double-check request

The follow-up traced the current producers through their actual handlers,
retry barriers, public API projections and client consumers. Valid paths that
finish at level 96+ remain intact.

| Connection | Verified contract |
|---|---|
| Qualification → offer → acceptance | Definitions and current score/overlay rules feed Sage rolls; first acceptance rechecks current eligibility. Sealed acceptance retains its repair path. |
| Sage data → map dialogue → choice | Both stats and Sage endpoints apply `publicSageOffer`, including activity families for older stored offers. WorldMap builds the Sage dialogue and opens the choice modal on completion. |
| PvP terminal → both Legacy records | Move, turn deadline, lapse and reward claim use the committed terminal barrier. Real world-raid claim retries repair a failed loser write without a client win report, duplicated winner credit or a second base reward. |
| Guard create → terminal recovery | The existing server guard-duty lookup supplies the two participant names before world-battle publication, including guards with no Town Defense upgrade. Notification uses NX. Settlement validates both names, and successful delivery retires the proof. |
| Combat mission start → queue → claim | `runId` equals `sessionId` throughout admission and settlement. Real claim recovery credits sealed specialty damage, healing and shield facts once, alongside mission and kill counts. |
| Story and public Tower → deeds | Real handlers credit sealed style/support proof. Story recovery preserves the committed reward. Tower retains member leases through failed Legacy delivery, then releases them after stable repair; enemy actors receive no credit. |
| Other combat → deeds | AI reports retain reward eligibility and daily caps; Hunt reads its embedded authoritative Tower; Clan Boss requires active contribution. Verified Hidden Dungeon settlement and redeemed-run retry share a durable clear receipt. |
| Trial → stage → rewards | The actual acceptance/reroll/completion journey reaches stages II–V, preserves titles and world receipts, and opens matching Era admission. All 100 signature links and the generated qualification/trial roster pass parity checks. |

This readback found guard input evidence expiring at two hours while terminal
claims recover for 48 hours. The real guard-challenge→40-hour settlement test
first reproduced missing defense credit (`integration-guard-before.txt`). The
proof now uses the same seven-day retention as the completion receipt. The
trace also found that creating this proof depended on an interruptible map
notification; session creation now owns its publication. An unconfirmed proof
write prevents the battle from being published and returns a retryable 503.
These changes use the existing `legacy:guard-defense:<battleId>` key and its
existing `{ defender, attacker }` body; no new persisted session field or
storage structure is introduced.

Final follow-up validation: **122/122 passed**, zero skips/cancellations, on
pinned Node 24.21.0 with test concurrency 1
([integration-final-results.txt](integration-final-results.txt)). This includes
real creation/claim/mission/story/Tower recovery, long-lived guard evidence,
participant binding, Sage rotation and acceptance, all stages, signatures,
roster parity and client stage presentation. The final combined server
`tsc -p tsconfig.cpanel.json --noEmit` completed with exit 0 and no diagnostics
([integration-typecheck.txt](integration-typecheck.txt)). `git diff --check`
passed for this follow-up's source/test files. No screen or component changed.
The earlier `integration-handler-results.txt` includes one failed fixture that
reused accounts with a previous battle's pending pointers; isolated identities
replaced that setup before the passing final run.

No SQL migration, authentication change or currency/reward rate change is part
of this correction. The user's later direct-main release request is tracked in
[release.md](release.md).
