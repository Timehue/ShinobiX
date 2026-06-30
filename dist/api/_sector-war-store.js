"use strict";
/*
 * Village War Map — sector-war IO glue (Phase 4c).
 *
 * Thin persistence primitives for the two record families the sector-war loop
 * uses, on top of the pure model in `_sector-war.ts`:
 *   - the contest:  `shared:sector-war:<id>`        (the Control-HP siege state)
 *   - the token:    `shared:sector-war-token:<bid>` (single-use battle authorization)
 *
 * All orchestration (locks, WR debit, the territory flip) lives in the endpoint
 * `api/village/sector-war.ts`; this file only reads/writes the records. Behind
 * ENABLE_VILLAGE_WAR via its only caller — nothing imports it on the prod path.
 *
 * Note the prefixes don't collide: a `keys('shared:sector-war:*')` scan matches
 * `shared:sector-war:<id>` but NOT `shared:sector-war-token:<bid>` (the char after
 * `shared:sector-war` is `:` for contests, `-` for tokens).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadSectorWar = loadSectorWar;
exports.saveSectorWar = saveSectorWar;
exports.deleteSectorWar = deleteSectorWar;
exports.listActiveSectorWars = listActiveSectorWars;
exports.activeContestOnSector = activeContestOnSector;
exports.mintSectorWarToken = mintSectorWarToken;
exports.loadSectorWarToken = loadSectorWarToken;
exports.consumeSectorWarToken = consumeSectorWarToken;
exports.getSectorOwnerVillage = getSectorOwnerVillage;
const _storage_js_1 = require("./_storage.js");
const _sector_war_js_1 = require("./_sector-war.js");
const SECTOR_WAR_PREFIX = 'shared:sector-war:';
// Mirror of api/world-state.ts TERRITORY_KEY_PREFIX (module-local there). The
// territory record is the source of truth for `ownerVillage`.
const TERRITORY_KEY_PREFIX = 'world:territory:';
// ── Contest (the Control-HP siege record) ──
async function loadSectorWar(id) {
    const raw = await _storage_js_1.kv.get((0, _sector_war_js_1.sectorWarKey)(id));
    return raw ? (0, _sector_war_js_1.normalizeSectorWarSession)(raw) : null;
}
async function saveSectorWar(session) {
    await _storage_js_1.kv.set((0, _sector_war_js_1.sectorWarKey)(session.id), session);
}
async function deleteSectorWar(id) {
    await _storage_js_1.kv.del((0, _sector_war_js_1.sectorWarKey)(id));
}
/** Every non-flipped contest currently on the board (small scan; mirrors the
 *  territory scan in api/village/claim-map-control.ts). */
async function listActiveSectorWars() {
    const keys = await _storage_js_1.kv.keys(`${SECTOR_WAR_PREFIX}*`);
    if (!keys.length)
        return [];
    const raws = await _storage_js_1.kv.mget(...keys);
    const out = [];
    for (const raw of raws) {
        const s = raw ? (0, _sector_war_js_1.normalizeSectorWarSession)(raw) : null;
        if (s && !s.flipped)
            out.push(s);
    }
    return out;
}
/** The active contest on a given sector, if any (a sector hosts at most one). */
async function activeContestOnSector(sector) {
    const all = await listActiveSectorWars();
    return all.find((s) => s.sector === sector) ?? null;
}
// ── Single-use battle token ──
async function mintSectorWarToken(token) {
    await _storage_js_1.kv.set((0, _sector_war_js_1.sectorWarTokenKey)(token.battleId), token, { ex: Math.ceil(_sector_war_js_1.SECTOR_WAR_TOKEN_TTL_MS / 1000) });
}
async function loadSectorWarToken(battleId) {
    const raw = await _storage_js_1.kv.get((0, _sector_war_js_1.sectorWarTokenKey)(battleId));
    return raw ? (0, _sector_war_js_1.normalizeSectorWarBattleToken)(raw) : null;
}
/** Single-use consumption — delete the token so a battle counts exactly once. */
async function consumeSectorWarToken(battleId) {
    await _storage_js_1.kv.del((0, _sector_war_js_1.sectorWarTokenKey)(battleId));
}
// ── Territory ownership read (source of truth for the declare target) ──
/** The village that currently owns a sector (`''` if unowned/unseeded). */
async function getSectorOwnerVillage(sector) {
    const t = await _storage_js_1.kv.get(`${TERRITORY_KEY_PREFIX}${Math.floor(Number(sector) || 0)}`);
    return String(t?.ownerVillage ?? '').trim();
}
