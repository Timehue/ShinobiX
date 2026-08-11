/*
 * Battle Towers — server-side enemy stat templates (Phase 1, P1.B).
 *
 * Pure data: an aiId → base combat stats for the floor catalog's enemy pods / bosses /
 * npcs. The encounter builder (_encounter.ts) instantiates + party-scales these into
 * TowerActors. Every shipped grunt and boss carries an authored combat role, focus policy,
 * and/or multi-action jutsu kit; those hints are consumed by the Tower-only tactical AI while
 * all damage, tags, resources, and cooldowns still resolve through the canonical combat core.
 *
 * `visual` is an opaque sprite key the client maps to enemy art (BattleTowerFight); it
 * never affects combat. `boss: true` marks the big units the client renders larger.
 *
 * Every aiId referenced by api/towers/_floor-catalog.ts MUST have a template here — the
 * catalog test cross-checks this so a floor can't reference a missing enemy.
 */
export type EnemySpecialty = 'Taijutsu' | 'Bukijutsu' | 'Genjutsu' | 'Ninjutsu';
export type EnemyRole = 'skirmisher' | 'artillery' | 'vanguard' | 'bruiser' | 'controller' | 'support' | 'boss';

export type EnemyJutsu = {
    id: string;
    name?: string;
    type?: string;
    element?: string;
    ap?: number;
    range?: number;
    effectPower?: number;
    chakraCost?: number;
    staminaCost?: number;
    cooldown?: number;
    method?: string;
    target?: string;
    tags?: unknown[];
    isUtility?: boolean;
    /** deterministic AI authoring hints; ignored by the shared combat resolver */
    aiPriority?: number;
    aiHpBelowPct?: number;
    aiHpAbovePct?: number;
};

export type EnemyTemplate = {
    name: string;
    specialty: EnemySpecialty;
    hp: number;
    stats: Record<string, number>;
    /**
     * Rank-band level for the per-rank STAT CAP (api/pvp/move.ts perRankStatCap):
     * tower combat routes through applyJutsu, which clamps each fighter's stats to
     * statCapForLevel(level). REQUIRED so a template's hand-tuned stats are never
     * silently gutted to the Academy ceiling (350) by a missing level. Set so the
     * band cap ≥ the template's biggest stat: grunts are Chunin (cap 1300 ≥ their
     * ≤850), bosses are Special Jonin (80+ = uncapped) for their ≤1500.
     */
    level: number;
    /** client sprite key (cosmetic; never touches combat math) */
    visual: string;
    /** encounter role shown to players and consumed by tactical AI authoring */
    role?: EnemyRole;
    /** viewer-independent focus policy for ordinary enemies; bosses may override per floor */
    targetMode?: 'lowest-hp' | 'squishiest' | 'support';
    /** the client renders bosses larger + with a phase ring */
    boss?: boolean;
    /** raw damage-reduction (0..1.5) read by computeDamage's armor pool (effDR = raw/(raw+K_DR)).
     *  Absent = no armor (grunts). Endgame Spire bosses carry it so squad DPS is mitigated. */
    armorRawDR?: number;
    /** signature jutsu the enemy AI casts (bestAffordableJutsu). Bosses use these to actually
     *  THREATEN a geared party — a 60-AP damage jutsu hits ~4-5× a basic attack. Copied verbatim
     *  onto the actor's character.jutsu by the encounter builder. Absent = basic-attacks only.
     *
     *  `target` / `tags` mirror the engine's JutsuLike (api/towers/_engine.ts): the
     *  resolver reads them for EMPTY_GROUND placement, ground zones, Push/Pull and
     *  every status tag. The hand-authored templates below carry neither, but a
     *  template built from a real authored loadout (api/_ai-opponent-loadout.ts,
     *  the generic AI-fight migration) does — and dropping them at the TYPE
     *  boundary would have silently disarmed every tag the AI is supposed to cast.
     *  The encounter builder already copies jutsu with a spread, so this is a
     *  type-only widening: no runtime behavior changes for existing templates. */
    jutsu?: EnemyJutsu[];
    /** chakra/stamina pool override (bosses that cast want a bigger pool than the 100 default) */
    maxChakra?: number;
    maxStamina?: number;
};

const TEMPLATES: Record<string, EnemyTemplate> = {
    'grunt-bandit': {
        name: 'Bandit', specialty: 'Taijutsu', level: 40, hp: 500, visual: 'bandit', role: 'skirmisher', targetMode: 'lowest-hp',
        stats: { taijutsuOffense: 600, taijutsuDefense: 500, strength: 200, speed: 200 },
        jutsu: [
            { id: 'bandit-hamstring', name: 'Hamstring Cut', type: 'Taijutsu', ap: 60, range: 1, effectPower: 12, cooldown: 3, tags: [{ name: 'Wound', percent: 8 }], aiPriority: 30 },
        ],
    },
    'grunt-archer': {
        name: 'Archer', specialty: 'Bukijutsu', level: 40, hp: 450, visual: 'archer', role: 'artillery', targetMode: 'squishiest',
        stats: { bukijutsuOffense: 650, bukijutsuDefense: 400, intelligence: 200, strength: 150 },
        jutsu: [
            { id: 'archer-pin', name: 'Pinning Shot', type: 'Bukijutsu', ap: 60, range: 5, effectPower: 12, cooldown: 3, tags: [{ name: 'Decrease Damage Given', percent: 8 }], aiPriority: 35 },
            { id: 'archer-volley', name: 'Crossfire Volley', type: 'Bukijutsu', ap: 60, range: 4, effectPower: 8, cooldown: 4, method: 'AOE_BURST', aiPriority: 40 },
        ],
    },
    'grunt-blocker': {
        name: 'Shieldman', specialty: 'Taijutsu', level: 40, hp: 850, visual: 'blocker', role: 'vanguard',
        stats: { taijutsuOffense: 400, taijutsuDefense: 850, strength: 300, speed: 100 },
        jutsu: [
            { id: 'shieldman-brace', name: 'Iron Brace', type: 'Taijutsu', ap: 60, range: 0, effectPower: 0, cooldown: 5, target: 'SELF', isUtility: true, tags: [{ name: 'Shield', percent: 20 }], aiPriority: 80, aiHpBelowPct: 75 },
            { id: 'shieldman-bash', name: 'Shield Bash', type: 'Taijutsu', ap: 60, range: 1, effectPower: 10, cooldown: 4, tags: [{ name: 'Stun', percent: 0 }], aiPriority: 45 },
        ],
    },
    'grunt-brute': {
        name: 'Brute', specialty: 'Taijutsu', level: 40, hp: 950, visual: 'brute', role: 'bruiser', targetMode: 'lowest-hp',
        stats: { taijutsuOffense: 800, taijutsuDefense: 600, strength: 400, speed: 120 },
        jutsu: [
            { id: 'brute-bullrush', name: 'Bullrush', type: 'Taijutsu', ap: 60, range: 1, effectPower: 18, cooldown: 3, tags: [{ name: 'Push', amount: 2 }], aiPriority: 45 },
        ],
    },
    'grunt-acolyte': {
        name: 'Acolyte', specialty: 'Ninjutsu', level: 40, hp: 420, visual: 'acolyte', role: 'controller', targetMode: 'support',
        stats: { ninjutsuOffense: 750, ninjutsuDefense: 350, willpower: 250, intelligence: 200 },
        jutsu: [
            { id: 'acolyte-mire', name: 'Umbral Mire', type: 'Ninjutsu', element: 'None', ap: 60, range: 4, effectPower: 0, cooldown: 4, target: 'EMPTY_GROUND', method: 'AOE_SPIRAL', tags: [{ name: 'Poison', percent: 5 }], aiPriority: 55 },
            { id: 'acolyte-bolt', name: 'Hollow Bolt', type: 'Ninjutsu', ap: 60, range: 3, effectPower: 13, cooldown: 3, tags: [{ name: 'Increase Damage Taken', percent: 8 }], aiPriority: 35 },
        ],
    },
    // Story bosses (floors 5/7/9/10) — GAUNTLET-tuned: high HP + armor DR so a geared party can't
    // faceroll them in ~3 rounds (fights last long enough for the telegraphed strikes / closing
    // ring / aegis / summons to actually bite), and enough offense to threaten a wipe. Ramp up to
    // the finale. (Distinct from the Endless-Spire L100 variants below.)
    'boss-warden': {
        name: 'Spire Warden', specialty: 'Ninjutsu', level: 80, hp: 18000, visual: 'warden', role: 'boss', boss: true, armorRawDR: 0.20,
        stats: { ninjutsuOffense: 2050, ninjutsuDefense: 1200, willpower: 550, speed: 400 },
        jutsu: [
            { id: 'warden-lance', name: 'Warding Lance', type: 'Ninjutsu', element: 'Lightning', ap: 60, range: 4, effectPower: 46, method: 'AOE_BURST', cooldown: 3, aiPriority: 50 },
            { id: 'warden-aegis', name: 'Warden Aegis', type: 'Ninjutsu', ap: 60, range: 0, effectPower: 0, target: 'SELF', isUtility: true, cooldown: 5, tags: [{ name: 'Shield', percent: 25 }], aiPriority: 90, aiHpBelowPct: 70 },
            { id: 'warden-chain', name: 'Storm Chain', type: 'Ninjutsu', element: 'Lightning', ap: 50, range: 4, effectPower: 28, cooldown: 2, tags: [{ name: 'Pull', amount: 1 }], aiPriority: 45 },
        ],
    },
    'boss-ravager': {
        name: 'Pit Ravager', specialty: 'Taijutsu', level: 80, hp: 30000, visual: 'ravager', role: 'boss', boss: true, armorRawDR: 0.24,
        stats: { taijutsuOffense: 2150, taijutsuDefense: 1200, strength: 640, speed: 320 },
        jutsu: [
            { id: 'ravager-maul', name: 'Ravaging Maul', type: 'Taijutsu', ap: 60, range: 3, effectPower: 58, method: 'AOE_BURST', cooldown: 3, aiPriority: 55 },
            { id: 'ravager-hurl', name: 'Crater Hurl', type: 'Taijutsu', ap: 50, range: 4, effectPower: 30, cooldown: 2, tags: [{ name: 'Push', amount: 2 }], aiPriority: 45 },
            { id: 'ravager-fury', name: 'Blood Fury', type: 'Taijutsu', ap: 60, range: 0, effectPower: 0, target: 'SELF', isUtility: true, cooldown: 6, tags: [{ name: 'Increase Damage Given', percent: 25 }], aiPriority: 85, aiHpBelowPct: 55 },
        ],
    },
    'boss-revenant': {
        name: 'Hollow Revenant', specialty: 'Genjutsu', level: 80, hp: 17000, visual: 'revenant', role: 'boss', boss: true, armorRawDR: 0.18,
        stats: { genjutsuOffense: 1950, genjutsuDefense: 1250, willpower: 620, intelligence: 420 },
        jutsu: [
            { id: 'revenant-wail', name: 'Hollow Wail', type: 'Genjutsu', ap: 60, range: 4, effectPower: 44, cooldown: 3, tags: [{ name: 'Decrease Damage Given', percent: 10 }], aiPriority: 55 },
            { id: 'revenant-mire', name: 'Grave Mist', type: 'Genjutsu', ap: 60, range: 4, effectPower: 0, target: 'EMPTY_GROUND', method: 'AOE_SPIRAL', cooldown: 4, tags: [{ name: 'Recoil', percent: 12 }], aiPriority: 60 },
            { id: 'revenant-veil', name: 'Grave Mirror', type: 'Genjutsu', ap: 60, range: 0, effectPower: 0, target: 'SELF', isUtility: true, cooldown: 6, tags: [{ name: 'Reflect', percent: 10 }], aiPriority: 85, aiHpBelowPct: 40 },
        ],
    },
    'boss-sovereign': {
        name: 'Spire Sovereign', specialty: 'Ninjutsu', level: 80, hp: 24000, visual: 'sovereign', role: 'boss', boss: true, armorRawDR: 0.23,
        stats: { ninjutsuOffense: 1950, ninjutsuDefense: 1400, willpower: 650, speed: 450 },
        jutsu: [
            { id: 'sovereign-cataclysm', name: 'Sovereign Cataclysm', type: 'Ninjutsu', element: 'Fire', ap: 60, range: 4, effectPower: 44, method: 'AOE_BURST', cooldown: 3, tags: [{ name: 'Wound', percent: 20 }], aiPriority: 55 },
            { id: 'sovereign-rift', name: 'Void Rift', type: 'Ninjutsu', ap: 60, range: 5, effectPower: 0, target: 'EMPTY_GROUND', method: 'AOE_SPIRAL', cooldown: 4, tags: [{ name: 'Poison', percent: 10 }], aiPriority: 65 },
            { id: 'sovereign-crown', name: 'Crown of Ruin', type: 'Ninjutsu', ap: 60, range: 0, effectPower: 0, target: 'SELF', isUtility: true, cooldown: 6, tags: [{ name: 'Reflect', percent: 25 }], aiPriority: 90, aiHpBelowPct: 45 },
        ],
    },
    // ── Clan Boss (api/clan-boss) — a tough party-of-3 boss. Its HP is OVERRIDDEN at
    // assault time to the clan's shared pool (min(pool, cap)), so these hp values are
    // only a fallback; the stats below drive how hard it HITS (assaults normally end
    // in a wipe having chipped the boss). Dedicated visual keys keep combat art aligned
    // with the weekly boss card. Stats sit
    // at the level-80 boss ceiling (a stat-cap parity test pins this).
    // Clan bosses are GAUNTLET-tuned like the story bosses (armor + a signature AOE nuke) so a
    // single geared party can't one-shot the capped assault chunk — assaults chip a portion and
    // usually wipe, the way the weekly clan raid intends. HP is still overridden to the assault cap.
    'clan-boss-oni': {
        name: 'The Oni Warlord', specialty: 'Taijutsu', level: 80, hp: 12000, visual: 'clan-boss-oni', boss: true, armorRawDR: 0.26,
        stats: { taijutsuOffense: 2450, taijutsuDefense: 1250, strength: 720, speed: 380 },
        jutsu: [{ id: 'oni-cleaver', name: 'Oni Cleaver', type: 'Taijutsu', ap: 60, range: 3, effectPower: 62, method: 'AOE_BURST' }],
    },
    'clan-boss-leviathan': {
        name: 'Abyssal Leviathan', specialty: 'Ninjutsu', level: 80, hp: 12000, visual: 'clan-boss-leviathan', boss: true, armorRawDR: 0.26,
        stats: { ninjutsuOffense: 2250, ninjutsuDefense: 1250, willpower: 620, speed: 380 },
        jutsu: [{ id: 'leviathan-surge', name: 'Abyssal Surge', type: 'Ninjutsu', element: 'Water', ap: 60, range: 3, effectPower: 54, method: 'AOE_BURST' }],
    },
    'clan-boss-kage': {
        name: 'The Fallen Kage', specialty: 'Genjutsu', level: 80, hp: 12000, visual: 'clan-boss-kage', boss: true, armorRawDR: 0.16,
        stats: { genjutsuOffense: 1850, genjutsuDefense: 1200, willpower: 580, intelligence: 440 },
        jutsu: [{ id: 'kage-eclipse', name: 'Hollow Eclipse', type: 'Genjutsu', ap: 60, range: 3, effectPower: 46, method: 'AOE_BURST' }],
    },
    'clan-boss-golem': {
        // bulwark tank: highest armor, a bit less offense; the whole clan chips it over the week.
        name: 'Ancient Stone Golem', specialty: 'Taijutsu', level: 80, hp: 12000, visual: 'clan-boss-golem', boss: true, armorRawDR: 0.32,
        stats: { taijutsuOffense: 2050, taijutsuDefense: 1550, strength: 720, speed: 240 },
        jutsu: [{ id: 'golem-quake', name: 'Seismic Quake', type: 'Taijutsu', ap: 60, range: 3, effectPower: 48, method: 'AOE_BURST' }],
    },
    'npc-genin': {
        // Escort objectives keep NPCs passive, so this unit must survive long
        // enough for positioning/focus-fire to matter. The old 600-HP academy
        // stat line was always the AI's lowest-HP target and died before even a
        // maxed squad could interact with the objective.
        name: 'Allied Genin', specialty: 'Taijutsu', level: 40, hp: 5000, visual: 'genin', role: 'vanguard', armorRawDR: 0.35,
        stats: {
            taijutsuOffense: 500,
            taijutsuDefense: 1000, bukijutsuDefense: 1000, genjutsuDefense: 1000, ninjutsuDefense: 1000,
            strength: 650, speed: 350, intelligence: 350, willpower: 650,
        },
    },

    // ── Endless Spire — ENDGAME boss variants ────────────────────────────────────
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
    // These blocks and per-floor catalog HP are locked by the real-engine release simulation.
    'spire-warden': {
        name: 'Spire Warden', specialty: 'Ninjutsu', level: 100, hp: 40000, visual: 'warden', role: 'boss', boss: true,
        armorRawDR: 0.15,
        stats: {
            ninjutsuOffense: 2000,
            taijutsuDefense: 2500, bukijutsuDefense: 2500, genjutsuDefense: 2500, ninjutsuDefense: 2500,
            strength: 2500, speed: 2500, intelligence: 2500, willpower: 2500,
        },
        jutsu: [
            { id: 'spire-warden-lance', name: 'Ascendant Lance', type: 'Ninjutsu', element: 'Lightning', ap: 60, range: 5, effectPower: 48, method: 'AOE_BURST', cooldown: 3, aiPriority: 55 },
            { id: 'spire-warden-aegis', name: 'Astral Aegis', type: 'Ninjutsu', ap: 60, range: 0, effectPower: 0, target: 'SELF', isUtility: true, cooldown: 5, tags: [{ name: 'Shield', percent: 30 }], aiPriority: 95, aiHpBelowPct: 75 },
            { id: 'spire-warden-chain', name: 'Judgment Chain', type: 'Ninjutsu', element: 'Lightning', ap: 50, range: 5, effectPower: 30, cooldown: 2, tags: [{ name: 'Pull', amount: 2 }, { name: 'Increase Damage Taken', percent: 18 }], aiPriority: 50 },
        ],
    },
    'spire-revenant': {
        name: 'Hollow Revenant', specialty: 'Genjutsu', level: 100, hp: 33000, visual: 'revenant', role: 'boss', boss: true,
        armorRawDR: 0.20,
        stats: {
            genjutsuOffense: 2100,
            taijutsuDefense: 2500, bukijutsuDefense: 2500, genjutsuDefense: 2500, ninjutsuDefense: 2500,
            strength: 2500, speed: 2500, intelligence: 2500, willpower: 2500,
        },
        jutsu: [
            // Regen is already this boss's sustain mechanic. Keep its kit tactical
            // without stacking a second heal wall or blanketing the whole party in
            // an uptime-heavy damage debuff (which made calibrated tiers time out).
            { id: 'spire-revenant-wail', name: 'Final Wail', type: 'Genjutsu', ap: 60, range: 5, effectPower: 42, cooldown: 3, tags: [{ name: 'Decrease Damage Given', percent: 10 }], aiPriority: 55 },
            { id: 'spire-revenant-mist', name: 'Soul Mist', type: 'Genjutsu', ap: 60, range: 5, effectPower: 0, target: 'EMPTY_GROUND', method: 'AOE_SPIRAL', cooldown: 4, tags: [{ name: 'Recoil', percent: 16 }], aiPriority: 65 },
            { id: 'spire-revenant-veil', name: 'Grave Mirror', type: 'Genjutsu', ap: 60, range: 0, effectPower: 0, target: 'SELF', isUtility: true, cooldown: 6, tags: [{ name: 'Reflect', percent: 15 }], aiPriority: 90, aiHpBelowPct: 45 },
        ],
    },
    'spire-ravager': {
        name: 'Pit Ravager', specialty: 'Taijutsu', level: 100, hp: 25000, visual: 'ravager', role: 'boss', boss: true,
        armorRawDR: 0.20,
        stats: {
            taijutsuOffense: 2200,
            taijutsuDefense: 2500, bukijutsuDefense: 2500, genjutsuDefense: 2500, ninjutsuDefense: 2500,
            strength: 2500, speed: 2500, intelligence: 2500, willpower: 2500,
        },
        jutsu: [
            { id: 'spire-ravager-maul', name: 'Worldbreaker Maul', type: 'Taijutsu', ap: 60, range: 4, effectPower: 58, method: 'AOE_BURST', cooldown: 3, tags: [{ name: 'Wound', percent: 22 }], aiPriority: 60 },
            { id: 'spire-ravager-hurl', name: 'Faultline Hurl', type: 'Taijutsu', ap: 50, range: 5, effectPower: 32, cooldown: 2, tags: [{ name: 'Push', amount: 2 }], aiPriority: 50 },
            { id: 'spire-ravager-fury', name: 'Last Fury', type: 'Taijutsu', ap: 60, range: 0, effectPower: 0, target: 'SELF', isUtility: true, cooldown: 6, tags: [{ name: 'Increase Damage Given', percent: 30 }], aiPriority: 90, aiHpBelowPct: 50 },
        ],
    },
    'spire-sovereign': {
        name: 'Spire Sovereign', specialty: 'Ninjutsu', level: 100, hp: 24000, visual: 'sovereign', role: 'boss', boss: true,
        armorRawDR: 0.25,
        stats: {
            ninjutsuOffense: 2300,
            taijutsuDefense: 2500, bukijutsuDefense: 2500, genjutsuDefense: 2500, ninjutsuDefense: 2500,
            strength: 2500, speed: 2500, intelligence: 2500, willpower: 2500,
        },
        jutsu: [
            { id: 'spire-sovereign-cataclysm', name: 'Celestial Cataclysm', type: 'Ninjutsu', element: 'Fire', ap: 60, range: 5, effectPower: 50, method: 'AOE_BURST', cooldown: 3, tags: [{ name: 'Wound', percent: 24 }], aiPriority: 60 },
            { id: 'spire-sovereign-rift', name: 'Starless Rift', type: 'Ninjutsu', ap: 60, range: 5, effectPower: 0, target: 'EMPTY_GROUND', method: 'AOE_SPIRAL', cooldown: 4, tags: [{ name: 'Poison', percent: 12 }], aiPriority: 70 },
            { id: 'spire-sovereign-crown', name: 'Absolute Crown', type: 'Ninjutsu', ap: 60, range: 0, effectPower: 0, target: 'SELF', isUtility: true, cooldown: 6, tags: [{ name: 'Reflect', percent: 30 }], aiPriority: 95, aiHpBelowPct: 45 },
        ],
    },
    // Guard-pod / summon add for the Spire: an endgame speed-bump, NOT a threat. Defense
    // composite ~2400 (squad kills it fast — bulwark drops after a short add-clear phase);
    // offense kept well BELOW the boss so a swarm never out-bursts the boss (sim residual risk).
    'spire-guard': {
        name: 'Spire Sentinel', specialty: 'Taijutsu', level: 100, hp: 3500, visual: 'blocker', role: 'vanguard',
        stats: {
            taijutsuOffense: 900,
            taijutsuDefense: 1200, bukijutsuDefense: 1200, genjutsuDefense: 1200, ninjutsuDefense: 1200,
            strength: 600, speed: 600, intelligence: 400, willpower: 400,
        },
        jutsu: [
            { id: 'spire-sentinel-bash', name: 'Sentinel Bash', type: 'Taijutsu', ap: 60, range: 1, effectPower: 14, cooldown: 4, tags: [{ name: 'Stun', percent: 0 }], aiPriority: 40 },
        ],
    },
};

// Compatibility fallback for legacy/non-authored callers of getEnemyTemplate. Published Tower
// catalogs use requireEnemyTemplate and fail closed, so a typo can never disguise itself as Shade.
const FALLBACK: EnemyTemplate = {
    name: 'Shade', specialty: 'Taijutsu', level: 40, hp: 300, visual: 'bandit',
    stats: { taijutsuOffense: 300, taijutsuDefense: 300 },
};

export function getEnemyTemplate(aiId: string): EnemyTemplate {
    return TEMPLATES[aiId] ?? FALLBACK;
}

/**
 * Strict content-boundary lookup for authored encounters. The permissive
 * `getEnemyTemplate` remains for legacy callers, but a published Tower floor
 * must never disguise a misspelled/missing combatant as the generic Shade.
 */
export function requireEnemyTemplate(aiId: string): EnemyTemplate {
    const template = TEMPLATES[aiId];
    if (!template) throw new Error(`Unknown Battle Towers enemy template: ${aiId}`);
    return template;
}

export function hasEnemyTemplate(aiId: string): boolean {
    return Object.prototype.hasOwnProperty.call(TEMPLATES, aiId);
}

export const ENEMY_TEMPLATE_IDS: readonly string[] = Object.keys(TEMPLATES);
