"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_MERC = exports.ROLE_VILLAGER = exports.ROLE_ANBU = exports.ROLE_ELDER = exports.ROLE_KAGE = void 0;
exports.sectorWarRoleOf = sectorWarRoleOf;
exports.sectorControlSwing = sectorControlSwing;
const _storage_js_1 = require("./_storage.js");
exports.ROLE_KAGE = { win: 30, loss: 50 };
exports.ROLE_ELDER = { win: 20, loss: 20 };
exports.ROLE_ANBU = { win: 15, loss: 0 };
exports.ROLE_VILLAGER = { win: 5, loss: 0 };
// An AI mercenary fights as rank-and-file: a villager's chip, nothing lost when it falls.
exports.ROLE_MERC = exports.ROLE_VILLAGER;
const VILLAGE_STATE_PREFIX = 'game:village-state:';
function villageStateKey(village) {
    return `${VILLAGE_STATE_PREFIX}${village.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}
/** Resolve a player's sector-war role weights from authoritative server state.
 *  Kage = the village's seated Kage (or a "kage" rank title); Elder = an appointed
 *  village-Elder seat; ANBU = an appointed ANBU (or an "anbu" title); everyone else
 *  fights as a villager. Never throws — falls back to villager on any miss. */
async function sectorWarRoleOf(playerName) {
    try {
        const name = String(playerName ?? '').trim().toLowerCase();
        if (!name)
            return exports.ROLE_VILLAGER;
        const save = await _storage_js_1.kv.get(`save:${name}`);
        const ch = save?.character;
        if (!ch)
            return exports.ROLE_VILLAGER;
        const title = `${ch.rankTitle ?? ''} ${ch.storyTitle ?? ''}`.toLowerCase();
        const village = String(ch.village ?? '');
        const vs = village ? await _storage_js_1.kv.get(villageStateKey(village)) : null;
        if (vs?.seatedKage?.trim().toLowerCase() === name || title.includes('kage'))
            return exports.ROLE_KAGE;
        if (title.includes('first elder') || title.includes('second elder') || title.includes('third elder') || title.includes('village elder'))
            return exports.ROLE_ELDER;
        const anbu = Array.isArray(vs?.anbuAppointees) && vs.anbuAppointees.some((a) => String(a).trim().toLowerCase() === name);
        if (anbu || title.includes('anbu'))
            return exports.ROLE_ANBU;
        return exports.ROLE_VILLAGER;
    }
    catch {
        return exports.ROLE_VILLAGER;
    }
}
/** The Control-HP swing for one resolved fight: the winner's contribution plus the
 *  loser's rank penalty, scaled by the attacker village's War-Academy multiplier.
 *  Always ≥ 1 so a fight is never a no-op. Pure. */
function sectorControlSwing(winner, loser, academyMult = 1) {
    return Math.max(1, Math.round((winner.win + loser.loss) * academyMult));
}
