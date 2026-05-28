"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFER_TTL_S = void 0;
exports.offerEscort = offerEscort;
exports.cancelEscort = cancelEscort;
exports.listActiveEscorters = listActiveEscorters;
const _storage_js_1 = require("../../_storage.js");
// Clan pet-escort offers. Each active offer is a single KV key with a 1h TTL
// so offers naturally expire if the Pet Tamer doesn't refresh. Storage shape
// is minimal — the key itself encodes clan + Pet Tamer; the value is just a
// timestamp for display.
exports.OFFER_TTL_S = 60 * 60;
function escortKey(clanName, petTamerName) {
    return `clan-pet-escort:${clanName.toLowerCase()}:${petTamerName.toLowerCase()}`;
}
function escortPrefix(clanName) {
    return `clan-pet-escort:${clanName.toLowerCase()}:`;
}
async function offerEscort(clanName, petTamerName) {
    await _storage_js_1.kv.set(escortKey(clanName, petTamerName), { offeredAt: Date.now() }, { ex: exports.OFFER_TTL_S });
}
async function cancelEscort(clanName, petTamerName) {
    await _storage_js_1.kv.del(escortKey(clanName, petTamerName));
}
// Returns the names of Pet Tamers currently offering escort to this clan.
// Verifies that each offerer is still actually in this clan (handles the
// case where a Pet Tamer left clan A and joined clan B — their stale A
// offer would otherwise still fire for A's Vanguards).
async function listActiveEscorters(clanName) {
    try {
        const keys = await _storage_js_1.kv.keys(`${escortPrefix(clanName)}*`);
        const prefix = escortPrefix(clanName);
        const candidateNames = keys.map(k => k.slice(prefix.length)).filter(Boolean);
        if (candidateNames.length === 0)
            return [];
        // Cross-check each candidate's current clan membership. Stale offers
        // are best-effort deleted so they don't keep wasting lookup cost.
        const records = await _storage_js_1.kv.mget(...candidateNames.map(n => `save:${n.toLowerCase()}`));
        const valid = [];
        await Promise.all(candidateNames.map(async (name, i) => {
            const r = records[i];
            const c = r?.character;
            const currentClan = typeof c?.clan === 'string' ? c.clan : '';
            if (currentClan.toLowerCase() === clanName.toLowerCase()) {
                valid.push(name);
            }
            else {
                // Best-effort cleanup of the stale offer.
                try {
                    await _storage_js_1.kv.del(escortKey(clanName, name));
                }
                catch { /* ignore */ }
            }
        }));
        return valid;
    }
    catch {
        return [];
    }
}
