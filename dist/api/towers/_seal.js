"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
/**
 * Seal a stored save into a combat-safe tower fighter character.
 * @param saveChar the save's `.character` object (stats / equippedJutsuIds / equipment / …)
 * @param save     the FULL save record (carries savedBloodlines + creatorJutsus for loadout
 *                 resolution); pass null only for synthetic/test characters.
 */
function sealTowerFighter(saveChar, save = null) {
    // No client payload — the tower is server-authoritative; the save IS the source of truth.
    const hydrated = (0, session_js_1.hydrateCharacterFromSave)(saveChar, {}, save);
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
