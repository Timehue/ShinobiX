# Pet progression release review

Release authorization covers completing review, passing final-head CI, merging
and verifying the exact production revision. Browser, hosted CI and deployment
results are recorded on PR #450 as they complete. Partial suites are not release
readiness. No production player save or logged-in game was used for validation.

## Progression and compatibility

Vitality increases HP; Power increases both offense channels; Guard increases
both defense channels and adds a bounded stamina contribution; Agility changes
initiative and spatial timing without damage, random dodge or extra actions.
Fixed-phase adventure summons still cast once per player turn. Role-derived
special channels retain species identity. Happiness remains relevant to
adventure summons and training, without a Showdown failure roll.

Species abilities unlock at 1, 5, 10 and 20. Existing utility, advanced offense
and signature techniques gain mastery at 30, 50 and 75. The last gameplay
milestone is exactly 75; levels 76-100 continue stats. Signatures require two
ordinary preparation actions. Guard, Rest and Switch remain universal commands.
No generic milestone filler or additional allocation currency is introduced.

`shared/pet-ability-progression.ts` owns stable species/form ability IDs and the
server-authoritative resolver. Gameplay policy comes from explicit trusted
caller options, not pet payload flags. Fixed-field projection drops foreign
metadata. A 6,762-case before/after projection comparison retained semantics.

Ownership, XP, level, evolution, Growth Points and gear are preserved. The
existing free growth reset recomputes earned allocation without granting points.
Saved preferences remain stored when locked. Eligible native defaults fill
vacancies; the species' native signature always remains its Final Art. The
active kit has four ordinary slots plus its native Final Art, with Tackle a
separate command. A fourth preferred utility can be displaced by the necessary
basic attack; the editor explains this and marks the inactive preference.

| Path | Fresh entry | Retained entry |
| --- | --- | --- |
| Showdown practice, paid Colosseum and ranked duels | Eligible `progression-v3` kit, new stat/effect/AI policy | Stored rules, input proofs and damage versions preserved |
| Spatial duels, Rite, Warfront and shared summon snapshots | Eligible kit and explicit version stamp | Original legacy execution retained |
| Adventure summons | Eligible casts and native signature preparation | Existing fixed player-turn cadence retained |
| Authored Dungeon gate | Explicit `legacy-v2` difficulty | Original authored behavior retained |
| Competitive Tactics | Separate normalized full-library rules | Same normalized rules and library |

Exact original-output golden tests cover both previous damage rules. Legacy
fixtures retain their original assertions with explicit rules markers; new
fixtures test fresh progression behavior rather than rewriting old goldens.

## Authority and rewards

Paid Colosseum victories share a total 20 pet XP among server-proven owned
participants who can level. Taking a hit or being defeated before acting
qualifies; an unused bench does not. Max-level pets do not consume the eligible
share. The 100-win daily limit, ryo amounts and zero practice rewards remain.
XP is part of the existing receipt-guarded save transaction.

Entry consumables, save, ledger and sealed session admission commit atomically
under the existing writer and session lease. Retried/lost acknowledgments resume
the sealed team instead of charging again. Parent encounter entry retains its
chosen-lead and historical spending rules. No storage engine or schema changes
are required. See [admission contract](../pet-battle-admission.md).

Endpoint tests cover duplicate/concurrent settlement, stale commands, reconnect,
lost acknowledgments, ownership removal, protected fields, legacy saves and
admission rollback. Real PostgreSQL transaction tests must pass in final CI.

## Controlled balance evidence

Run `node --import tsx scripts/pet-progression-balance.mts` from the repository
root to reproduce [summary.json](summary.json). The final run covers all 161
species and 14 unlock boundaries, 34,640 natural fights, 99,516 action probes,
11,270 sealed fixtures, 2,130 gear checks and 35 replay checks. It records exact
source fingerprints, seeds, swapped sides, legal allocations, same-rarity
matchup assumptions and before/after retained rules. Integrity failures and
warnings are empty. These are controlled results, not population win rates.

Damage is derived from offense, defense, power, level, role, element, gear,
status, preparation and seeded rolls. Initial percentage and round targets are
calibration hypotheses, not percentage-HP formulas. Extreme damage compression,
healing, shields, control, drain, damage over time and team area attacks have
explicit bounded budgets. All three existing species/role/element ratchets pass
without threshold changes. Four obsolete legacy residual species modifiers are
retired only for v3; the retained legacy table is unchanged.

All-species point-transfer probes demonstrate HP, both offense channels, both
defense channels and initiative effects. The independent equal-donor Guard
control produces 636 Guard wins in 1,268 reachable-form fights, showing useful
mitigation/resource tradeoffs without broad dominance. Twenty additional
synthetic form fixtures are labelled separately. Reproduce
with `node --import tsx scripts/pet-guard-control.mts`; see
[guard-control.json](guard-control.json).

The [saved-preset comparison](saved-preset-before-after.json) records solo wins
against equal default kits at levels 20/75/100 of
50.0/46.9/43.8% and 43.8/34.4/32.8%. Preserving the native Final Art corrects the
previous severe losses. Support-heavy preferences retain a solo opportunity
cost; they are not promised equal performance in every matchup.

The mature plain 1v1 median is four rounds. The proposed 6-10-round reserve
target is **not met**: mature 1v1 with two reserves, 2v2 with two reserves and
3v3 with two reserves have medians 16, 13 and 15. These fights process several
HP bars. At level 100, attrition removes a mean 3.31%, 0.95% and 2.08% of initial
total roster HP respectively. Final-phase action damage remains substantially
above healing, with no judges or repeated switching stall in these samples.

Early resource endings remain a pacing limitation: level-10 2v2/3v3 with two
reserves have medians 18/19, final Rest rates 28.3/32.4%, and attrition contributes
43.9/52.0% of final reported damage. Whole-fight attrition averages 7.67/10.22%
of initial roster HP. Healing and shielding are negligible in those endings.
The release does not claim the reserve target passed or increase all damage
merely to force it. Human high-level and PvP acceptance remains unmeasured.

## Spatial evidence and independent review

The [spatial calibration report](../../release-audit/pet-spatial-calibration-report.md)
includes 592 matrix executions and 96 trace executions with matching final
source fingerprints. True clock decisions fall from 84/296 retained executions
to 9/296 new executions; mixed teams fall from 19/32 to 3/32. The strict
multi-seed trace has 0/24 new clock decisions versus 8/24 retained. All nine
remaining tails are listed. Bounded sustain and 75-second scoring remain an
explicit limitation, not a zero-stall claim.

Independent review found and resolved ordinary-attack exclusion after Guard,
stale protection in next-round forecasts, incorrect support valuation, cross-slot
initiative starvation, blocked approach oscillation, missing fresh Warfront
versioning and saved normalized signatures replacing native signatures. Spatial
fixes preserve real contact, facing, line of sight and lane ownership; no phantom
hit or extra-action fallback is introduced. Focused spatial checks pass 126/126.

## Presentation and release gates

[UI evidence](ui/report.json) checks all 14 boundaries on desktop and mobile,
native Final Art, preserved locked/inactive preferences, overflow and
accessibility. Six screenshots accompany the report. Reproduced empty history
after remount now says "Events this visit" rather than stale "Awaiting Bell";
the authoritative daily win count remains visible. The unroot-caused 3D fallback
was not changed.

Production delivery uses lossless build-time packing of existing literal
catalogs, with executable-AST rejection and round-trip checks. Artwork and URLs
remain identical, and bundle budgets remain unchanged. This is delivery-only;
the canonical gameplay registry stays readable and unmodified by packing.

Required completion gates are the full root suite, server build, client lint,
production build and unchanged size gates, all seven responsive browser projects,
all six strict combat-layout projects, independent final review and every final
head hosted check. The separately owned main-branch scene-handler test repair
must be integrated before that final head. Main CI and exact deployed SHA plus
post-deploy readiness must then be verified. Shrine implementation/CI, unrelated
pet art and dependency updates remain outside this release.
