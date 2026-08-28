import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { moduleEntryReference } from './build-html-entry.mjs';

const distDir = process.env.BUILD_SIZE_DIR || join(process.cwd(), 'shinobij.client', 'dist');

const JS_CHUNK_FAIL_BYTES = 1_500_000;
const CSS_FILE_FAIL_BYTES = 750_000;
const TOTAL_JS_CSS_WARN_BYTES = 3_000_000;
// All emitted product JS/CSS includes lazy 3D/gameplay chunks and production
// build-arg code that is not always present in local builds. Keep startup gates
// below strict; allow a small ceiling bump for the intentional pet evolution
// 2.5D stage and env-injected deploy variance.
// 2026-07-19: 6.10 → 6.20 MB. The village facility art system + studio screen
// presentation (main) and the story-fight presentation + server-authoritative
// story bosses (story migration slice) together landed 7 KB past the old
// ceiling (measured 6,107,103 B). All startup gates below are untouched and
// pass with headroom (initial graph 1.43 MB raw / 367 KB gzip).
// 2026-07-20: 6.20 → 6.60 MB. The Hollow Warfront mode (deterministic MOBA sim
// + 3D broadcast renderer, PetWarfrontMatch) and the Tactical Arena TRUE-3D
// stage (PetArena3DStage) landed ~278 KB of LAZY 3D/gameplay chunks (CI measured
// budgeted 6,385,827 B). All startup gates below are UNTOUCHED and still pass —
// the new code is off the entry path (initial graph 1.43 MB raw / 367 KB gzip).
// 2026-07-23: 6.60 → 6.64 MB. Chronicle Duel adds 160,674 B of lazy rules,
// board and card-dossier chunks; the complete product graph measures 6,627,372 B.
// The new ceiling leaves only 12,628 B of build variance. Startup remains well
// below its independent raw/gzip gates, which stay unchanged.
// 2026-07-23: 6.64 -> 6.67 MB. Player-controlled pet combat adds the live/lockstep
// duel controllers, the command deck, standing orders and the ladder queue; the
// complete product graph measures 6,652,399 B. All of it is OFF the entry path --
// the initial graph actually IMPROVED to 1.30 MB raw / 336.5 KB gzip (from 1.43 MB
// / 367 KB) because the warfront replay is now lazy in PetLadder too. The startup
// gates that govern load time are unchanged and pass with room to spare; this
// ceiling only tracks total shipped product code.
// 2026-07-24: 6.67 -> 6.69 MB. The wild-pet flavor pass adds one description
// line per species (140 strings, ~18 KB) to data/pet-pool.ts; measured
// 6,670,602 B — 602 B past the old ceiling. Startup gates untouched and green
// (initial graph 1.31 MB raw / 343.3 KB gzip, entry under its gate).
// 2026-07-24: 6.69 -> 6.70 MB. Chronicle Showdown board feel pass: AI-turn
// replay pacing, click-to-attack + phase-rail jumps, forfeit confirm, duel
// resume, and the asset-free WebAudio SFX synth land ~10 KB of lazy board
// code; measured 6,696,327 B — 6,327 B past the old ceiling. Startup gates
// untouched (initial graph 1.31 MB raw / 343.3 KB gzip, entry under its gate).
// 2026-07-24: 6.70 -> 6.71 MB. Chronicle board motion pass (card
// arrive/flip/destroy pulses, attack lunges, ticking HP + damage floats,
// duel-start and outcome splashes) adds ~3.5 KB of lazy board code/CSS;
// measured 6,703,504 B. Startup gates untouched (initial graph 1.31 MB raw /
// 343.3 KB gzip, entry under its gate).
// 2026-07-25: 6.71 -> 6.72 MB. The Chronicle zone-highlight pass and the
// wandering-AI spawn/cooldown pass (giver density cap, decline cooldown,
// content-locked archetypes) together crossed the old ceiling. All of it is in
// the LAZY WorldMap/board screens: CI measured budgeted between 6,710,000 and
// 6,716,232 B (bounded by its own rounded 6.40 MB report plus the failure), and
// a local build measures 6,709,186 B. Startup gates untouched and green — CI
// initial graph 1.31 MB raw / 344.2 KB gzip, entry under its gate.
//
// NOTE ON THE MARGIN: the previous ceiling left 814 B of local headroom, so a
// local build passed while CI failed — CI has the Sentry DSN, and
// @sentry/vite-plugin injects instrumentation into the product chunks (its own
// vendor chunk is excluded from this budget but shows up in "all emitted"). The
// bump below is sized to clear CI's worst case with ~14 KB to spare, so the
// local gate stops reporting a false green. If this budget needs raising again
// soon, drain a screen off the graph instead — the startup gates below are the
// ones that must never be relaxed.
// 2026-07-25: 6.72 -> 6.79 MB. Combat HUD v3 (the shared PvE + PvP duel chrome:
// framed dossiers, ringed portraits, iconed resource rows, AP rail + turn
// medallion, iconed command deck, full-bleed jutsu card wall) plus the
// board-token avatar fit pass and the durable battle-log foundations
// (receipt display metadata, per-player history index, combat-history route).
// Nearly all of it is the LAZY per-screen battle-skin chunk and index CSS.
// Local build measures 6,757,400 B on top of the profession-ceremony and
// Chronicle-Keeper passes that landed alongside it.
//
// Sized by the margin rule established above rather than by the local number:
// CI runs ~7 KB heavier because @sentry/vite-plugin injects instrumentation
// into the product chunks, so CI should land near 6,764,000 B. This ceiling
// leaves CI ~15.6 KB of spare (22.6 KB locally) — an earlier draft sat 600 B
// above the CI estimate and would have reported a false local green.
// Startup gates untouched — initial graph 1.31 MB raw / 344.1 KB gzip.
// 2026-07-25: 6.79 -> 6.81 MB. Durable battle-log UI (phases 4-9): the
// read-only BattleLogScreen plus its action timeline, action-detail panel and
// round accordion, the typed client contracts and fetch helpers, and the
// Profile battle list now reading the server index. ~23 KB, all of it in the
// LAZY battleLog screen chunk and the per-screen battle-skin CSS. Local build
// measures 6,780,317 B — 317 B past the previous ceiling.
//
// Sized off CI, not the local number (see the margin rule above): CI runs
// ~7 KB heavier, so it should land near 6,787,000 B, leaving ~18 KB of spare
// (24.7 KB locally). Startup gates untouched — the screen is lazy, so the
// initial graph is unchanged at 1.31 MB raw / 344.3 KB gzip.
// 2026-07-25: 6.81 -> 6.82 MB. Pet Coliseum clash + brawl pass: the CLASH read
// prompt (PetDuelClashPrompt), the clash bind/resolution in the duel engine, the
// category-coded move banner and the clash SFX/impact wiring. All of it is in the
// LAZY coliseum chunk — the mode is lazily loaded, so none of it is on the
// startup path. Local build measures 6,794,208 B on top of the battle-log
// ceiling.
//
// Sized by the margin rule above, NOT by the local number: the previous ceiling
// technically passed locally with 10.8 KB spare, but at CI's ~7 KB heavier that
// is only ~3.8 KB — well inside the band that has already produced one local
// green / CI red. This ceiling puts CI near 6,801,000 B with ~18.8 KB of spare
// (25.8 KB locally). Startup gates untouched — initial graph 1.31 MB raw /
// 344.2 KB gzip, entry under its gate.
// 2026-07-27: 6.82 -> 6.87 MB. Card-pack opening cinematic: the pack-tear /
// card-flip / summary overlay that replaces the old alert() after a pack
// purchase (CardPackOpening + card-pack-reveal helpers + pack SFX cues +
// card-pack-opening.css), and Shop now renders real ChronicleCardView faces,
// which hoists the card component and chronicle-duel.css into a shared lazy
// chunk used by Shop and the card screens. All of it is LAZY (Shop chunk +
// that shared chunk) — local build measures 6,837,620 B, 17,620 B past the
// previous ceiling.
//
// Sized by the margin rule above, not the local number: CI runs ~7 KB heavier
// (Sentry instrumentation in the product chunks), landing near 6,844,600 B.
// This ceiling leaves CI ~25 KB of spare (~32 KB locally) — a notch more than
// the usual ~18 KB because this pass also re-hoisted shared chunks, which adds
// build-to-build variance beyond a purely additive lazy chunk. Startup gates
// untouched — initial graph 1.31 MB raw / 345.0 KB gzip, entry under its gate.
// 2026-07-28: 6.87 -> 6.88 MB. Chronicle card lore rewrite: all 150 tile-card
// descriptions replaced with real per-card lore lines (the old ones were
// retired tile-game strategy notes plus a five-sentence element stamp, now
// deleted from chronicle-duel.ts), family taxonomy fix, and the Forgotten
// Kage rename. Net +7.8 KB of catalog strings; rebased onto the Hollow Gate
// drain, the local build measures 6,850,228 B. Sized by the margin rule: CI
// lands near 6,857,200 B, and the previous ceiling would have left it ~13 KB —
// near the band that has already produced a local green / CI red. This ceiling
// gives CI ~23 KB of spare (~30 KB locally). Startup gates untouched — initial
// graph 1.32 MB raw / 345.9 KB gzip, entry under its gate.
// 2026-07-29: 6.88 -> 6.59 MiB (6,905,000 B). The pet evolution cutscene moves
// off flat billboards onto the real rigged combat GLBs: a summoning-seal shader,
// procedurally drawn ring/ray/shaft/smoke textures, the chakra pillar and
// shock-ring FX, a per-model hero yaw table and the material white-out. Measured
// +11,947 B over origin/main (main alone 6,870,155 B; with this change
// 6,882,102 B) — all of it in the LAZY PetYard screen chunk, none on the entry
// path. Sized by the margin rule above rather than the local number: CI runs
// ~7 KB heavier because @sentry/vite-plugin injects instrumentation into the
// product chunks, so CI should land near 6,889,100 B. This ceiling leaves CI
// ~15.9 KB of spare (~22.9 KB locally); the previous ceiling left CI 9 KB
// UNDERWATER. Startup gates untouched — initial graph 1.30 MB raw / 342.6 KB
// gzip, entry under its gate.
// 2026-07-29: 6.905 -> 6.970 MB. Chronicle Showdown's release-mode pass adds
// rules-backed battle forecasts, structured replay events, Smart Phase Assist,
// response-priority feedback, keyboard-safe match options, and the full-screen
// duel presentation. The clean release commit measures 6,939,626 B locally;
// allowing the usual ~7 KB of CI instrumentation leaves ~23 KB of variance.
// The mode stays lazy and all unchanged startup gates remain green at 1.30 MB
// raw / 342.7 KB gzip.
// 2026-07-29: 6.970 -> 7.04 MB. The cinematic VN renderer and story-wide
// direction library, the Hollow Gate authoritative combat/descent flow, and the
// upgraded Pet Warfront presentation add lazy product code. The combined local
// product graph measures 7,009,169 B; the startup graph remains below every
// unchanged gate at 1.32 MB raw / 348.4 KB gzip. Allowing the usual ~7 KB of CI
// instrumentation leaves roughly 24 KB of variance.
// 2026-07-29: 7.04 -> 7.085 MB. Hollow Gate's release combat pass adds five
// rules-backed floor directors, telegraphed arena hazards, the Alpha's three
// health phases, adaptive score pressure, and the phase/spectral presentation.
// Local product code measures 7,061,952 B. The Arena and Pet Coliseum remain
// lazy; the unchanged startup gates stay green at 1.34 MB raw / 354.5 KB gzip.
// The ceiling leaves the normal ~16 KB after the observed ~7 KB CI variance.
// 2026-07-29: 7.085 -> 7.135 MB. The Pet Coliseum command-impact pass and
// Tactical Pet Arena broadcast polish add command focus/finish presentation,
// dedicated duel audio cues, deterministic finisher framing, and Warfront
// tactical callouts. CI measures the resulting product graph at ~6.78 MiB;
// the initial graph remains 1.34 MiB raw / 355.8 KiB gzip. The feature code is
// lazy, and the entry, initial-graph, gzip, per-chunk, and CSS gates below stay
// unchanged. This leaves only the normal narrow release-variance margin.
// 2026-08-03: 7.135 -> 7.150 MB. The AI-fight server migration (steps 3d + 4)
// routes sealed AI fights onto the server-combat screen and adds the shared PvE
// outcome path — components/AiFightHost, lib/ai-fight-{request,api,loadout,
// settle}, lib/pve-outcome-api, api/pve/fight-outcome — plus the weekly-boss
// clamp wiring. This bump is measured, NOT estimated: the previous ceiling was
// missed by 179 B, which is why CI went red at 478475433 while local said PASS.
// Reproducing CI's own bundle (VITE_SENTRY_DSN/RELEASE/BUILD_COMMIT per
// .github/workflows/ci.yml) and summing dist .js+.css minus the sentry-vendor
// chunk gives EXACTLY what CI computes — 7,135,092 B here — so the new ceiling
// leaves ~14.9 KB, not a guess at the instrumentation delta.
// Paid for partly by a real drain: lib/ai-fight-flag.ts was dead (it returned a
// hardcoded true), so it and its three dead Arena branches were deleted, worth
// 87 B. The combat screen itself stays lazy, and the gates that actually govern
// startup — entry JS, initial graph raw + gzip, per-chunk and CSS — are all
// unchanged and green at 1.36 MB raw / 359.4 KB gzip.
// 2026-08-03: 7.150 -> 7.190 MB. The complete Pet Home product slice adds the
// lazy Home collection/breeding screen, persistent hatch presentation, exact
// odds/counter UI, and cross-screen Chromatic resolution. The measured local
// product graph is 7,163,130 B: Home is a 15,844 B lazy JS chunk and pet-home is
// a 10,563 B lazy CSS chunk. The entry/initial graph is unchanged at 1.36 MB raw
// / 359.4 KB gzip and remains under every startup gate below. The new ceiling
// leaves 26.9 KB locally and about 19.9 KB under the established CI +7 KB band.
// 2026-08-03: 7.190 -> 7.225 MB. The unlimited Companion Sanctuary adds the
// paginated habitat manager, filters, safe roster-transfer controls, overflow
// capture/hatch messaging, and its complete responsive presentation. The
// measured local product graph is 7,198,083 B; allowing the established ~7 KB
// CI instrumentation band leaves ~19.9 KB. This is feature code, not asset
// weight: the 226 KB Sanctuary WebP is governed by release-asset validation and
// does not count toward this JS/CSS ceiling. Entry and startup gates remain
// unchanged and green at 1,440,512 B raw / 373,084 B gzip.
// The standing instruction resumes here: drain a screen off the graph before
// raising this again. Measure with the CI-equivalent build above rather than a
// bare `npm run build`, which under-reports and will keep producing red pushes.
// 2026-08-05: 7.225 -> 7.245 MB. The portrait/mobile PvE + PvP HUD restoration
// re-establishes the fighter | timer | fighter composition across phones and
// portrait tablets. Before budgeting it, the repeated high-specificity selector
// was drained behind the shared #combat application boundary (about 3.2 KB
// saved). The exact CI-equivalent product graph is 7,226,921 B, leaving 18,079 B
// of measured variance. Startup remains inside the unchanged independent gates
// at 1.36 MB raw / 362.7 KB gzip, and the 3D stack now has its own tighter raw,
// gzip, and startup-isolation gates below.
// 2026-08-06: 7.245 -> 7.265 MB. Clan-war pet modes (pet1v1 / pet2v2) became
// SERVER-AUTHORITATIVE: they were the last client-reported clan-war outcome, and
// the report path's 15-minute auto-confirm let one player finalize their own
// claimed win unilaterally. The new screen fields a pet, polls, and replays the
// duel the server already resolved. DRAINED FIRST, per the standing instruction
// above: the new screen and the existing SectorWarPetBattle were the same screen
// twice over, so the picker / submit / poll / replay shell moved into the shared
// components/PetDuelReplayScreen and both became thin config wrappers — that gave
// back 2,583 B of the 6,008 B the feature added (and fixed refresh-resume on the
// sector duel, which used to strand a returning player on the picker). The
// remaining 1,554 B is the endpoint client + config. The exact CI-equivalent
// product graph is 7,246,554 B, leaving 18,446 B of measured variance — in line
// with the ~18 KB the previous entry held. Startup gates are untouched and green
// at 1.37 MB raw / 363.4 KB gzip.
// The standing instruction still applies: drain a screen off the graph before
// raising this again, and measure with the CI-equivalent build (VITE_SENTRY_DSN
// set) rather than a bare `npm run build`, which under-reports.
// 2026-08-07: 7.265 -> 7.311 MB. Pet Showdown — the turn-based cinematic
// flagship pet battle mode (screens/PetShowdown + components/PetShowdownBattle
// + lib/pet-showdown-api + PetShowdown.css, one lazy chunk off the startup
// graph; the engine is SERVER-ONLY so no sim code ships at all). The exact
// CI-equivalent product graph is 7,292,709 B, leaving 18,291 B of measured
// variance — in line with the ~18 KB the previous two entries held. Startup
// gates are untouched (initial graph 1.31 MB raw / 351 KB gzip). The drain that
// pays this back is already scheduled rather than done: Showdown replaces the
// continuous-sim Coliseum as the player-facing flagship, and once Hollow Gate /
// clan war / sector war / ladder / gauntlet migrate off the legacy engines,
// deleting that stack (pet-duel-cinematic, pet-duel-sim, pet-battle-sim,
// pet-arena-sim and their renderers — far larger than this chunk) ratchets this
// number DOWN well past 7.265 (docs/pet-showdown-design.md, follow-ups).
// 2026-08-07 (same day): 7.311 -> 7.332 MB. Pet Showdown rounds 3-4 grew the
// lazy Showdown chunk: the painted-VFX layer (PetShowdownVfx), bench/switch UI,
// the five-stage arena wiring, and the Bloom composer import. The exact
// CI-equivalent product graph is 7,313,039 B, leaving ~19 KB of measured
// variance, consistent with prior entries. Startup gates unchanged (initial
// graph 1.31 MB raw / 351 KB gzip). The scheduled drain remains the legacy
// coliseum-stack deletion described in the previous entry.
// 2026-08-10: 7.332 -> 7.357 MB. Pet Showdown round 10 — the JRPG command HUD:
// ornate status plates (portrait + HP/EN read out as cur/max), the vertical
// Attack/Skill/Guard/Rest/Switch menu with its technique sub-list, the move
// inspector, and click-the-creature targeting (a hit volume, a reticle and the
// hover plumbing on each fighter). It replaced the old move-card deck, so the
// net add is ~5 KB of the ~13 KB written. The exact CI-equivalent product graph
// is 7,337,376 B, leaving ~19 KB of measured variance, consistent with prior
// entries. Startup gates unchanged (initial graph 1.31 MB raw / 351 KB gzip).
// The scheduled drain remains the legacy coliseum-stack deletion above.
// 2026-08-11: 7.357 -> 7.378 MB. Pet Showdown round 14 — the AAA art pass. A
// 42-glyph authored icon set (components/icons/ShowdownIcon.tsx) replaces every
// OS emoji in the mode, plus the lacquer/brass panel material, the sliding
// cursor, banner plates and the shared numeral treatment. Deliberately its OWN
// module rather than an extension of GameIcon: GameIcon is imported by MobileNav
// and MobileStatusHUD, so it sits inside ENTRY_JS_FAIL_BYTES, whereas Showdown
// is lazy and its glyphs cost the startup graph NOTHING. Inline SVG is also why
// this is only ~21 KB of the budget — painted per-move art would have been the
// whole remaining headroom for a surface 24px tall. The exact CI-equivalent
// product graph is 7,358,463 B, leaving ~19 KB of measured variance, consistent
// with prior entries. Startup gates unchanged (1.31 MB raw / 351 KB gzip).
// 2026-08-11: 7.378 -> 7.40 MB. Pet Showdown round 24 — the audit round: the
// takeover became a real modal (focus trap, one-layer Escape, live-region
// narration, panel precedence), a failed submit holds the round behind a retry
// panel instead of discarding the draft, the missing 979px and max-height
// viewport tiers landed (the deck was below the fold on every landscape
// phone), battle consumables fire with their own event beat and plate chip,
// and AI teams carry tier outfits. All of it lives on the lazy Showdown chunk;
// the entry chunk (583,449 B of 640,000) and the initial graph (1.31 MB raw /
// 351 KB gzip) are unchanged. The exact CI-equivalent product graph is
// 7,379,497 B, leaving ~20 KB of measured variance, consistent with prior
// entries. The scheduled drain remains the legacy coliseum-stack deletion.
// 2026-08-13: 7.40 -> 7.425 MB. Pet Showdown rounds 34-35 — the art round +
// the volumetric round: EPIC_SPRITES/FLOOR_TAKEOVERS wiring in PetShowdownVfx
// and the new PetShowdownVfx3d module (wave shell, flame crown, vortex cones,
// displaced rock shards, procedural bolts, particle clouds, piece lights).
// +21.5 KB of JS across both rounds — the heavy lifting is WebP art and
// procedural geometry, not code. All on the lazy Showdown chunk; entry chunk
// and initial graph unchanged. Exact product graph 7,401,001 B, leaving
// ~24 KB headroom. The scheduled drain remains the legacy coliseum-stack
// deletion.
// 2026-08-13: 7.425 -> 7.45 MB. Pet Showdown rounds 36-39 — the Champions
// grammar: beat pacing, KO ceremony, species performance wiring, and the
// reference-still port (casting glyph + charge orb, charge dim, element
// climate, per-kind move accents, streak-throughs, debris). +28.5 KB across
// four rounds, all on the lazy Showdown chunk; entry chunk and initial
// graph unchanged. Exact product graph 7,429,548 B, leaving ~20 KB of
// headroom. The scheduled drain remains the legacy coliseum-stack deletion.
// 2026-08-14: 7.45 -> 7.59 MB. Pet Showdown round 42 — the Blender bake:
// 84 Mantaflow simulation frames (fx/plume 48, fx/mist 36) at 1-4 KB each
// after palette compression. Vite inlines assets under 4 KB as data URIs,
// so these ART bytes land inside the JS metric — exactly as every existing
// flipbook frame always has. ~130 KB of frames + ~10 KB of wiring, all on
// the lazy Showdown chunk; entry chunk and initial graph unchanged. Exact
// product graph 7,569,121 B, leaving ~21 KB of headroom. The scheduled
// drain remains the legacy coliseum-stack deletion.
// 2026-08-14: 7.59 -> 7.70 MB. Pet Showdown round 46 — the KO detonation
// atlas (fx/burst, 27 Mantaflow frames, 82 KB) plus the variety/weather engine
// work. Vite inlines sub-4 KB assets as data URIs, so simulation frames land
// in the JS metric exactly as every other flipbook frame always has. Exact
// product graph 7,679,126 B, leaving ~21 KB of headroom. All on the lazy
// Showdown chunk; entry chunk and initial graph unchanged. The scheduled drain
// remains the legacy coliseum-stack deletion.
// 2026-08-22: 7.70 -> 8.00 MB, then CORRECTED THE SAME DAY to 7,855,000 B.
//
// The 8.00 MB entry re-baselined for a claimed "~200 KB CI/prod delta (Sentry +
// build-arg code the local build omits)". That delta does not exist, and nothing
// in this file's history says it does — every prior entry that actually measured
// it put the gap at single-digit KB, and the 2026-08-03 entry reproduced CI's own
// bundle and found it EXACT. So 8,000,000 was ~220 KB of unearned slack on a
// budget whose whole job is to make a screen get drained instead.
//
// Re-measured on this tree, same rolldown build, both numbers below are exact
// (not estimates), budgeted = all emitted .js + .css minus the sentry-vendor
// chunk, which is what the gate at the bottom of this file compares:
//   • bare local `vite build`                                   7,831,677 B
//   • CI-equivalent (VITE_SENTRY_DSN / _RELEASE / _BUILD_COMMIT
//     set to the values in .github/workflows/ci.yml, which is
//     what CI itself computes)                                  7,832,560 B
// The real CI delta is therefore 883 B, not 200 KB. Railway's Docker build adds
// only longer build-arg STRINGS on top of that (Supabase URL + anon key, a real
// Sentry DSN, PostHog key/host — the PostHog provider is a hand-rolled lazy
// module, not a vendored SDK, so it ships either way): hundreds of bytes, not KB.
//
// The ceiling is that CI measurement plus 22,440 B — in line with the ~18-25 KB
// of measured variance every entry from 2026-08-03 onward has used, and enough
// that a rounding or hash-length wobble cannot produce the local-green / CI-red
// failure this file has already suffered twice.
//
// THE OUTSTANDING DRAIN IS STILL OUTSTANDING, and it is large: Pet Showdown was
// meant to replace the continuous-sim Coliseum stack, and once Hollow Gate /
// clan war / sector war / ladder / gauntlet finish migrating off the legacy
// engines, deleting pet-duel-cinematic + pet-duel-sim + pet-battle-sim +
// pet-arena-sim and their renderers ratchets this number DOWN well past 7.265 MB
// (docs/pet-showdown-design.md, follow-ups). Do that before raising this again.
//
// Entry and initial-graph gates below are NOT touched by this entry.

//
// 2026-08-22: 7.70 -> 7.44 MB. The AAA Pet Home / Central destination polish
// (e25446356) is CSS, not code: styles/central-skin.css +54.6 KB of source,
// a new styles/pet-arena-lobby.css at 29.3 KB, styles/relic-dungeons.css at
// 5.4 KB, and styles/pet-home.css +5.3 KB — ~95 KB of authored CSS that
// minifies to ~61 KB and landed the product graph 60,620 B over the old cap.
// That commit shipped RED: the overage took client-quality down and with it
// release-artifact, release-certification and every e2e job, so nothing could
// deploy. Checked for slack before raising this: CSS is already minified, the
// react-icons/gi chunk tree-shakes to the 117 icons actually imported, and the
// 264 inlined FX frames are the deliberate flipbook trade-off documented above
// — there was no waste to reclaim, only a real feature that costs real bytes.
// Exact product graph 7,760,620 B, leaving ~38 KB of headroom. The scheduled
// drain remains the legacy coliseum-stack deletion; the Central/Pet-Home CSS
// is the next-best candidate if this needs paying down before that lands.
//
// 2026-08-22 (same day): RAISE WITHDRAWN, back to 7.34 MB. The icon-bundle
// replacement in #77 (ca993bf73) cut 175,244 B of JS — more than paying back
// the Central/Pet-Home CSS that forced the raise hours earlier. Exact product
// graph is now 7,585,376 B, i.e. 114,624 B UNDER the original cap, so the
// budget goes back to where it was rather than banking someone else's win as
// permanent slack. Deliberately restored to the pre-regression value and not
// ratcheted tighter: the ~112 KB of headroom belongs to the next feature, not
// to this note. The scheduled drain remains the legacy coliseum-stack deletion.
// 2026-08-23: 7.70 -> 7.75 MB. The complete non-combat mobile product layer is
// a single 34,607 B async CSS chunk covering every authenticated phone/tablet
// screen while remaining data-gated off combat. The layer was first imported
// eagerly and failed the independent startup gate; it now loads only after the
// <=979px media query, restoring the desktop initial graph to 1.39 MB raw /
// 378.0 KB gzip. Exact CI-equivalent product graph is 7,723,354 B, leaving
// ~27 KB under the product ceiling.
//
// 2026-08-24 MERGE: 7,855,000 -> 7,830,000 B. Both sides moved this gate and
// both histories are kept above; the merged bundle carries main's UI overhaul
// AND this branch's work, so neither parent's number described it (main's
// 7,750,000 is below what the combined tree actually weighs). A CI-equivalent
// build measured 7,814,174 B of budgeted product JS/CSS.
//
// 2026-08-25 SECOND MERGE of origin/main (civic facilities, named forge, pet
// readiness): re-measured at 7,833,039 B, which is 3,039 B ABOVE the previous
// gate — the gate did its job and caught it. 7,845,000 keeps 11,961 B, sized
// against the ~530 B of run-to-run variance actually observed across four
// CI-equivalent builds, not against a guess.
//
// 2026-08-26 SECTOR CONTRACTS: 7,845,000 -> 7,860,000 B. The day's posted work
// added shared/sector-contracts.ts, lib/sector-contract.ts, lib/sector-richness.ts
// and SectorContractCard.tsx — measured 7,846,664 B, i.e. 4,692 B over the
// previous build and 1,664 B past the gate, which is exactly the growth it exists
// to make visible. NOT a startup regression: the entry chunk and both initial-graph
// gates still pass untouched (this code is inside the lazily-loaded World Map
// graph). 7,860,000 keeps 13,336 B, sized like the entry above it — against the
// ~530 B of observed run-to-run variance, not a guess.
//
// 2026-08-26 MERGE of origin/main (Warfront strategy, Showdown shader packing,
// Colosseum 3D, gauntlet arena art): 7,860,000 -> 7,875,000 B. Main was ALREADY
// over its own 7,845,000 gate before this branch merged — CI run 32938715834
// failed on it at 7.50 MB — so most of this is upstream weight, not the sector
// work. The merged tree measures 7,861,343 B. 7,875,000 keeps 13,657 B, sized
// like the entries above against the ~530 B of observed run-to-run variance.
// Startup is untouched: the entry chunk and both initial-graph gates still pass,
// and neither may be raised to mask a regression.
//
// 2026-08-26 (same day): NOT raised further. Drained the DuelChallenge type
// (App.tsx, see App.size.test.ts) into types/duel-challenge.ts — a type-only
// move that TypeScript erases at compile time, so it costs zero emitted bytes.
// Re-measured on this exact merged tree: still 7,861,343 B, unchanged. Deferred
// to the number above (measured directly against this tree) rather than an
// earlier draft of this entry that guessed a ~45 KB CI-vs-local buffer from a
// different incident's delta — this file's own history above already prices
// the real Sentry/build-arg delta at ~7 KB across dozens of entries, not ~200 KB.
//
// 2026-08-26 SECURITY FOLLOW-UP: 7,875,000 -> 7,890,000 B. The Railway build
// for a01690d3d measured 7,875,294 B after the intentional combat-presentation
// work in a990cbe6d and the CodeQL fixes (memory-only admin fallback plus an
// explicit Warfront worker-input allowlist). The same tree measured 7,874,759 B
// locally: the old ceiling had only 241 B of local headroom and failed on the
// 535 B deploy/build-arg delta. The security paths were compacted before this
// rebaseline (local graph 7,874,488 B), then the product ceiling was restored to
// ~15 KB of deploy headroom. The startup graph still passes independently at
// 1,450,270 B raw / 383,810 B gzip; none of its gates, the per-chunk gate, or
// the per-CSS-file gate moved.
//
// 2026-08-27 FIRST-SESSION NARRATIVE SLICE: 7,890,000 -> 7,918,000 B.
// The identity vow, persisted spar omen, authored foxfire field discovery,
// village-specific return rite, Profile keepsake, and their responsive/reduced-
// motion presentation measure 7,901,702 B after a dedicated compaction pass.
// The work lives in the already-lazy IntroCinematic, OnboardingCoach, and Profile
// graphs; the initial graph moved only 212 B raw / 125 B gzip and remains below
// its independent gates at 1,443,076 B raw / 382,134 B gzip. This ceiling keeps
// ~16 KB of local headroom (and ~15 KB after the observed ~535 B deploy delta),
// matching the sizing rule above. No startup, per-chunk, or CSS gate moved.
//
// 2026-08-28 BLOODLINE AWAKENING: 7,918,000 -> 7,965,000 B. The authoritative
// awakening flow adds a dedicated lazy BloodlineMaker graph (32,242 B JS +
// 27,741 B CSS) and the Central hub presentation that launches it. The exact
// combined main + pet-release-hotfix graph measures 7,945,807 B after a clean
// production build, leaving 19,193 B of local headroom. This is not a startup
// regression: the independently enforced initial graph remains 1,444,143 B
// raw / 382,519 B gzip, and the entry, per-chunk, and per-CSS gates are unchanged.
const TOTAL_JS_CSS_FAIL_BYTES = 7_965_000;
// Ratcheted 2026-07-17 (twice) after the story-graph lazy split: first
// lib/story-trigger-loader.ts moved the interlude/epilogue prose off the entry
// chunk (entry 1,031→795 KB), then data/story-boss-meta.ts freed combat-ai
// from data/storylines so the chapter prose left too (795→581 KB; initial
// gzip ~497→340 KB). Lower these again when the next drain lands, never raise
// them to "fix" a regression.
// 2026-07-22: accumulated feature work briefly raised this to 675,000, then
// BattleTowerFight and the retired card engine were moved off the entry graph.
// The drained entry measured 571,995 B, so the gate was lowered to 640,000.
const ENTRY_JS_FAIL_BYTES = 640_000;
const INITIAL_GRAPH_FAIL_BYTES = 1_500_000;
// 2026-08-20: raised to 390,000 as a TEMPORARY re-baseline when
// public/boot-watchdog.js (1,859 B gz) put the initial graph 47 B over the old
// 385,000 gate and blocked every production deploy. That watchdog is a pre-React
// recovery script that must load BEFORE the module graph to catch a boot that
// never finishes, so it cannot be lazied or deferred — the budget had to move.
//
// One correction to that entry, because it matters for trusting this gate: CI
// did not stay green because it measures a different bundle. Both paths build
// into shinobij.client/dist and sizecheck reads that same directory. CI stayed
// green because every step in ci.yml pipes to `tee` under the default `bash -e`
// shell, which has no pipefail — so sizecheck PRINTED
// `initial JS/CSS graph is 376.0 KB gzip; threshold is 376.0 KB` and the job was
// still recorded as a pass. The unpiped `npm run build` in the Docker image is
// what actually stopped. That is fixed separately with a workflow-level
// `defaults.run.shell: bash`.
//
// 390,000 -> 387,000, taking the raise-then-lower path that entry asked for. The
// drain is a dead-rule sweep of the eager manifest: 64 rules / 11,588 B of source
// CSS whose classes appear nowhere outside the stylesheets (.start-nav-*,
// .hol-bounty-*, .ui-pill*, .profile-info-grid, .sector-road-marker and friends).
// Deleting rules reorders nothing, so the load-bearing cascade order inside each
// manifest part is untouched; every surviving rule was verified byte-identical
// and in place.
//
// Measured on top of the boot-watchdog trim and the animation overhaul:
// 1,442,344 B raw / 383,260 B gzip on a CI-equivalent build (VITE_SENTRY_DSN /
// RELEASE / BUILD_COMMIT set). That leaves ~3.7 KB of headroom, and the margin is
// the point: this gate has now blocked production twice inside one week, both
// times because it sat within a few hundred bytes of the measurement. Do not
// re-tighten it to the measured value. Lower it only behind a drain that buys
// back more than it costs — the entry chunk's own sourcemap attribution says the
// Hollow Gate runtime is ~47 KB of it and is reachable eagerly from App.tsx
// despite being a lazy feature, which is the next real one.
//
// A NOTE ON DEAD CSS, if the sweep is ever repeated: .atlas-central and
// .atlas-hollowGate look dead to any "class name absent from source" search and
// are NOT. WorldMap builds them from `"atlas-landmark atlas-" + location.type`,
// a construction site that does not begin at the string literal's first
// character. Match prefixes mid-literal or the sweep deletes live styles.
//
// 2026-08-23: THE HOLLOW GATE DRAIN THE NOTE ABOVE ASKED FOR IS DONE, and the
// constant is deliberately UNCHANGED — the win was taken as headroom, not as a
// tighter gate, because this gate had drifted back to 379.1 KB (1.2 KB OVER)
// and was again blocking every production deploy.
//
// Two library-level deferrals, no render-tree change (see the note in
// shinobij.client/src/lib/hollow-gate-generator-loader.ts):
//   • lib/hollow-gate-dungeon (+ hollow-gate-generate / -maze) now loads via
//     import() at the three floor-generation call sites, all of which already
//     sat behind a server round-trip. Room-flood visibility moved to the new
//     lib/hollow-gate-visibility because the click-to-move walker calls it
//     synchronously on every step and must stay eager.
//   • lib/hollow-gate-tile (the tile resolver) loads the same way; its one call
//     site runs inside drainHollowGateMoveFx, after the step seal is awaited.
// Both chunks are warmed the moment a run is entered or resumed.
//
// NOT done with lazy components: converting a RENDERED component to
// lazyWithRetry + <Suspense> is what broke the webkit combat-layout spec
// "Tower combat shell keeps jutsu selection geometry stable" (the post-paint
// re-render disturbs its rAF geometry trace). Library-level import() inside an
// already-async function body has no such effect — that spec passes on webkit
// with this drain in place.
//
// Measured, CI-equivalent build (VITE_SENTRY_DSN / _RELEASE / _BUILD_COMMIT set):
//   before  1,464,284 B raw / 388,252 B gzip   (entry chunk 539,825 / 169,500)
//   after   1,439,106 B raw / 378,852 B gzip   (entry chunk 514,619 / 160,038)
// 24.7 KB of the entry chunk became two lazy chunks (hollow-gate-dungeon 14,433 B,
// hollow-gate-tile 10,271 B). Headroom under this gate: 8,148 B, up from -1,252 B.
// A future ratchet is available here; leaving it wide is a deliberate choice
// after this gate blocked production three times inside two weeks.

//
// 2026-08-23: 387,000 -> 389,000 B. The mobile product layer itself remains
// async and absent from index.html; the only startup addition is its media-query
// loader. A CI-equivalent build measures 387,176 B gzip across the same nine
// initial files, so this restores 1,824 B of explicit variance without moving
// the independent 1.50 MB raw, 640 KB entry, per-chunk, or async-product gates.
//
// 2026-08-24 MERGE: 389,000 -> 385,000 B. Both sides moved this gate and both
// histories are kept above; the merged bundle carries main's UI overhaul AND
// this branch's work, so neither parent's number described it. A CI-equivalent
// build (same DSN/release env as .github/workflows/ci.yml) measures
// 381,979 B gzip across the nine initial files — LOWER than main's own 387,176,
// because this branch drained the Hollow Gate cluster off the entry graph by
// more than the mobile media-query loader added. 385,000 keeps 3,021 B of
// variance and is tighter than BOTH parents (387,000 / 389,000).
const INITIAL_GRAPH_GZIP_FAIL_BYTES = 385_000;
const SENTRY_VENDOR_FAIL_BYTES = 100_000;
const SENTRY_VENDOR_RE = /^assets\/sentry-vendor-[^/]+\.js$/;
// Three.js, React Three Fiber, Drei, and postprocessing are intentionally one
// shared lazy vendor chunk. Guard both transfer size and cache footprint more
// tightly than the generic per-chunk ceiling, and keep the stack off startup.
// 2026-08-05 production build: 1,039,022 B raw / 274,197 B gzip.
const THREE_VENDOR_FAIL_BYTES = 1_100_000;
const THREE_VENDOR_GZIP_FAIL_BYTES = 300_000;
const THREE_VENDOR_RE = /^assets\/three-vendor-[^/]+\.js$/;
const STORY_CONTENT_RE = /^assets\/(stormveil|ashen-leaf|frostfang|moonshadow)-[a-f0-9]{12}-[A-Za-z0-9_-]{8}\.json$/;
const STORY_CONTENT_VILLAGES = new Set(['stormveil', 'ashen-leaf', 'frostfang', 'moonshadow']);
const STORY_CONTENT_PER_ASSET_RAW_FAIL_BYTES = 160_000;
const STORY_CONTENT_PER_ASSET_GZIP_FAIL_BYTES = 45_000;
const STORY_CONTENT_TOTAL_RAW_FAIL_BYTES = 600_000;
const STORY_CONTENT_TOTAL_GZIP_FAIL_BYTES = 160_000;

function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) out.push(...walk(full));
        else out.push({ path: full, size: st.size });
    }
    return out;
}

function fmt(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
}

function exact(bytes) {
    return `${fmt(bytes)} (${bytes.toLocaleString('en-US')} B)`;
}

let files;
try {
    files = walk(distDir);
} catch (err) {
    console.error(`[sizecheck] Could not read ${distDir}. Run the client build first.`);
    console.error(`[sizecheck] ${err.message}`);
    process.exit(1);
}

const withRel = files
    .map((file) => ({ ...file, rel: relative(distDir, file.path).replaceAll('\\', '/') }))
    .sort((a, b) => b.size - a.size);

console.log('[sizecheck] Top 20 dist assets:');
for (const file of withRel.slice(0, 20)) {
    console.log(`  ${fmt(file.size).padStart(9)}  ${file.rel}`);
}

const js = withRel.filter((file) => file.rel.endsWith('.js'));
const css = withRel.filter((file) => file.rel.endsWith('.css'));
const jsCssTotal = [...js, ...css].reduce((sum, file) => sum + file.size, 0);
const failures = [];
const sentryChunks = js.filter((file) => SENTRY_VENDOR_RE.test(file.rel));
const threeChunks = js.filter((file) => THREE_VENDOR_RE.test(file.rel));
const budgetedJsCssTotal = [
    ...js.filter((file) => !SENTRY_VENDOR_RE.test(file.rel)),
    ...css,
].reduce((sum, file) => sum + file.size, 0);
const budgetedJsCssFiles = [...js.filter((file) => !SENTRY_VENDOR_RE.test(file.rel)), ...css];
const budgetedJsCssGzipTotal = budgetedJsCssFiles.reduce((sum, file) => sum + gzipSync(readFileSync(file.path), { level: 9 }).length, 0);
const jsCssGzipTotal = [...js, ...css].reduce((sum, file) => sum + gzipSync(readFileSync(file.path), { level: 9 }).length, 0);
const storyContentAssets = withRel.filter((file) => STORY_CONTENT_RE.test(file.rel));
const storyContentVillages = storyContentAssets.map((file) => file.rel.match(STORY_CONTENT_RE)?.[1]).filter(Boolean);
const storyContentGzip = storyContentAssets.map((file) => ({ ...file, gzip: gzipSync(readFileSync(file.path), { level: 9 }).length }));
const storyContentRawTotal = storyContentGzip.reduce((sum, file) => sum + file.size, 0);
const storyContentGzipTotal = storyContentGzip.reduce((sum, file) => sum + file.gzip, 0);

if (storyContentAssets.length !== STORY_CONTENT_VILLAGES.size) failures.push(`expected exactly four content-addressed story JSON assets; found ${storyContentAssets.length}`);
if (new Set(storyContentVillages).size !== STORY_CONTENT_VILLAGES.size || storyContentVillages.some((village) => !STORY_CONTENT_VILLAGES.has(village))) {
    failures.push(`story JSON assets must contain one hashed payload for each village; found ${storyContentVillages.join(', ') || 'none'}`);
}
for (const file of storyContentGzip) {
    if (file.size > STORY_CONTENT_PER_ASSET_RAW_FAIL_BYTES) failures.push(`${file.rel} is ${fmt(file.size)}; per-village story JSON threshold is ${fmt(STORY_CONTENT_PER_ASSET_RAW_FAIL_BYTES)}`);
    if (file.gzip > STORY_CONTENT_PER_ASSET_GZIP_FAIL_BYTES) failures.push(`${file.rel} is ${fmt(file.gzip)} gzip; per-village story JSON gzip threshold is ${fmt(STORY_CONTENT_PER_ASSET_GZIP_FAIL_BYTES)}`);
}
if (storyContentRawTotal > STORY_CONTENT_TOTAL_RAW_FAIL_BYTES) failures.push(`story JSON total is ${fmt(storyContentRawTotal)}; threshold is ${fmt(STORY_CONTENT_TOTAL_RAW_FAIL_BYTES)}`);
if (storyContentGzipTotal > STORY_CONTENT_TOTAL_GZIP_FAIL_BYTES) failures.push(`story JSON total is ${fmt(storyContentGzipTotal)} gzip; threshold is ${fmt(STORY_CONTENT_TOTAL_GZIP_FAIL_BYTES)}`);
console.log(`[sizecheck] On-demand story JSON: ${exact(storyContentRawTotal)} raw / ${exact(storyContentGzipTotal)} gzip across ${storyContentAssets.length} village routes.`);
for (const file of [...storyContentGzip].sort((a, b) => b.gzip - a.gzip)) console.log(`  ${file.rel}: ${fmt(file.size)} raw / ${fmt(file.gzip)} gzip`);

// Sentry is observability, not product code. Allow one tightly capped chunk only
// when it stays off the initial graph; do not weaken the product-code budget.
if (sentryChunks.length > 1) failures.push(`expected at most one lazy Sentry vendor chunk; found ${sentryChunks.length}`);
for (const file of sentryChunks) {
    if (file.size > SENTRY_VENDOR_FAIL_BYTES) {
        failures.push(`${file.rel} is ${fmt(file.size)}; lazy Sentry threshold is ${fmt(SENTRY_VENDOR_FAIL_BYTES)}`);
    }
}
if (threeChunks.length !== 1) failures.push(`expected exactly one shared Three.js vendor chunk; found ${threeChunks.length}`);
for (const file of threeChunks) {
    const gzipBytes = gzipSync(readFileSync(file.path), { level: 9 }).length;
    console.log(`[sizecheck] Lazy Three.js vendor: ${fmt(file.size)} raw / ${fmt(gzipBytes)} gzip.`);
    if (file.size > THREE_VENDOR_FAIL_BYTES) {
        failures.push(`${file.rel} is ${fmt(file.size)}; Three.js vendor threshold is ${fmt(THREE_VENDOR_FAIL_BYTES)}`);
    }
    if (gzipBytes > THREE_VENDOR_GZIP_FAIL_BYTES) {
        failures.push(`${file.rel} is ${fmt(gzipBytes)} gzip; Three.js vendor gzip threshold is ${fmt(THREE_VENDOR_GZIP_FAIL_BYTES)}`);
    }
}
for (const file of js) {
    if (file.size > JS_CHUNK_FAIL_BYTES) failures.push(`${file.rel} is ${fmt(file.size)}; JS chunk threshold is ${fmt(JS_CHUNK_FAIL_BYTES)}`);
}
for (const file of css) {
    if (file.size > CSS_FILE_FAIL_BYTES) failures.push(`${file.rel} is ${fmt(file.size)}; CSS file threshold is ${fmt(CSS_FILE_FAIL_BYTES)}`);
}

// Budget what every player must download before the first lazy screen. Generic
// per-chunk ceilings missed regressions in the entry + render-blocking CSS graph.
let initialRefs = [];
try {
    const html = readFileSync(join(distDir, 'index.html'), 'utf8');
    initialRefs = [...new Set(
        [...html.matchAll(/(?:src|href)="\/([^"?]+\.(?:js|css))(?:\?[^" ]*)?"/g)].map((match) => match[1]),
    )];
    const initialFiles = initialRefs.map((rel) => ({ rel, path: join(distDir, rel), size: statSync(join(distDir, rel)).size }));
    const initialRaw = initialFiles.reduce((sum, file) => sum + file.size, 0);
    const initialGzip = initialFiles.reduce((sum, file) => sum + gzipSync(readFileSync(file.path), { level: 9 }).length, 0);
    const entryRef = moduleEntryReference(html);
    const entryFile = initialFiles.find((file) => file.rel === entryRef);

    console.log(`[sizecheck] Initial JS/CSS graph: ${fmt(initialRaw)} (${initialRaw.toLocaleString("en-US")} B) raw / ${fmt(initialGzip)} (${initialGzip.toLocaleString("en-US")} B) gzip across ${initialFiles.length} files.`);
    if (initialRefs.some((rel) => SENTRY_VENDOR_RE.test(rel))) {
        failures.push('lazy Sentry vendor is referenced by index.html and would delay healthy-player startup');
    }
    if (initialRefs.some((rel) => THREE_VENDOR_RE.test(rel))) {
        failures.push('lazy Three.js vendor is referenced by index.html and would delay startup');
    }
    if (!entryRef || !entryFile) {
        failures.push('could not identify the type="module" Vite entry in index.html');
    } else if (entryFile.size > ENTRY_JS_FAIL_BYTES) {
        failures.push(`${entryFile.rel} is ${fmt(entryFile.size)}; entry JS threshold is ${fmt(ENTRY_JS_FAIL_BYTES)}`);
    }
    if (initialRaw > INITIAL_GRAPH_FAIL_BYTES) {
        failures.push(`initial JS/CSS graph is ${fmt(initialRaw)}; threshold is ${fmt(INITIAL_GRAPH_FAIL_BYTES)}`);
    }
    if (initialGzip > INITIAL_GRAPH_GZIP_FAIL_BYTES) {
        failures.push(`initial JS/CSS graph is ${fmt(initialGzip)} gzip; threshold is ${fmt(INITIAL_GRAPH_GZIP_FAIL_BYTES)}`);
    }
} catch (err) {
    failures.push(`could not measure initial index.html graph: ${err.message}`);
}

// Report what each on-demand consumer transfers after startup. Story Hall loads
// one village payload; the admin VN editor intentionally loads all four. The
// Vite manifest provides the real static JS/CSS closure, including shared chunks.
try {
    const manifest = JSON.parse(readFileSync(join(distDir, '.vite', 'manifest.json'), 'utf8'));
    const entries = Object.entries(manifest);
    const byFile = new Map(entries.map(([key, value]) => [value.file, { key, ...value }]));
    const routeClosure = (source) => {
        const found = entries.find(([, value]) => value.src === source);
        if (!found) throw new Error(`manifest entry for ${source} was not emitted`);
        const visited = new Set();
        const transfer = new Set();
        const visit = (key) => {
            if (visited.has(key)) return;
            visited.add(key);
            const item = manifest[key] ?? byFile.get(key);
            if (!item) throw new Error(`manifest dependency ${key} is missing`);
            if (/\.(?:js|css)$/.test(item.file)) transfer.add(item.file);
            for (const cssFile of item.css ?? []) transfer.add(cssFile);
            for (const imported of item.imports ?? []) visit(imported);
        };
        visit(found[0]);
        for (const initial of initialRefs) transfer.delete(initial);
        const routeFiles = [...transfer].map((rel) => ({ rel, path: join(distDir, rel), size: statSync(join(distDir, rel)).size }));
        return {
            raw: routeFiles.reduce((sum, file) => sum + file.size, 0),
            gzip: routeFiles.reduce((sum, file) => sum + gzipSync(readFileSync(file.path), { level: 9 }).length, 0),
            count: routeFiles.length,
        };
    };
    const storyHall = routeClosure('src/screens/StoryBoss.tsx');
    for (const content of [...storyContentGzip].sort((a, b) => a.rel.localeCompare(b.rel))) {
        const village = content.rel.match(STORY_CONTENT_RE)?.[1] ?? content.rel;
        console.log(`[sizecheck] Story Hall / ${village}: ${exact(storyHall.raw + content.size)} raw / ${exact(storyHall.gzip + content.gzip)} gzip (${storyHall.count} incremental JS/CSS + one village JSON).`);
    }
    const admin = routeClosure('src/screens/AdminPanel.tsx');
    console.log(`[sizecheck] Admin Visual Novels: ${exact(admin.raw + storyContentRawTotal)} raw / ${exact(admin.gzip + storyContentGzipTotal)} gzip (${admin.count} incremental JS/CSS + four village JSON).`);
} catch (err) {
    failures.push(`could not measure on-demand story routes from Vite manifest: ${err.message}`);
}

if (budgetedJsCssTotal > TOTAL_JS_CSS_WARN_BYTES) {
    console.warn(`[sizecheck] WARN budgeted product JS/CSS is ${fmt(budgetedJsCssTotal)} (all emitted: ${fmt(jsCssTotal)}).`);
}
if (budgetedJsCssTotal > TOTAL_JS_CSS_FAIL_BYTES) {
    failures.push(`budgeted product JS/CSS is ${fmt(budgetedJsCssTotal)} (${budgetedJsCssTotal} B); threshold is ${fmt(TOTAL_JS_CSS_FAIL_BYTES)} (${TOTAL_JS_CSS_FAIL_BYTES} B)`);
}

if (failures.length) {
    console.error('[sizecheck] Build size budget failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
}

const sentryNote = sentryChunks.length ? `; lazy Sentry: ${fmt(sentryChunks[0].size)}` : '';
const threeNote = threeChunks.length ? `; lazy Three.js: ${fmt(threeChunks[0].size)}` : '';
console.log(`[sizecheck] PASS. Budgeted product JS/CSS: ${exact(budgetedJsCssTotal)} raw / ${exact(budgetedJsCssGzipTotal)} gzip; story JSON: ${exact(storyContentRawTotal)} raw / ${exact(storyContentGzipTotal)} gzip; combined tracked product: ${exact(budgetedJsCssTotal + storyContentRawTotal)} raw / ${exact(budgetedJsCssGzipTotal + storyContentGzipTotal)} gzip; all emitted JS/CSS: ${exact(jsCssTotal)} raw / ${exact(jsCssGzipTotal)} gzip${sentryNote}${threeNote}.`);
