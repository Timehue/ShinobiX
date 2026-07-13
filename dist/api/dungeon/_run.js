"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DUNGEON_MIN_RUN_MS = exports.DUNGEON_RELIC_ID = exports.DUNGEON_KEY_ID = void 0;
exports.mutateDungeonRun = mutateDungeonRun;
exports.DUNGEON_KEY_ID = 'dungeon-key';
exports.DUNGEON_RELIC_ID = 'dungeon-legendary-relic';
exports.DUNGEON_MIN_RUN_MS = 30_000;
function removeOne(character, itemId) {
    let removed = false;
    const inventory = (Array.isArray(character.inventory) ? character.inventory : []).filter((id) => {
        if (!removed && id === itemId) {
            removed = true;
            return false;
        }
        return true;
    });
    const itemStacks = (Array.isArray(character.itemStacks) ? character.itemStacks : []).flatMap((raw) => {
        if (!raw || typeof raw !== 'object')
            return [];
        const row = raw;
        const id = String(row.itemId ?? '');
        const count = Math.max(0, Math.floor(Number(row.count) || 0));
        if (!id || count <= 0)
            return [];
        if (!removed && id === itemId) {
            removed = true;
            return count > 1 ? [{ itemId: id, count: count - 1 }] : [];
        }
        return [{ itemId: id, count }];
    });
    return removed ? { inventory, itemStacks } : null;
}
function mutateDungeonRun(character, actionRaw, tokenRaw, issuedToken, now = Date.now()) {
    const action = typeof actionRaw === 'string' ? actionRaw : '';
    const token = typeof tokenRaw === 'string' ? tokenRaw.slice(0, 80) : '';
    const active = character.activeDungeonRun && typeof character.activeDungeonRun === 'object' ? character.activeDungeonRun : null;
    const receipts = Array.isArray(character.redeemedDungeonRuns) ? character.redeemedDungeonRuns.filter((id) => typeof id === 'string').slice(-63) : [];
    if (action === 'start') {
        if (active?.token)
            return { ok: true, alreadyApplied: true, token: String(active.token), character };
        const removed = removeOne(character, exports.DUNGEON_KEY_ID);
        if (!removed)
            return { ok: false, reason: 'dungeon-key-required' };
        return { ok: true, alreadyApplied: false, token: issuedToken, character: { ...character, ...removed, activeDungeonRun: { token: issuedToken, startedAt: now } } };
    }
    if (receipts.includes(token))
        return { ok: true, alreadyApplied: true, token, character };
    if (!active || !token || String(active.token) !== token)
        return { ok: false, reason: 'invalid-dungeon-run' };
    if (action === 'abandon')
        return { ok: true, alreadyApplied: false, token, character: { ...character, activeDungeonRun: null } };
    if (action !== 'settle')
        return { ok: false, reason: 'invalid-dungeon-action' };
    if (now - Math.max(0, Number(active.startedAt) || 0) < exports.DUNGEON_MIN_RUN_MS)
        return { ok: false, reason: 'dungeon-run-too-short' };
    const inventory = Array.isArray(character.inventory) ? [...character.inventory] : [];
    inventory.push(exports.DUNGEON_RELIC_ID);
    return { ok: true, alreadyApplied: false, token, character: {
            ...character, activeDungeonRun: null, redeemedDungeonRuns: [...receipts, token], inventory,
            boneCharms: Math.max(0, Math.floor(Number(character.boneCharms) || 0)) + 10,
            auraStones: Math.max(0, Math.floor(Number(character.auraStones) || 0)) + 5,
            fateShards: Math.max(0, Math.floor(Number(character.fateShards) || 0)) + 5,
            totalPetWins: Math.max(0, Math.floor(Number(character.totalPetWins) || 0)) + 1,
        } };
}
