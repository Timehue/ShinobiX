"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadPool = loadPool;
exports.savePool = savePool;
const _storage_js_1 = require("../../_storage.js");
const MAX_LOG_ENTRIES = 50;
function poolKey(clanName) {
    return `clan-seal-pool:${clanName.toLowerCase()}`;
}
async function loadPool(clanName) {
    const existing = await _storage_js_1.kv.get(poolKey(clanName));
    if (existing)
        return existing;
    return { clanName, balance: 0, log: [] };
}
async function savePool(pool) {
    const trimmed = {
        ...pool,
        log: pool.log.slice(0, MAX_LOG_ENTRIES),
    };
    await _storage_js_1.kv.set(poolKey(pool.clanName), trimmed);
}
