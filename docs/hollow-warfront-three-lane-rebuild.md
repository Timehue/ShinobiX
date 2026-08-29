# Hollow Warfront: Three-Lane Rebuild

Status: production specification
Mode fantasy: **four bonded pets, three sealed fronts, two towers to victory**

## Product promise

Hollow Warfront is no longer a miniature MOBA. It is a short, readable command game about committing a four-pet squad across three isolated causeways, watching each matchup resolve, and making a small number of decisive redeployments.

The player should understand the match in five seconds:

1. Every lane is physically separate.
2. Each lane ends at one enemy Ward Tower.
3. A four-pet squad must deploy 2–1–1.
4. Every two minutes, one pet may change lanes.
5. The first player to destroy two towers wins.

## Research synthesis

The design deliberately combines a few proven ideas without inheriting their clutter:

- [Marvel Snap's official rules](https://marvelsnap.helpshift.com/hc/en/3-marvel-snap/faq/90-how-do-i-win-a-match/?p=all%2F1000) demonstrate how “win two of three” creates focus, sacrifice, and comeback decisions without requiring total board control.
- [Pokémon UNITE's official arena guide](https://www.pokemonunite.jp/en/howtoplay/arena/) makes lane allocation a visible pre-match strategy. Its [Theia Sky Ruins guide](https://www.pokemon.com/us/strategy/pokemon-unite-theia-sky-ruins-overview) also shows the value of a captured objective that marches on a scoring structure.
- [Warcraft Rumble's official overview](https://warcraftrumble.blizzard.com/en-us/) validates auto-marching units, structure pressure, role counters, and captured forward momentum as a compact action-strategy loop.
- GRIDLANE independently validates the exact clarity of “three lanes, destroy two towers,” but Hollow Warfront differentiates itself through persistent authored pets, simultaneous hidden command windows, tower-break redeployment, role/element matchups, and the Warden summon.
- Teamfight Tactics' published combat standards prioritize fights that are satisfying, understandable, and appreciable; its Augment retrospectives favor choices that transform positioning or play instead of merely adding stats.
- Hearthstone Battlegrounds validates signature companions, bounded match modifiers, and player-controlled combat pacing. Mechabellum validates readable formations and behavior-changing upgrades without live click pressure.

The product lesson is consistent: the strategic layer should live in allocation and timing, not in pathfinding errands.

## Match structure

### Teams

- 4 pets per side.
- Opening deployment must be `2–1–1`; no lane may begin empty.
- North, Center, and South are three separate navigation graphs. A pet never walks between them.
- A lane change is an off-field seal transfer: dissolve, brief travel beat, rematerialize at the allied tower.

### Victory

- Each team owns one Ward Tower per lane.
- Destroying a tower permanently resolves that lane.
- First team to destroy two enemy towers wins immediately.
- A resolved lane cannot be attacked, defended, or revisited.

### Command windows

- Scheduled at `2:00`, `4:00`, `6:00`, and `8:00` while the match remains active.
- The simulation pauses; presentation continues with ambient motion until the command is confirmed. A future synchronous ranked queue can apply a 12-second decision clock without changing simulation rules.
- A player may move exactly one living or respawning pet from one active lane to another active lane, or hold position.
- Choices are committed before the opponent's response is revealed. AI and offline defenses choose from sealed information plus deterministic battle state; they do not read the player's uncommitted choice.
- Shattered Wards reactions carry a distinct `omen` reason, so UI copy, event history, and server replay never mislabel them as scheduled two-minute commands.
- The window also permits one Warden summon if the team has enough Favor.

### Breakthrough windows

- A tower break immediately pauses the match after the destruction snapshot.
- Every pet assigned to the resolved lane becomes available for redeployment.
- The owner chooses a surviving lane for each freed pet. The defending side receives the same right; losing a tower does not delete its pets.
- If the second tower falls, victory supersedes redeployment.

### Time pressure

- At `8:00`, Riftfall begins: all tower armor is removed and pet structure damage increases by 30%.
- At `10:00`, the side with more towers destroyed wins. If tied, the side that dealt more total tower damage wins. An exact tie is a draw.
- The score shown in the HUD and the timeout verdict must use the same function.

### Hollow Omens

One shared Omen is deterministically derived from the sealed match seed and revealed to both players before deployment. It changes a strategic rule, never hidden odds:

- **Thin Veil:** Wardens cost 80 Favor and remain for 28 seconds.
- **Storm Gate:** scheduled command windows arrive every 90 seconds.
- **Blood Moon:** takedowns while defending a fractured allied lane tower grant 12 bonus Favor.
- **Shattered Wards:** the first tower fracture opens one immediate reaction command.

Only one Omen is active. Both sides receive the same rule and its effect remains visible in the deployment panel and match HUD.

## Lane combat

### Movement and targeting

- Pets advance only on the X axis inside their assigned causeway, with shallow Z offsets for body separation.
- Enemy pets are always fought before the tower unless an explicit ability creates a short siege opening.
- A defeated pet respawns at its own tower in the same lane. Respawn time grows from 8 seconds to 14 seconds across the match.
- Tower range, target line, impact, and current target are visibly telegraphed.

### Tower contract

- 5,000 base HP.
- 18% innate damage reduction before Riftfall.
- Fires a high-readability ward bolt at the closest enemy pet in range.
- Damage ramps against the same target to stop a single defender from tanking forever.
- At 50% HP, the tower enters Fractured state: its crystal changes animation and the lane audio gains a warning layer.
- Tower destruction gets a 2.5-second presentation beat: hit stop, crystal fracture, team-color shockwave, scoreboard stamp, then the Breakthrough window.

### Role readability

- Defender: holds a bad lane, absorbs tower shots, peels for a partner.
- Tracker: ranged pressure and reliable tower chip after a kill.
- Assassin: wins exposed duels and punishes a solo lane, but struggles into a defender/tower pair.
- Sage: sustains a two-pet lane and accelerates Warden Favor through assists.
- Element advantage remains 15%/−15%; UI previews favorable, neutral, and dangerous lane matchups before deployment.

## Warden Favor and summon

The Gate Warden is retained as the mode's signature spectacle, but removed from the map as a neutral camp.

### Earning Favor

- 12 Favor for a pet takedown.
- 5 Favor for an assist.
- 1 Favor per 125 tower damage dealt.
- 6 bonus Favor for a takedown while defending a tower below 50% HP.
- 20 Favor for defeating an enemy summoned Warden.
- 1 passive Favor every 6 seconds so a low-kill match can still reach its signature summon.
- Favor is capped at 100 and is never purchased.

### Summoning

- Costs 100 Favor; Warden's Pact costs 85.
- Chosen only during a scheduled or Breakthrough command window.
- The Warden materializes at the allied tower on one active lane and remains for 38 seconds or until defeated.
- The summoner seals one visible Aspect: **Breaker** specializes in tower pressure, **Sentinel** protects the allied tower without overextending, and **Harrier** hunts enemy pets while dealing reduced structure damage.
- Each Aspect has a distinct HUD mark, color treatment, targeting behavior, combat multiplier, and summon announcement.
- Warden's Pact extends duration to 46 seconds and grants 15% structure damage.
- A team may earn multiple summons, but can have only one active Warden.
- If its lane resolves, the surviving Warden transfers with the owner's breakthrough redeployment and keeps its remaining duration.

### Anti-snowball rule

Favor is generated by both attacking and clutch defense. A team behind one tower gains `+25%` Favor from takedowns and assists until the tower score is even. The bonus creates another decision; it does not directly buff pet stats or erase earned tower damage.

## Preserved pre-match identity

Serialized stance IDs remain compatible, but their field behavior is rebuilt for sealed lanes:

- `balanced` — **Triune Formation**: neutral role logic; prefers repairing the weakest matchup.
- `siege` — **Siege Line**: +10% structure damage, −5% pet damage.
- `jungle` — **Oathseekers**: +20% Favor generation; the legacy ID is retained only for save/challenge compatibility.
- `headhunt` — **Blood Hunt**: +8% pet damage, −10% structure damage.
- `turtle` — **Last Bastion**: +12% tower-side defense, −8% movement speed.

Doctrines remain the squad's second axis:

- Vanguard: +8% attack.
- Bulwark: +12% HP.
- Zealot: +10% speed.
- Warden's Pact: cheaper, longer, harder-hitting Warden summons.

The retired coin shop and 90-second War Council are removed from the player-facing loop. The new two-minute Lane Command replaces both systems.

## Presentation system

### Battlefield

- Strict three-lane silhouette at every camera distance.
- Dark Hollow void between lanes provides unmistakable negative space.
- Blue and crimson light identify tower ownership; lane status is also communicated with icons, labels, and patterns for color-blind accessibility.
- The generated arena plate is visual-only. Code-authored lane bounds remain the collision source of truth.

### Camera

- Default command view frames all three lanes with towers always readable.
- Major moments cut to the relevant lane: first contact, Warden summon, tower Fractured, tower break, victory.
- Player may select a lane for a closer tactical camera; command windows always return to the full board.
- The Battle Director accelerates empty travel to 1.65×, returns engagements to 1×, and briefly emphasizes tower fractures, tower breaks, Warden summons, and Warden slams at 0.72×. Reduced-motion mode keeps a constant rate.
- A lane focus never removes the persistent three-lane overview or tower-pressure ribbons.

### HUD hierarchy

1. Top center: tower score, match timer, first-to-two rule.
2. Three lane ribbons: tower HP, assigned pets, local advantage, active Warden.
3. Bottom center: Favor meter and next command window.
4. Combat feed is limited to kills, Warden events, tower phases, and redeployments.
5. Every important event names the responsible pet or Warden; team-only attribution is prohibited.

### Command story and recap

- Both hidden choices are revealed simultaneously after lock with pet paths, Warden Aspect, and destination lane.
- Each command opens an authoritative observed-impact segment. At the next command, tower break, or verdict, the engine records tower damage dealt, tower damage endured, towers broken, and towers lost.
- The result screen identifies the decisive tower break and most influential command without presenting speculative live win odds.
- A bounded ten-second presentation buffer powers an immediate **Replay final break** highlight; the full deterministic replay remains a separate option.

### Audio and VFX deliverables

- Separate tower idle, targeted, hit, fractured, and destruction cues.
- Seal-transfer dissolve/rematerialize cue.
- Command-window stinger and hidden-choice lock sound.
- Favor ready pulse; Warden portal, footsteps, cleave, slam windup, slam impact, dismissal.
- Lane-specific ambient stems are mixed, not unique gameplay sounds, so audio remains readable.

## Accessibility and performance

- Every lane and tower state has text/icon semantics in addition to team color.
- Reduced-motion mode disables camera cuts, hit stop, shake, and large parallax while retaining timing cues.
- Full keyboard/controller path for lane selection and pet reassignment.
- 44px minimum touch targets; mobile command UI uses bottom sheets rather than hover affordances.
- Gameplay remains 30 Hz deterministic. Presentation targets desktop 60 fps/mobile 30 fps and sheds particles, shadows, then secondary Warden rig detail before dropping combat actors.

## Authority and replay contract

- Opening lane assignment, stance, doctrine, teams, seed, and AI plan are sealed at kickoff.
- Warfront invitations are server-enforced 4v4 reciprocal exhibitions: each participant commands their own Azure roster against the opponent's sealed Crimson defense. Retired 2v2 invitations and failed acceptances cannot launch a local ghost match.
- Each command window records a compact input entry: window tick, reason, pet moves, and optional Warden lane plus Aspect.
- The client reports inputs, never outcome authority.
- Settlement replays the exact deterministic match from sealed inputs plus the validated command log and uses the server-derived winner.
- Settlement time is gated by the replay the player actually commanded; the sealed automatic baseline is only a fallback for a missing or invalid plan. A legitimate early response returns a retry interval that the client automatically honors.
- Invalid, duplicate, early, or impossible moves are rejected or reduced to Hold; no command may move more than the allowed pets or target a resolved lane.
- Worker, client sim, generated server sim, and parity fixture must remain byte-identical.

## Initial balance targets

- Median match: 6:30–8:00.
- 90th percentile match: under 9:30.
- First tower: 2:30–4:30.
- At least 65% of matches reach one scheduled redeploy.
- At least 55% of matches contain a Warden summon so the signature system is regularly visible.
- First-tower winner match win rate: target 65–72%, never above 78%.
- Opening paired-lane choice: no lane/role pairing above 55% win rate over mirrored seeds.
- Timeout rate: below 5%.
- At least three consequential player decisions in the median completed match; otherwise test 90-second scheduled windows globally.
- No presentation lull longer than eight seconds at 1× equivalent without a pressure, Favor, command-warning, or combat-state change.

## Production asset manifest

- `warfront-three-lane-ground.webp`: final top-down arena plate.
- `warfront-three-lane-ground-portrait.webp`: dedicated 9:16 mobile arena plate with the same normalized landmarks.
- `warfront-three-lane-keyart.webp`: final 4v4 + Warden lobby art.
- Code-authored Ward Tower model and fractured/destruction states.
- Code-authored lane seals, Favor crest, command icons, tower pips, and accessibility patterns.
- Existing rigged Gate Warden GLB retained and repurposed as the summon.
- Existing pet GLBs and role/element VFX retained.
