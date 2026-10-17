# Level 75 prepared capacity probe

Baseline: `a31087565df43d4b34f81f5b5bdb5acf5841b724`. Candidate head at start: `e4e3689fefe9d888c58518e92ff5cec05f6a57f8`. Complete: **true**. Source changes: 0; baseline changes: 0. Raw audit, full fixtures, source hashes and complete per-action traces are in [the JSON](level75-prepared.json).

The 12-slot controls preserve the earlier optimized level 75 stats, owned gear, S-rank multiplier and mastery 50. Only the four added catalog techniques differ. Production audit confirms 12 baseline slots, two natures, a 2,100 stat cap and 17,711 earned points. Rotation and sustain kits are both retained; neither is selected per enemy.

Both kits beat all five standard Explore openings, including the level 71 assassin and level 74 defender that defeated the earlier eight-slot control. The rotation kit also wins all three standard road controls. Across these 13 candidate rows, fights last 6–11 rounds. The utility kit reaches 39.5–62.5% minimum HP across its five openings; the rotation kit reaches 18.4–50.5% across its eight openings. These results establish an accessible prepared route at unchanged stats and gear. They do not establish that narrower or less trained builds are equally capable.

The earlier eight-slot results remain in [progression.json](progression.json): three wins in five standard controls, including losses against the Explore level 71 assassin (round 6, enemy 3,575 HP remaining) and level 74 defender (round 12, enemy 950 HP remaining). This probe supplements those failures rather than replacing them. The rotation kit wins those exact openings at 2,319 and 1,453 HP; the utility kit wins at 4,659 and 4,569 HP out of 7,900. No production tuning was performed for this probe.

Dangerous and elite outcomes remain a material limit: the rotation kit wins two of eight dangerous controls and zero of eight elite controls, all losses ending at zero HP rather than a living turn limit. This probe does not demonstrate a winning elite route at level 75 or prove that its bounded player policy is optimal. Preparation resolves the standard-fight accessibility concern; the optional higher tiers still require separate strategy or progression evidence.

Fixture audit: every base stat is 1,485 except Ninjutsu Offense at 1,496; the exact allocation uses the production earned-points ledger. Both kits use acquired Earth/Wind natures, legal mastery 50, and the non-subscriber 12-slot entitlement. The Elderbranch Katana and five Crimson Tide armor pieces have effective level requirements of 65, below level 75. Catalog armor contributes 35% raw damage reduction and 5% lifesteal; no extra passive was invented. The saved S-rank multiplier is 1.20. These are synthetic prepared fixtures with legal ownership and requirements, not a claim about the time or cost to acquire this gear or train every technique. Both production audits report `legal: true`, zero failures and zero acquisition warnings.

The rotation kit adds Crumbling World Illusion, Screaming Void, Aerial Blade Fan and Whispering Calm. The utility kit adds Stone Needle Volley, Iron Sand Burst, Stoneheart Meditation and Boulder Heel Drop. Exact catalog definitions, AP/resource costs, cooldowns and mastery are retained in the JSON. The same public-state, weapon-aware bounded own-turn planner controls the player before and after; it does not inspect future enemy choices. All five Explore seeds and all three road seeds are retained, including every difficult-tier failure.

Damage and recovery are distinct. Against the level 71 assassin, the utility kit records 5,610 observed HP damage, 1,644 damage absorbed by shielding and 2,869 observed applied healing, ending with 3,241 net HP loss. The rotation kit records 6,364 observed HP damage, no shield absorption and 1,283 observed applied healing, ending with 5,581 net HP loss. Event-level damage and healing can net within one event, so those observed counters are not an exact conservation ledger; minimum and ending HP are measured directly.

Reproduce from the repository in PowerShell:

```powershell
$env:NODE_PATH = Join-Path (Get-Location) 'node_modules'
node --import tsx scripts/pve-level75-prepared-probe.ts --baseline-root ../pve-current-main
```

The run completed with exit code 0 and 58 paired rows. Every row completed. The probe checks 267 candidate source hashes before and after, checks the archived baseline hashes, and validates archived runtime bytes against the immutable baseline Git tree. All change and archive-mismatch lists are empty. Raw JSON is 1,443,459 bytes; its SHA-256 is `60493449f0c8852153bdc1a5afe910642d559d2b83814b491f0144eab0b65b96`. Probe script SHA-256 is `b7de095dc757eb4d5fe837208e3a5b12a2d7b698b9c2fec42738413ee7c9fc13`. `npm run build:server` and strict standalone TypeScript checking both exited 0.

- sustain12|explore|standard|planner|before: 5/5wins, 0HP-zero endings, 0living limits, mean 7.6rounds.
- sustain12|explore|standard|planner|after: 5/5wins, 0HP-zero endings, 0living limits, mean 9.4rounds.
- rotation12|explore|standard|planner|before: 5/5wins, 0HP-zero endings, 0living limits, mean 7.0rounds.
- rotation12|explore|standard|planner|after: 5/5wins, 0HP-zero endings, 0living limits, mean 8.8rounds.
- rotation12|natural|standard|planner|before: 3/3wins, 0HP-zero endings, 0living limits, mean 6.7rounds.
- rotation12|natural|standard|planner|after: 3/3wins, 0HP-zero endings, 0living limits, mean 8.7rounds.
- rotation12|explore|dangerous|planner|before: 5/5wins, 0HP-zero endings, 0living limits, mean 7.6rounds.
- rotation12|explore|dangerous|planner|after: 1/5wins, 4HP-zero endings, 0living limits, mean 10.0rounds.
- rotation12|natural|dangerous|planner|before: 3/3wins, 0HP-zero endings, 0living limits, mean 7.7rounds.
- rotation12|natural|dangerous|planner|after: 1/3wins, 2HP-zero endings, 0living limits, mean 10.3rounds.
- rotation12|explore|elite|planner|before: 5/5wins, 0HP-zero endings, 0living limits, mean 7.4rounds.
- rotation12|explore|elite|planner|after: 0/5wins, 5HP-zero endings, 0living limits, mean 8.6rounds.
- rotation12|natural|elite|planner|before: 3/3wins, 0HP-zero endings, 0living limits, mean 7.3rounds.
- rotation12|natural|elite|planner|after: 0/3wins, 3HP-zero endings, 0living limits, mean 9.0rounds.

| Fixture | Source | Tier | Seed | Enemy Lv | Policy | Variant | Outcome | Rounds | MinHP | EndHP | EnemyHP |
|---|---|---|---:|---:|---|---|---|---:|---:|---:|---:|
| sustain12 | explore | standard | 0 | 67 | planner | before | win | 7 | 5647 | 6809 | 0 |
| sustain12 | explore | standard | 0 | 67 | planner | after | win | 7 | 3121 | 3121 | 0 |
| sustain12 | explore | standard | 1 | 69 | planner | before | win | 6 | 5966 | 7166 | 0 |
| sustain12 | explore | standard | 1 | 69 | planner | after | win | 9 | 4372 | 4711 | 0 |
| sustain12 | explore | standard | 2 | 71 | planner | before | win | 7 | 6573 | 7900 | 0 |
| sustain12 | explore | standard | 2 | 71 | planner | after | win | 11 | 3762 | 4659 | 0 |
| sustain12 | explore | standard | 3 | 73 | planner | before | win | 9 | 5753 | 6915 | 0 |
| sustain12 | explore | standard | 3 | 73 | planner | after | win | 9 | 4937 | 4937 | 0 |
| sustain12 | explore | standard | 4 | 74 | planner | before | win | 9 | 6768 | 7096 | 0 |
| sustain12 | explore | standard | 4 | 74 | planner | after | win | 11 | 4418 | 4569 | 0 |
| rotation12 | explore | standard | 0 | 67 | planner | before | win | 6 | 5402 | 5922 | 0 |
| rotation12 | explore | standard | 0 | 67 | planner | after | win | 7 | 3991 | 4592 | 0 |
| rotation12 | explore | standard | 1 | 69 | planner | before | win | 6 | 6047 | 6171 | 0 |
| rotation12 | explore | standard | 1 | 69 | planner | after | win | 6 | 3368 | 3917 | 0 |
| rotation12 | explore | standard | 2 | 71 | planner | before | win | 7 | 5506 | 5901 | 0 |
| rotation12 | explore | standard | 2 | 71 | planner | after | win | 10 | 2149 | 2319 | 0 |
| rotation12 | explore | standard | 3 | 73 | planner | before | win | 8 | 5477 | 5531 | 0 |
| rotation12 | explore | standard | 3 | 73 | planner | after | win | 10 | 2265 | 2386 | 0 |
| rotation12 | explore | standard | 4 | 74 | planner | before | win | 8 | 5423 | 5578 | 0 |
| rotation12 | explore | standard | 4 | 74 | planner | after | win | 11 | 1453 | 1453 | 0 |
| rotation12 | natural | standard | 0 | 67 | planner | before | win | 6 | 5402 | 5922 | 0 |
| rotation12 | natural | standard | 0 | 67 | planner | after | win | 7 | 3991 | 4592 | 0 |
| rotation12 | natural | standard | 1 | 69 | planner | before | win | 6 | 5799 | 5906 | 0 |
| rotation12 | natural | standard | 1 | 69 | planner | after | win | 9 | 2364 | 2490 | 0 |
| rotation12 | natural | standard | 2 | 71 | planner | before | win | 8 | 5281 | 5382 | 0 |
| rotation12 | natural | standard | 2 | 71 | planner | after | win | 10 | 2959 | 2967 | 0 |
| rotation12 | explore | dangerous | 0 | 75 | planner | before | win | 7 | 3445 | 3445 | 0 |
| rotation12 | explore | dangerous | 0 | 75 | planner | after | loss | 9 | 0 | 0 | 1616 |
| rotation12 | explore | dangerous | 1 | 75 | planner | before | win | 7 | 5252 | 5326 | 0 |
| rotation12 | explore | dangerous | 1 | 75 | planner | after | win | 10 | 1407 | 1407 | 0 |
| rotation12 | explore | dangerous | 2 | 75 | planner | before | win | 8 | 4224 | 4417 | 0 |
| rotation12 | explore | dangerous | 2 | 75 | planner | after | loss | 11 | 0 | 0 | 645 |
| rotation12 | explore | dangerous | 3 | 75 | planner | before | win | 8 | 4503 | 4503 | 0 |
| rotation12 | explore | dangerous | 3 | 75 | planner | after | loss | 9 | 0 | 0 | 399 |
| rotation12 | explore | dangerous | 4 | 75 | planner | before | win | 8 | 5069 | 5122 | 0 |
| rotation12 | explore | dangerous | 4 | 75 | planner | after | loss | 11 | 0 | 0 | 916 |
| rotation12 | natural | dangerous | 0 | 75 | planner | before | win | 7 | 3445 | 3445 | 0 |
| rotation12 | natural | dangerous | 0 | 75 | planner | after | loss | 9 | 0 | 0 | 1616 |
| rotation12 | natural | dangerous | 1 | 75 | planner | before | win | 8 | 4468 | 4521 | 0 |
| rotation12 | natural | dangerous | 1 | 75 | planner | after | win | 11 | 689 | 689 | 0 |
| rotation12 | natural | dangerous | 2 | 75 | planner | before | win | 8 | 5069 | 5122 | 0 |
| rotation12 | natural | dangerous | 2 | 75 | planner | after | loss | 11 | 0 | 0 | 916 |
| rotation12 | explore | elite | 0 | 75 | planner | before | win | 6 | 2044 | 2044 | 0 |
| rotation12 | explore | elite | 0 | 75 | planner | after | loss | 8 | 0 | 0 | 1466 |
| rotation12 | explore | elite | 1 | 75 | planner | before | win | 7 | 4455 | 4455 | 0 |
| rotation12 | explore | elite | 1 | 75 | planner | after | loss | 8 | 0 | 0 | 1780 |
| rotation12 | explore | elite | 2 | 75 | planner | before | win | 8 | 3502 | 3608 | 0 |
| rotation12 | explore | elite | 2 | 75 | planner | after | loss | 8 | 0 | 0 | 2462 |
| rotation12 | explore | elite | 3 | 75 | planner | before | win | 8 | 3875 | 3928 | 0 |
| rotation12 | explore | elite | 3 | 75 | planner | after | loss | 9 | 0 | 0 | 2340 |
| rotation12 | explore | elite | 4 | 75 | planner | before | win | 8 | 4493 | 4546 | 0 |
| rotation12 | explore | elite | 4 | 75 | planner | after | loss | 10 | 0 | 0 | 1011 |
| rotation12 | natural | elite | 0 | 75 | planner | before | win | 6 | 2044 | 2044 | 0 |
| rotation12 | natural | elite | 0 | 75 | planner | after | loss | 8 | 0 | 0 | 1466 |
| rotation12 | natural | elite | 1 | 75 | planner | before | win | 8 | 3907 | 3960 | 0 |
| rotation12 | natural | elite | 1 | 75 | planner | after | loss | 9 | 0 | 0 | 1720 |
| rotation12 | natural | elite | 2 | 75 | planner | before | win | 8 | 4493 | 4546 | 0 |
| rotation12 | natural | elite | 2 | 75 | planner | after | loss | 10 | 0 | 0 | 1011 |

- Synthetic L75 fixtures with exactly17711earned points, S-rank multiplier1.20, mastery50 and obtainable legendary catalog gear; no invented passive, companion, consumable or supporter capacity.
- Both fixed Earth/Wind kits use12baseline slots; stats/gear/bloodline are unchanged from the earlier optimized eight-slot L75 fixture.
- The same current bounded own-turn player policy is used in both variants. It is weapon-aware and reads only public state and its own legal actions; no future opponent response is searched.
- Before uses archived main resolver/builder/catalog at the same exact rolled enemy level, role, seed, player fixture and player policy. Ordinary profile adapter is unchanged at this baseline.
- Observed HP damage, shields, applied healing, net loss and minimum/end HP are distinct; recovery may net within one event.
- All failures and alternative controls are retained. A winning route is evidence of accessibility, not a promise every legal build or policy wins.
