"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sealTowerFighter = sealTowerFighter;
/*
 * Battle Towers — combat-snapshot sealing (Phase 1, P1.B).
 *
 * Turns a player's stored save character into a combat-safe TowerActor character: clamps
 * every formula-facing stat/vital to the game's hard caps, sanitizes the jutsu + pvpItems
 * loadout (reusing the EXPORTED PvP sanitizers), and strips all non-combat / economic
 * fields. Defense-in-depth: even though saves are server-stored, a borrowed ally's owner
 * can hand-edit their own save, so the snapshot is clamped before it's sealed into a run.
 *
 * Per Decision 3 (zero PvP impact): the stat/vital clamps are PORTED from
 * api/pvp/session.ts (clampStatsObject / hydrateCharacterFromSave, which are private), and
 * only the already-exported sanitizers are imported — the live PvP path is untouched.
 */
const session_js_1 = require("../pvp/session.js");
const MAX_STAT = 2500; // matches api/pvp/session.ts SESSION_MAX_STAT
const STAT_FIELDS = [
    'taijutsuOffense', 'taijutsuDefense', 'bukijutsuOffense', 'bukijutsuDefense',
    'ninjutsuOffense', 'ninjutsuDefense', 'genjutsuOffense', 'genjutsuDefense',
    'strength', 'speed', 'intelligence', 'willpower',
];
const SPECIALTIES = ['Taijutsu', 'Bukijutsu', 'Genjutsu', 'Ninjutsu'];
function clampNum(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(max, Math.max(min, n));
}
/** Seal a stored save character into a combat-safe snapshot for a tower run. */
function sealTowerFighter(saveChar) {
    const src = (saveChar.stats && typeof saveChar.stats === 'object') ? saveChar.stats : {};
    const stats = {};
    for (const f of STAT_FIELDS)
        stats[f] = clampNum(src[f], 0, MAX_STAT, 0);
    const sealed = {
        ...saveChar,
        stats,
        maxHp: clampNum(saveChar.maxHp, 1, 10000, 100),
        maxChakra: clampNum(saveChar.maxChakra, 0, 5000, 50),
        maxStamina: clampNum(saveChar.maxStamina, 0, 5000, 50),
        bloodlineMult: clampNum(saveChar.bloodlineMult, 1, 3, 1),
        armorFactor: clampNum(saveChar.armorFactor, 0.25, 1, 1),
        armorRawDR: clampNum(saveChar.armorRawDR, 0, 1.5, 0),
        itemDamagePct: clampNum(saveChar.itemDamagePct, 0, 200, 0),
        jutsu: (0, session_js_1.sanitizeJutsuList)(saveChar.jutsu),
        pvpItems: (0, session_js_1.sanitizePvpItems)(saveChar.pvpItems),
        specialty: SPECIALTIES.includes(String(saveChar.specialty)) ? saveChar.specialty : 'Taijutsu',
    };
    // Strip currencies / inventory / journals / battleTower ledgers — the snapshot is sealed
    // into a server session that the client polls; nothing economic should ride along.
    return (0, session_js_1.stripNonCombatFields)(sealed);
}
