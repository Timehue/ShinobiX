# Pet Coliseum reference study — 2026-07-18

## Scope

Presentation study of two local quality references. The goal is to adopt reusable staging principles without copying characters, shots, assets, or game rules. Combat simulation, damage, cooldowns, winner determination, and elemental identity remain unchanged.

## Source inspection

| Source | Video | Audio | Duration | Size |
| --- | --- | --- | ---: | ---: |
| `Desktop 2026.07.18 - 07.32.14.03.mp4` | H.264 High, 2560×1440, 60 fps, BT.709, ~28.78 Mbps | AAC-LC stereo, 48 kHz, ~192 kbps | 172.45 s | 624,697,941 B |
| `Desktop 2026.07.18 - 07.30.10.02.mp4` | H.264 High, 2560×1440, 60 fps, BT.709, ~28.46 Mbps | AAC-LC stereo, 48 kHz, ~192 kbps | 59.97 s | 214,797,498 B |

The captured audio is effectively inaudible for transcription: mean volume is about -65 dBFS and the loudest sample is about -50 dBFS in both files. Offline speech recognition found no reliable dialogue. Sound-to-action observations below are therefore low confidence; the video supports visual timing much more strongly than mix analysis.

On-screen text is capture/browser/video-player chrome rather than useful combat explanation. There is no dependable instructional overlay or battle UI transcript to preserve.

## Extracted review material

Generated under `C:\Users\Tyler R\AppData\Local\Temp\codex-pet-reference-analysis`:

- `video1-overview-timestamped.jpg`: 5-second overview.
- `video2-overview-timestamped.jpg`: 3-second overview.
- `video1-action-*.jpg` and `video2-action-*.jpg`: one frame per second through action-heavy sections.
- `v1-transition-*.jpg` and `v2-transition-*.jpg`: frames at -0.25 s, transition, and +0.25 s.
- `v1-impact-112_999-10fps.jpg`, `v2-dodge-032_983-10fps.jpg`, `v2-clash-039_716-10fps.jpg`, `v2-strike-047_500-10fps.jpg`, and `v2-impact-052_550-10fps.jpg`: 10 fps timing studies.

## Timestamped breakdown

### Reference 1 — staged animated battle

| Time | Beat | Presentation lesson |
| ---: | --- | --- |
| 00:00–00:19 | Fast chase and arena traversal | Travel has a clear leader and destination; the defender does not mirror the attacker at a fixed radius. |
| 00:19–00:25 | Reaction and spacing reset | A quiet reaction pose makes the next action legible. |
| 00:25–00:40 | Charge and vertical traversal | Anticipation changes pose, framing, and environment before release. |
| 00:40–00:44 | Audience/reaction cut | A cut creates punctuation without adding a mechanic. |
| 00:44–00:58 | Injured recovery and self-charge | Damage persists in posture; recovery is not instant idle. |
| 00:58–01:13 | Burst, opponent reaction, leap, aerial rotation, landing | One exchange contains distinct launch, travel, evade/contact, and recovery silhouettes. |
| 01:16–01:35 | Psychic lock-on and positional setup | Long anticipation remains interesting because the camera and lighting progressively tighten. |
| 01:36–01:55 | Cue, lightning path, arena darkening, orb contact | VFX grows from the actor, carries direction, then changes the whole composition at impact. |
| 01:55–02:26 | Reaction and darkened spacing | Dissipation and reaction are allowed to breathe. |
| 02:26–02:52 | Final command, orb build, beam collision, resolution | The final collision holds longer than ordinary hits and resolves through light, silhouette, and aftermath. |

Major transition centers: 18.983, 25.366, 44.883, 72.533, 84.750, 103.433, 112.999, 120.499, 129.699, 146.666, 164.999, and 171.632 seconds.

### Reference 2 — 3D action battle

| Time | Beat | Presentation lesson |
| ---: | --- | --- |
| 00:00–00:05 | Low three-quarter 3D establishing action | A lower camera makes models feel like combatants rather than board pieces. |
| 00:05–00:24 | Spectator/stylized transition material | Major beats can temporarily simplify or replace the background. |
| 00:24–00:30 | Transformation/power buildup | Buildup starts tight to the body, expands, and changes local light. |
| 00:30–00:37 | Fast approach, low dodge, landing dust | Range changes decisively. A dodge is a readable path with a landing, not a lateral position correction. |
| 00:38–00:40 | Cue and standoff | Brief stillness prepares the close exchange. |
| 00:40–00:52 | Close elemental exchange | Each strike follows anticipation → commitment → contact → reaction/recovery; camera cuts sell force. |
| 00:52–00:54 | White-core collision and shockwave | The brightest frame is brief; debris and silhouettes carry the dissipation. |
| 00:54–00:55 | Recovery stance | The actor regains a deliberate guard pose before the scene ends. |

Major transition centers: 5.300, 15.116, 23.715, 24.366, 29.800, 32.983, 39.716, 47.500, 52.550, and 54.900 seconds.

## Timing findings

- A fast 3D dodge reads across roughly 0.5–0.7 s: low exit, crossing/avoidance, landing accent, then a recovered stance.
- A normal close strike uses roughly 0.4–0.6 s of commitment, a contact frame around 0.1 s, and 0.3–0.5 s of reaction/recovery before the next chain.
- A major impact holds its luminous core or collision for roughly 0.4–0.6 s, reaches a white frame briefly, then exposes shockwave/debris for at least another 0.5 s.
- Major attacks use much longer anticipation than ordinary attacks. The contrast—not uniformly slow playback—is what makes them feel important.
- The quiet audio capture suggests visual contact and the strongest audible accents are broadly close, but it is too quiet to certify sample-accurate sound sync.

## Presentation analysis

### Camera and composition

The references do not film the whole arena continuously. Their neutral shot establishes geography, then action shots lower the eye line, move laterally, tighten on one actor, or cut to the defender at contact. The current project keeps a high, centered three-quarter view for most of the fight. Its live midpoint tracking is technically smooth, but the nearly unchanged height and axis make every exchange look like coverage of the same event.

### Combat pacing and movement

The references alternate stillness and decisive travel. Only one fighter owns the commitment lane at a time. The current presentation director already authors independent arena marks and prevents literal fixed-distance following, but long neutral traversals and frequent re-aiming can still read as two actors wandering between events. The authored exchange needs a stronger end condition: plant, attack/dodge, recoil, guarded reset.

### Animation and reactions

The current roster rigs have suitable idle, walk, gallop, jump/dodge, attack, hit-reaction, and death clips. The renderer also keeps the attack clip alive across windup, strike, and recovery. The weakness is synchronization and silhouette: camera coverage stays wide while short attack and reaction states pass, so their strongest poses are visually small. Dodges need a longer authored landing/recovery window; hit reactions need a slightly longer settle before neutral locomotion resumes.

### VFX

The current implementation has solid technical layers—elemental projectile bodies, contact core, particles, shock rings, power-up columns, and large set pieces—but ordinary impacts spawn many similarly sized translucent pieces around a point. From the wide camera, these collapse into a generic cluster of spikes. The references use a hierarchy: actor-local tell, directional carrier, small white contact core, element-colored body, and trailing debris/dissipation. Fewer, larger directional shapes will read more professionally than more radial pieces.

### UI and transitions

The references keep battle information at the edge and let the action own the center. The current full-screen portrait cut-in and repeated centered move banners often cover the exact movement/VFX they are meant to celebrate. Named moves should use a compact edge cue; the arena, camera, pose, and element effect should be the hero presentation.

### Lighting

The warm Coliseum is a strong identity, but the static warm wash competes with every element. Reference attacks temporarily tint local light and reduce background prominence. The project can do this through restrained actor/impact lights and a short screen-space exposure flash without adding heavy post-processing.

## Adaptation boundaries

Reasonable to adapt:

- Low three-quarter action framing and short lateral camera moves.
- One-attacker exchange ownership and purposeful range resets.
- Distinct anticipation, contact, hit-stop, recoil, and recovery durations.
- Elemental buildup → carrier → impact → dissipation hierarchy.
- Landing dust, short afterimages, reaction holds, and restrained environment tint.
- Rarity/performance-scaled spectacle and mobile particle caps.

Do not copy:

- Characters, silhouettes, named attacks, animation poses, exact shot sequences, arena art, UI, or transformation mechanics.
- Turn rules, targeting logic, damage rules, or outcome scripting from the references.
- Long broadcast/anime cutaways that remove player visibility for several seconds.

## Current implementation comparison

| Area | Current project | Highest-value correction |
| --- | --- | --- |
| Camera | Smooth midpoint/dolly camera, usually high and centered | Add explicit establish, tell, commit, impact, and recovery shot states; lower the action eye line and introduce restrained lateral parallax. |
| Spacing | Independent fixed marks; no literal follower steering | Hold the non-acting fighter, give dodges a landing mark, and hold both fighters briefly after recoil before the next neutral route. |
| Animation | Authored clips and family-safe crossfades | Lengthen readable dodge landing and hit-recovery windows; time action shots around their strongest poses. |
| Impact | Hit-stop, shake, flash, radial meshes, particles | Reduce generic radial geometry; add directional slash/core/debris layering and a longer dissipation tail on heavy hits. |
| Major moves | Portrait cut-in plus delayed arena set piece | Replace the blocking portrait overlay with a short in-arena focus/lighting beat so the elemental payoff remains visible. |
| UI | Frequent centered callouts and commentary | Move named-move cues to a compact upper-edge treatment and suppress collisions with core action. |
| Mobile | Existing quality tiers and hard caps | Keep geometry counts bounded, reduce layers/particles on low quality, and avoid mandatory bloom/post-processing. |

## Implementation plan (written before fight-code changes)

1. **Shot grammar:** extend the render-only duel director with five camera intents—establish, tell, commit, impact, recovery. Use eased position/aim changes rather than hard cuts, a lower action height, and modest side parallax. Keep the intro and KO wide enough for mobile framing.
2. **Exchange cadence:** extend dodge and hit-reaction settle windows in the render-only stage director, plant the observer through an opponent's commitment, and delay the next neutral route until recovery completes. Do not change simulation events or outcomes.
3. **Readable VFX hierarchy:** simplify ordinary contact bursts into a bright core plus fewer directional element pieces; add a short debris/dissipation tail. Keep arena-scale set pieces for ultimates or explicitly named large moves.
4. **Unblocked action:** replace the large portrait cut-in with an in-arena signature focus and compact move cue. Keep the action visible and reclaim bundle budget for camera/VFX improvements.
5. **Verification:** run focused director/camera/VFX/model tests, TypeScript, lint, production build and bundle-size certification. Visually inspect deterministic desktop and mobile replays, including colored roster models, dodge, melee hit, ranged cast, buff, ultimate, KO, replay, and renderer remount.

Success means a replay reads as a sequence of intentional elemental exchanges at normal speed, not two models being continuously tracked around a board. It must remain deterministic, preserve canonical mechanics, stay within the production bundle budget, and remain readable on a narrow mobile viewport.

## Implemented in this pass

- Added explicit post-contact recovery to the presentation track and lengthened recoil/dodge phrases so launch, contact, landing, and guard-reset poses remain visible.
- Added restrained action-camera intents for tells, impacts, and signatures: lower height, lateral parallax, short aim holds, adaptive dolly, and a delayed result overlay so the KO aftermath is not immediately covered.
- Replaced the blocking portrait cut-in with an in-arena signature focus and compact upper-edge move cue.
- Removed the generic cone crown from ordinary impacts, arranged element bodies along the attack heading, and replaced the abyss radial flame set piece with a dark floor seal, directional claw trails, restrained fragments, and dissipation motes.
- Matched the model dodge hop to the longer authored dodge state and added a landing accent at the destination.
- Added portrait-specific framing that reduces cinematic side/zoom bias and raises/pulls the camera back enough to retain both fighters without enabling expensive mobile-only rendering.

## Verification record

- 46 focused deterministic duel, stage-director, VFX, projectile, GLB-atlas, and roster-atlas tests passed.
- TypeScript build and full ESLint run passed.
- Production Vite build passed with CI-equivalent build arguments.
- Bundle gate passed: 5.82 MB budgeted product JS/CSS; 1.32 MB / 341.3 KB gzip initial graph.
- Deterministic desktop review covered buff, dodge/miss, normal abyss hit, signature, KO, recovery, compact UI, model color, and result-overlay timing.
- A 390×844 Chromium review completed with both fighters retained in frame and no page errors. Low/medium quality continues to cap effect geometry and particles.
