"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clampTowerLoadout = clampTowerLoadout;
exports.sealTowerFighter = sealTowerFighter;
exports.sealTowerItemCharges = sealTowerItemCharges;
/*
 * Battle Towers — combat-snapshot sealing (Phase 1, P1.B).
 *
 * Turns a player's stored SAVE into a combat-safe TowerActor character. This now
 * delegates to the EXACT PvP hydrator (api/pvp/session.ts hydrateCharacterFromSave) so a
 * tower fighter is sealed identically to a PvP fighter:
 *   - the equipped jutsu loadout is RESOLVED from `equippedJutsuIds` against the jutsu
 *     catalog + the save's own bloodlines/creator jutsu (the persisted Character has NO
 *     ready-made `jutsu` array — it stores equipped IDs — so the old direct
 *     `sanitizeJutsuList(saveChar.jutsu)` always produced an EMPTY loadout: the empty
 *     jutsu-bar bug);
 *   - jutsuMastery, the four named-armor passives (itemAbsorb/Reflect/LifeSteal/Shield),
 *     bloodlineMult, armorFactor/armorRawDR, itemDamagePct, stats + vitals are all sealed
 *     and clamped to the game's hard caps (defense-in-depth: a borrowed ally can edit
 *     their own save);
 *   - non-combat / economic fields are stripped.
 *
 * Per Decision 3 (zero PvP impact): we REUSE the already-exported PvP helpers; the live
 * PvP path is untouched. The full save record (not just `.character`) is required so the
 * loadout resolver can reach savedBloodlines / creatorJutsus.
 */
const session_js_1 = require("../pvp/session.js");
const SPECIALTIES = ['Taijutsu', 'Bukijutsu', 'Genjutsu', 'Ninjutsu'];
function clampN(v, min, max, fb) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb;
}
/**
 * Clamp just the client-computed combat extras (pvpItems + equipment passives) a JOINING
 * squad member supplies — to the SAME bounds hydrateCharacterFromSave uses — so they can be
 * merged onto an already-sealed actor mid-run (api/towers/join.ts) without touching the
 * server-authoritative stats / jutsu / vitals / itemCharges. Only present fields are returned.
 */
function clampTowerLoadout(loadout) {
    const out = {};
    if (loadout.pvpItems !== undefined)
        out.pvpItems = (0, session_js_1.sanitizePvpItems)(loadout.pvpItems);
    if (loadout.bloodlineMult !== undefined)
        out.bloodlineMult = clampN(loadout.bloodlineMult, 1, 3, 1);
    if (loadout.armorFactor !== undefined)
        out.armorFactor = clampN(loadout.armorFactor, 0.25, 1, 1);
    if (loadout.armorRawDR !== undefined)
        out.armorRawDR = clampN(loadout.armorRawDR, 0, 1.5, 0);
    if (loadout.itemDamagePct !== undefined)
        out.itemDamagePct = clampN(loadout.itemDamagePct, 0, 200, 0);
    if (loadout.itemAbsorbPct !== undefined)
        out.itemAbsorbPct = clampN(loadout.itemAbsorbPct, 0, 100, 0);
    if (loadout.itemReflectPct !== undefined)
        out.itemReflectPct = clampN(loadout.itemReflectPct, 0, 100, 0);
    if (loadout.itemLifeStealPct !== undefined)
        out.itemLifeStealPct = clampN(loadout.itemLifeStealPct, 0, 100, 0);
    if (loadout.itemShield !== undefined)
        out.itemShield = clampN(loadout.itemShield, 0, 5000, 0);
    return out;
}
/**
 * Seal a stored save into a combat-safe tower fighter character.
 * @param saveChar the save's `.character` object (stats / equippedJutsuIds / equipment / …)
 * @param save     the FULL save record (carries savedBloodlines + creatorJutsus for loadout
 *                 resolution); pass null only for synthetic/test characters.
 * @param clientChar OPTIONAL client-computed combat fields the SAVE does not persist —
 *                 `pvpItems` (equipped weapons/consumables) + the equipment-derived passives
 *                 (bloodlineMult / armorFactor / armorRawDR / itemDamagePct / item*Pct /
 *                 itemShield). These are built client-side at fight time exactly like PvP
 *                 (getPvpItemLoadout / getCharacterArmorFactor / …), so the host sends them.
 *                 hydrateCharacterFromSave prefers the save and only falls back to these for
 *                 the missing fields, then CLAMPS every one — same trust model as a PvP fighter.
 */
function sealTowerFighter(saveChar, save = null, clientChar = {}) {
    const hydrated = (0, session_js_1.hydrateCharacterFromSave)(saveChar, clientChar, save);
    // hydrate spreads the save's specialty verbatim; the engine defaults an invalid one at
    // use, but clamp it here too so the sealed snapshot's contract stays clean.
    const sp = String(hydrated.specialty ?? 'Taijutsu');
    hydrated.specialty = SPECIALTIES.includes(sp) ? hydrated.specialty : 'Taijutsu';
    return hydrated;
}
/**
 * Seal the per-fight consumable budget (thrown / combat-item / potion charges) from the
 * raw save character — reusing PvP's sealItemCharges. Reads the equipment slot→id map and
 * caps each charge by how many the player actually owns (the potion's 2/fight cap is the
 * sealed starting charge). The engine spends against this deterministically.
 */
function sealTowerItemCharges(saveChar) {
    return (0, session_js_1.sealItemCharges)(saveChar, saveChar);
}
