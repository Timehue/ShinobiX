"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOLLOW_GATE_ATTUNEMENT_NODES = void 0;
exports.buyHollowGateAttunement = buyHollowGateAttunement;
exports.HOLLOW_GATE_ATTUNEMENT_NODES = {
    'seasoned-delver': { baseCost: 30, maxRank: 2 },
    'reiki-reserves': { baseCost: 30, maxRank: 2 },
    cartographer: { baseCost: 40, maxRank: 1 },
    'greedy-hands': { baseCost: 45, maxRank: 3 },
    'extra-dive': { baseCost: 120, maxRank: 1 },
    'key-forge': { baseCost: 150, maxRank: 1 },
};
const whole = (value) => Math.max(0, Math.floor(Number(value) || 0));
function buyHollowGateAttunement(character, idRaw) {
    const id = String(idRaw ?? '');
    const node = exports.HOLLOW_GATE_ATTUNEMENT_NODES[id];
    if (!node)
        return { ok: false, status: 400, error: 'Unknown Hollow Gate attunement.' };
    const ranks = character.hollowGateAttunement && typeof character.hollowGateAttunement === 'object'
        ? character.hollowGateAttunement
        : {};
    const rank = Math.min(node.maxRank, whole(ranks[id]));
    if (rank >= node.maxRank)
        return { ok: false, status: 409, error: 'Already at maximum rank.' };
    const cost = node.baseCost * (rank + 1);
    const shards = whole(character.hollowShards);
    if (shards < cost)
        return { ok: false, status: 409, error: 'Not enough Hollow Shards.' };
    return {
        ok: true,
        character: {
            ...character,
            hollowShards: shards - cost,
            hollowGateAttunement: { ...ranks, [id]: rank + 1 },
        },
        cost,
        rank: rank + 1,
    };
}
