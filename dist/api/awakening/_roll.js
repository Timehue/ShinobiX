"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AWAKENING_FREE_LV20_ID = exports.AWAKENING_FREE_LV2_ID = exports.AWAKENING_ELEMENTS = void 0;
exports.rollAwakening = rollAwakening;
exports.AWAKENING_ELEMENTS = ['Water', 'Wind', 'Earth', 'Lightning', 'Fire'];
exports.AWAKENING_FREE_LV2_ID = 'awakening-free-lv2';
exports.AWAKENING_FREE_LV20_ID = 'awakening-free-lv20';
function currentElements(character) {
    const raw = [...(Array.isArray(character.elements) ? character.elements : []), character.element];
    return [...new Set(raw.filter((v) => typeof v === 'string' && exports.AWAKENING_ELEMENTS.includes(v)))];
}
function pick(pool, randomIndex) {
    return pool[Math.max(0, Math.min(pool.length - 1, Math.floor(randomIndex(pool.length))))] ?? exports.AWAKENING_ELEMENTS[0];
}
function rollAwakening(character, kindRaw, actionIdRaw, randomIndex = (max) => Math.floor(Math.random() * max)) {
    const kind = typeof kindRaw === 'string' ? kindRaw : '';
    const actionId = typeof actionIdRaw === 'string' ? actionIdRaw.trim().slice(0, 80) : '';
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(actionId))
        return { ok: false, reason: 'invalid-action-id' };
    const receipts = Array.isArray(character.redeemedAwakeningActions)
        ? character.redeemedAwakeningActions.filter((id) => typeof id === 'string').slice(-63) : [];
    if (receipts.includes(actionId))
        return { ok: true, alreadyApplied: true, character };
    const claimed = Array.isArray(character.claimedAwakenings)
        ? character.claimedAwakenings.filter((id) => typeof id === 'string') : [];
    const owned = currentElements(character);
    let next;
    let nextClaimed = claimed;
    let fateShards = Math.max(0, Math.floor(Number(character.fateShards) || 0));
    if (kind === exports.AWAKENING_FREE_LV2_ID || kind === exports.AWAKENING_FREE_LV20_ID) {
        const requiredLevel = kind === exports.AWAKENING_FREE_LV2_ID ? 2 : 20;
        if (Math.max(1, Math.floor(Number(character.level) || 1)) < requiredLevel)
            return { ok: false, reason: 'awakening-level-required' };
        if (claimed.includes(kind))
            return { ok: true, alreadyApplied: true, character };
        const available = exports.AWAKENING_ELEMENTS.filter((element) => !owned.includes(element));
        next = [...new Set([...owned, pick(available.length ? available : exports.AWAKENING_ELEMENTS, randomIndex)])];
        nextClaimed = [...claimed, kind];
    }
    else if (kind === 'paid') {
        if (fateShards < 10)
            return { ok: false, reason: 'insufficient-fate-shards' };
        const count = Math.max(1, Math.min(exports.AWAKENING_ELEMENTS.length, owned.length));
        const pool = [...exports.AWAKENING_ELEMENTS];
        next = [];
        while (next.length < count) {
            const element = pick(pool, randomIndex);
            next.push(element);
            pool.splice(pool.indexOf(element), 1);
        }
        fateShards -= 10;
    }
    else
        return { ok: false, reason: 'invalid-awakening-kind' };
    return { ok: true, alreadyApplied: false, character: { ...character, element: next[0], elements: next, fateShards, claimedAwakenings: nextClaimed, redeemedAwakeningActions: [...receipts, actionId] } };
}
