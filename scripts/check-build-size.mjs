import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

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
const TOTAL_JS_CSS_FAIL_BYTES = 7_378_000;
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
try {
    const html = readFileSync(join(distDir, 'index.html'), 'utf8');
    const initialRefs = [...new Set(
        [...html.matchAll(/(?:src|href)="\/([^"?]+\.(?:js|css))(?:\?[^" ]*)?"/g)].map((match) => match[1]),
    )];
    const initialFiles = initialRefs.map((rel) => ({ rel, path: join(distDir, rel), size: statSync(join(distDir, rel)).size }));
    const initialRaw = initialFiles.reduce((sum, file) => sum + file.size, 0);
    const initialGzip = initialFiles.reduce((sum, file) => sum + gzipSync(readFileSync(file.path), { level: 9 }).length, 0);
    const entryRef = [...html.matchAll(/<script[^>]+src="\/([^"?]+\.js)/g)][0]?.[1];
    const entryFile = initialFiles.find((file) => file.rel === entryRef);

    console.log(`[sizecheck] Initial JS/CSS graph: ${fmt(initialRaw)} raw / ${fmt(initialGzip)} gzip across ${initialFiles.length} files.`);
    if (initialRefs.some((rel) => SENTRY_VENDOR_RE.test(rel))) {
        failures.push('lazy Sentry vendor is referenced by index.html and would delay healthy-player startup');
    }
    if (initialRefs.some((rel) => THREE_VENDOR_RE.test(rel))) {
        failures.push('lazy Three.js vendor is referenced by index.html and would delay startup');
    }
    if (entryFile && entryFile.size > ENTRY_JS_FAIL_BYTES) {
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

if (budgetedJsCssTotal > TOTAL_JS_CSS_WARN_BYTES) {
    console.warn(`[sizecheck] WARN budgeted product JS/CSS is ${fmt(budgetedJsCssTotal)} (all emitted: ${fmt(jsCssTotal)}).`);
}
if (budgetedJsCssTotal > TOTAL_JS_CSS_FAIL_BYTES) {
    failures.push(`budgeted product JS/CSS is ${fmt(budgetedJsCssTotal)}; threshold is ${fmt(TOTAL_JS_CSS_FAIL_BYTES)}`);
}

if (failures.length) {
    console.error('[sizecheck] Build size budget failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
}

const sentryNote = sentryChunks.length ? `; lazy Sentry: ${fmt(sentryChunks[0].size)}` : '';
const threeNote = threeChunks.length ? `; lazy Three.js: ${fmt(threeChunks[0].size)}` : '';
console.log(`[sizecheck] PASS. Budgeted product JS/CSS: ${fmt(budgetedJsCssTotal)}; all emitted: ${fmt(jsCssTotal)}${sentryNote}${threeNote}.`);
