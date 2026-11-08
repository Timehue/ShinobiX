# Multi-stage boss transformations

A boss with a transformation plan changes form during the same battle when its
health first falls to a configured threshold. The battle instance, the player's
resources, statuses and cooldowns are untouched; only the boss changes.

## Where it lives

| Piece | File |
| --- | --- |
| Rules shared by every engine (thresholds, multi-crossing, lethal guard, multipliers, charge, upkeep, client view) | `shared/boss-transformations.ts` |
| Battle Towers adapter + tower plans + form jutsu | `api/towers/_boss-forms.ts` |
| Solo-PvE adapter (story fights) | `api/solo-pve/_boss-forms.ts` |
| Which solo-PvE bosses transform | `api/solo-pve/_boss-transformation-registry.ts` |
| Final Kage plans | `api/story/_kage-transformations.ts` |
| Phase chip, aura, cut-scene, reveal order | `shinobij.client/src/components/BossFormStatus.tsx`, `BossFormCutscene.tsx`, `src/lib/boss-form-view.ts`, `src/lib/boss-form-reveal.ts`, `src/styles/boss-forms.css` |
| Form art | portraits: `public/portraits/cinematic/storywide/*-{thunder-shroud,ember-cloak,oath-gate,moon-hermit}.webp`, `public/portraits/towers/forms/*.webp`; battle sprites: `public/combat-actors/forms/*-idle.webp`. All painted over each boss's own art by `scripts/paint-boss-forms.py` |

## Rules

- **Sealed per fight.** The plan is copied into the session when the encounter
  is built. A deploy never changes a fight in progress, and sessions created
  before plans existed never transform.
- **Once only, even after a refresh.** `bossForms.triggered` records every form
  entered in the persisted session. Re-reading or reloading the session never
  re-runs a transformation; the client remembers which cut-scenes this tab has
  shown (`sessionStorage`), so a refresh does not replay one either.
- **Several thresholds in one hit.** Every crossed form is marked entered, in
  order. The boss lands in the deepest one: its stats, mechanic and heal apply.
  Moveset changes apply cumulatively (so the kit does not depend on hit size).
  Skipped forms' heals are forfeited. One cut-scene plays and names the skipped
  forms.
- **A hit that would kill.** With `lethalGuard` (default on) a lethal blow while
  a form is pending leaves the boss at 1 HP and it transforms instead. The next
  lethal blow wins through the engine's normal victory path. Tower plans set
  `lethalGuard: false`: their bosses have tens of thousands of HP, and a tower
  knockout also clears the turn slot.
- **Cut-scene first, then the new art.** The server records the transformation at once, but the client keeps drawing the boss as it was (its earlier form, or its base art) until the visual-novel scene has played: the scene's first line shows the old art, the following lines the new form, and only when it ends do the board sprite, portrait, aura and phase chip change (`useBossFormReveal`). The sealed `avatarImage` is never rewritten.
- **The scene never covers a result.** It does not open once the fight has
  ended (the result screen owns the stage), and a floor's own phase-gate banner
  waits while it plays. In a tower party, other players' turn timers keep
  running during the scene, which is short and skippable.
- **Favoured techniques are a real AI program.** The form prepends
  "use when ready" rules for its `favor` list and adds the unconditional
  fallbacks the rule validator requires; everything else still goes to the
  boss's sealed turn planner.
- **Victory and settlement are unchanged.** Story settlement reads only the
  session's winner and binding, never the boss's HP or kit.

## Form fields

`atHpPct`, `formName`, `portrait` and `sprite` (optional; without them the client
paints the `aura` over the boss's own art), `cutscene` (speaker + 1-3 lines), `summary`, `damageMult`,
`damageTakenMult`, `healPct`, `upkeepPct`, `moveset` (`add` / `remove` /
`favor`, where `favor` puts those techniques first in the AI's priorities) and
one `mechanic`:

- `charged-strike`: armed on the boss's turn (the first one waits a round after
  the transformation), released on its next turn for `damagePct`% of each
  target's max HP (shields absorb first). Deal `breakPct`% of the boss's max HP
  or stun it in between to break it; a broken charge staggers the boss. Only
  damage from others counts: a limit-burn or upkeep moves the charge's baseline
  down by the same amount. In towers, no charge arms while living guards make
  the boss untargetable, and one already gathering fizzles.
- `guard-stance`: takes `damageTakenMult`x, except attacks matching `weakness`
  (an element or jutsu type, or a list of them), which take `weaknessMult`x.
- `limit-burn`: loses `burnPct`% of max HP at the end of each of its turns,
  never below 1 HP. `upkeepPct` adds the same kind of cost to any form. In
  towers both pause while guards make the boss untargetable.
- `summon`: reinforcements on entry (Battle Towers only).

Every value is clamped by `BOSS_FORM_LIMITS`, and `validateBossTransformationPlan`
rejects bad data when a fight is sealed.

## Adding a boss

- **Tower floor:** author a plan (and any new form jutsu) in
  `api/towers/_boss-forms.ts`, then set `boss.transformation: '<plan id>'` on
  the floor in `api/towers/_floor-catalog.ts`.
- **Solo-PvE boss:** add the plan to the registry under the encounter kind and
  AI profile id, or give the profile a `bossTransformation`. Key by kind as
  well as id: raid village guards reuse the story finale ids and must not
  transform.

## Balance

The story finales and tower milestone floors sit behind simulation gates
(`scripts/story-late-balance.test.ts`, `scripts/tower-story-balance.test.ts`).
A form that heals or hits harder must pay for it, through more damage taken or
an upkeep/limit burn, or those gates fail. Re-run both after changing a plan.
