"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENEMY_TEMPLATE_IDS = void 0;
exports.getEnemyTemplate = getEnemyTemplate;
exports.hasEnemyTemplate = hasEnemyTemplate;
const TEMPLATES = {
    'grunt-bandit': {
        name: 'Bandit', specialty: 'Taijutsu', level: 40, hp: 500, visual: 'bandit',
        stats: { taijutsuOffense: 600, taijutsuDefense: 500, strength: 200, speed: 200 },
    },
    'grunt-archer': {
        name: 'Archer', specialty: 'Bukijutsu', level: 40, hp: 450, visual: 'archer',
        stats: { bukijutsuOffense: 650, bukijutsuDefense: 400, intelligence: 200, strength: 150 },
    },
    'grunt-blocker': {
        name: 'Shieldman', specialty: 'Taijutsu', level: 40, hp: 850, visual: 'blocker',
        stats: { taijutsuOffense: 400, taijutsuDefense: 850, strength: 300, speed: 100 },
    },
    'grunt-brute': {
        name: 'Brute', specialty: 'Taijutsu', level: 40, hp: 950, visual: 'brute',
        stats: { taijutsuOffense: 800, taijutsuDefense: 600, strength: 400, speed: 120 },
    },
    'grunt-acolyte': {
        name: 'Acolyte', specialty: 'Ninjutsu', level: 40, hp: 420, visual: 'acolyte',
        stats: { ninjutsuOffense: 750, ninjutsuDefense: 350, willpower: 250, intelligence: 200 },
    },
    'boss-warden': {
        name: 'Spire Warden', specialty: 'Ninjutsu', level: 80, hp: 4200, visual: 'warden', boss: true,
        stats: { ninjutsuOffense: 1200, ninjutsuDefense: 950, willpower: 450, speed: 300 },
    },
    'boss-ravager': {
        name: 'Pit Ravager', specialty: 'Taijutsu', level: 80, hp: 4800, visual: 'ravager', boss: true,
        stats: { taijutsuOffense: 1300, taijutsuDefense: 1000, strength: 500, speed: 260 },
    },
    'boss-revenant': {
        name: 'Hollow Revenant', specialty: 'Genjutsu', level: 80, hp: 5200, visual: 'revenant', boss: true,
        stats: { genjutsuOffense: 1300, genjutsuDefense: 1050, willpower: 500, intelligence: 350 },
    },
    'boss-sovereign': {
        name: 'Spire Sovereign', specialty: 'Ninjutsu', level: 80, hp: 6200, visual: 'sovereign', boss: true,
        stats: { ninjutsuOffense: 1500, ninjutsuDefense: 1150, willpower: 550, speed: 350 },
    },
    // ── Clan Boss (api/clan-boss) — a tough party-of-3 boss. Its HP is OVERRIDDEN at
    // assault time to the clan's shared pool (min(pool, cap)), so these hp values are
    // only a fallback; the stats below drive how hard it HITS (assaults normally end
    // in a wipe having chipped the boss). Reuse the existing boss sprites. Stats sit
    // at the level-80 boss ceiling (a stat-cap parity test pins this).
    'clan-boss-oni': {
        name: 'The Oni Warlord', specialty: 'Taijutsu', level: 80, hp: 12000, visual: 'ravager', boss: true,
        stats: { taijutsuOffense: 1500, taijutsuDefense: 1150, strength: 640, speed: 320 },
    },
    'clan-boss-leviathan': {
        name: 'Abyssal Leviathan', specialty: 'Ninjutsu', level: 80, hp: 12000, visual: 'sovereign', boss: true,
        stats: { ninjutsuOffense: 1500, ninjutsuDefense: 1150, willpower: 560, speed: 340 },
    },
    'clan-boss-kage': {
        name: 'The Fallen Kage', specialty: 'Genjutsu', level: 80, hp: 12000, visual: 'revenant', boss: true,
        stats: { genjutsuOffense: 1500, genjutsuDefense: 1200, willpower: 560, intelligence: 420 },
    },
    'clan-boss-golem': {
        name: 'Ancient Stone Golem', specialty: 'Taijutsu', level: 80, hp: 12000, visual: 'warden', boss: true,
        stats: { taijutsuOffense: 1400, taijutsuDefense: 1450, strength: 660, speed: 220 },
    },
    'npc-genin': {
        name: 'Allied Genin', specialty: 'Taijutsu', level: 40, hp: 600, visual: 'genin',
        stats: { taijutsuOffense: 350, taijutsuDefense: 350 },
    },
    // ── Endless Spire — ENDGAME boss variants (Wave 1) ───────────────────────────
    // Distinct from the L80 story bosses above (which stay tuned for the 10 story floors).
    // The clamped-DPS sim proved the story blocks (def composite ~1700-2050, no armor) let a
    // maxed L100 squad (offense composite ~7500) peg statFactor at the 1.85 ceiling → <2-round
    // faceroll. These are re-statted to un-peg BOTH clamps: every DEFENSE composite ≈ 7500
    // (all defense stats + the shared secondaries at 2500) so the squad's outgoing statFactor
    // falls to ~1.0, and OFFENSE composite ≈ 7000-7300 (primary offense 2000-2300 + 2 secondaries)
    // so incoming statFactor rises off the 0.35 floor to ~0.92-0.97. armorRawDR mitigates squad
    // DPS. HP is authored PER-FLOOR in _spire-catalog (a boss appears at many floors, and an
    // HP-scaled mechanic × a big HP would wall/immortal) — the `hp` here is a nominal fallback.
    // Level 100 = the endgame stat-cap band (per-stat cap MAX_STAT 2500). Final numbers are
    // TARGETS pending the against-the-built-engine re-sim; tune here + in the spire catalog.
    'spire-warden': {
        name: 'Spire Warden', specialty: 'Ninjutsu', level: 100, hp: 40000, visual: 'warden', boss: true,
        armorRawDR: 0.15,
        stats: {
            ninjutsuOffense: 2000,
            taijutsuDefense: 2500, bukijutsuDefense: 2500, genjutsuDefense: 2500, ninjutsuDefense: 2500,
            strength: 2500, speed: 2500, intelligence: 2500, willpower: 2500,
        },
    },
    'spire-revenant': {
        name: 'Hollow Revenant', specialty: 'Genjutsu', level: 100, hp: 33000, visual: 'revenant', boss: true,
        armorRawDR: 0.20,
        stats: {
            genjutsuOffense: 2100,
            taijutsuDefense: 2500, bukijutsuDefense: 2500, genjutsuDefense: 2500, ninjutsuDefense: 2500,
            strength: 2500, speed: 2500, intelligence: 2500, willpower: 2500,
        },
    },
    'spire-ravager': {
        name: 'Pit Ravager', specialty: 'Taijutsu', level: 100, hp: 25000, visual: 'ravager', boss: true,
        armorRawDR: 0.20,
        stats: {
            taijutsuOffense: 2200,
            taijutsuDefense: 2500, bukijutsuDefense: 2500, genjutsuDefense: 2500, ninjutsuDefense: 2500,
            strength: 2500, speed: 2500, intelligence: 2500, willpower: 2500,
        },
    },
    'spire-sovereign': {
        name: 'Spire Sovereign', specialty: 'Ninjutsu', level: 100, hp: 24000, visual: 'sovereign', boss: true,
        armorRawDR: 0.25,
        stats: {
            ninjutsuOffense: 2300,
            taijutsuDefense: 2500, bukijutsuDefense: 2500, genjutsuDefense: 2500, ninjutsuDefense: 2500,
            strength: 2500, speed: 2500, intelligence: 2500, willpower: 2500,
        },
    },
    // Guard-pod / summon add for the Spire: an endgame speed-bump, NOT a threat. Defense
    // composite ~2400 (squad kills it fast — bulwark drops after a short add-clear phase);
    // offense kept well BELOW the boss so a swarm never out-bursts the boss (sim residual risk).
    'spire-guard': {
        name: 'Spire Sentinel', specialty: 'Taijutsu', level: 100, hp: 3500, visual: 'blocker',
        stats: {
            taijutsuOffense: 900,
            taijutsuDefense: 1200, bukijutsuDefense: 1200, genjutsuDefense: 1200, ninjutsuDefense: 1200,
            strength: 600, speed: 600, intelligence: 400, willpower: 400,
        },
    },
};
// Defensive fallback so a misconfigured aiId yields a weak grunt rather than crashing
// the encounter build (the catalog validator + test are the real guard).
const FALLBACK = {
    name: 'Shade', specialty: 'Taijutsu', level: 40, hp: 300, visual: 'bandit',
    stats: { taijutsuOffense: 300, taijutsuDefense: 300 },
};
function getEnemyTemplate(aiId) {
    return TEMPLATES[aiId] ?? FALLBACK;
}
function hasEnemyTemplate(aiId) {
    return Object.prototype.hasOwnProperty.call(TEMPLATES, aiId);
}
exports.ENEMY_TEMPLATE_IDS = Object.keys(TEMPLATES);
