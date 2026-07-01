"use strict";
/*
 * Village War Map — the per-village war-state record schema, defaults, and
 * normalizer (Phase 0, pure). Stored at `shared:village-war:<slug>` once wired:
 * the village's WR pool, its 6 structures, its 8 home sectors (each with a
 * win-condition, terrain, and Control HP), dormancy, mercenary leases, and the
 * daily-pass stamp. Plan §7, §8, §17.
 *
 * IO-free; nothing reads/writes this yet (villageWarMap.v1 OFF). The normalizer
 * is the load-bearing piece — it fills missing home sectors, clamps every value,
 * and enforces the max-7-per-win-condition diversity rule on read.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TERRAIN_QUOTA_ELDER = exports.TERRAIN_QUOTA_KAGE = exports.SECTOR_CONTROL_HP_DEFENDER_REGEN = exports.SECTOR_CONTROL_HP_PER_WIN = exports.SECTOR_CONTROL_HP_MAX = exports.TERRAINS = exports.STRUCTURE_KEYS = exports.MAX_SECTORS_PER_WIN_CONDITION = exports.WIN_CONDITIONS = void 0;
exports.defaultVillageWarRecord = defaultVillageWarRecord;
exports.normalizeVillageWarRecord = normalizeVillageWarRecord;
exports.winConditionCounts = winConditionCounts;
exports.canAssignWinCondition = canAssignWinCondition;
exports.terrainSetCountFor = terrainSetCountFor;
exports.canSetTerrain = canSetTerrain;
exports.activeMercLeases = activeMercLeases;
exports.totalUpkeepWr = totalUpkeepWr;
exports.villageWarSlug = villageWarSlug;
exports.villageWarKey = villageWarKey;
exports.stepVillageWarDay = stepVillageWarDay;
const _war_economy_js_1 = require("./_war-economy.js");
const _war_map_sectors_js_1 = require("./_war-map-sectors.js");
exports.WIN_CONDITIONS = ['combat', 'card', 'pet'];
/** Diversity rule (§17.2): no single win-condition on more than 7 of 8 sectors. */
exports.MAX_SECTORS_PER_WIN_CONDITION = 7;
exports.STRUCTURE_KEYS = [
    'ramparts', 'watchtower', 'barracks', 'warAcademy', 'supplyDepot', 'treasuryVault',
];
exports.TERRAINS = ['forest', 'snow', 'volcano', 'shadow', 'central'];
// §17.6 — a sector's hold. Sized as a "shorter village war": at a village-wide
// ~20-30 fights/hour it takes a day or two of sustained pressure to drain a fully
// held sector, since each fight only moves it by a role-scaled swing (api/_war-role
// sectorControlSwing) — NOT a flat chunk. Watchtower raises this cap.
exports.SECTOR_CONTROL_HP_MAX = 2000;
// Legacy flat tuning — retained for back-compat/imports; the live model is the
// role-scaled swing (api/_war-role) applied by each win-condition resolve.
exports.SECTOR_CONTROL_HP_PER_WIN = 150;
exports.SECTOR_CONTROL_HP_DEFENDER_REGEN = 50;
// Terrain-pick quota (§17.3): the Kage may set 3 sectors' terrain, each elder 1.
exports.TERRAIN_QUOTA_KAGE = 3;
exports.TERRAIN_QUOTA_ELDER = 1;
function clampInt(n, lo, hi) {
    const v = Math.floor(Number(n) || 0);
    return Math.max(lo, Math.min(hi, v));
}
function asWinCondition(v) {
    return exports.WIN_CONDITIONS.includes(v) ? v : 'combat';
}
function asTerrain(v, fallback) {
    return exports.TERRAINS.includes(v) ? v : fallback;
}
/** A fresh war-state for a village: empty WR, all structures L0, every home
 *  sector secure (full Control HP), biome terrain. Win-conditions default to a
 *  valid, diverse spread that alternates Combat / Pet (4 each) — Pet's server
 *  sim is now wired (api/village/sector-pet), so it is a first-class default.
 *  Card remains a Kage-selectable option but is not a default. The max-7
 *  per-type diversity rule holds from the start. */
function defaultVillageWarRecord(village) {
    const biome = (0, _war_map_sectors_js_1.isWarVillage)(village) ? _war_map_sectors_js_1.VILLAGE_BIOME[village] : 'central';
    const structures = Object.fromEntries(exports.STRUCTURE_KEYS.map((k) => [k, 0]));
    const sectors = {};
    const home = _war_map_sectors_js_1.HOME_SECTORS[village] ?? [];
    home.forEach((s, i) => {
        sectors[String(s)] = {
            winCondition: i % 2 === 0 ? 'combat' : 'pet',
            terrain: biome,
            controlHp: exports.SECTOR_CONTROL_HP_MAX,
        };
    });
    return { warResources: 0, structures, sectors, mercLeases: [], dormant: false, lastWarPassDate: '', terrainSetBy: {} };
}
/** Normalize a raw record from storage: clamp every value into range, ensure all
 *  of the village's home sectors are present (filling any missing), drop unknown
 *  sectors/structures, and dedupe merc leases. Pure. */
function normalizeVillageWarRecord(village, raw) {
    const base = defaultVillageWarRecord(village);
    if (!raw || typeof raw !== 'object')
        return base;
    base.warResources = clampInt(raw.warResources, 0, _war_economy_js_1.WR_POOL_CAP);
    base.dormant = raw.dormant === true;
    base.lastWarPassDate = typeof raw.lastWarPassDate === 'string' ? raw.lastWarPassDate.slice(0, 10) : '';
    if (raw.structures && typeof raw.structures === 'object') {
        for (const k of exports.STRUCTURE_KEYS) {
            base.structures[k] = clampInt(raw.structures[k], 0, _war_economy_js_1.VILLAGE_STRUCTURE_MAX_LEVEL);
        }
    }
    // Only the village's own home sectors are tracked; fill defaults, clamp present.
    if (raw.sectors && typeof raw.sectors === 'object') {
        for (const key of Object.keys(base.sectors)) {
            const r = raw.sectors[key];
            if (!r || typeof r !== 'object')
                continue;
            base.sectors[key] = {
                winCondition: asWinCondition(r.winCondition),
                terrain: asTerrain(r.terrain, base.sectors[key].terrain),
                controlHp: clampInt(r.controlHp, 0, exports.SECTOR_CONTROL_HP_MAX),
            };
        }
    }
    if (Array.isArray(raw.mercLeases)) {
        const seen = new Set();
        for (const l of raw.mercLeases) {
            if (!l || typeof l !== 'object')
                continue;
            const tierId = String(l.tierId ?? '');
            const player = String(l.player ?? '');
            const expiresAt = Math.floor(Number(l.expiresAt) || 0);
            if (!tierId || !player || expiresAt <= 0)
                continue;
            const dedupeKey = `${tierId}:${player}`;
            if (seen.has(dedupeKey))
                continue;
            seen.add(dedupeKey);
            const count = clampInt(l.count ?? (0, _war_economy_js_1.mercBandSize)(tierId), 0, _war_economy_js_1.MERC_BAND_MAX);
            base.mercLeases.push({ tierId, player, expiresAt, count });
        }
    }
    if (raw.terrainSetBy && typeof raw.terrainSetBy === 'object') {
        for (const key of Object.keys(base.sectors)) {
            const p = raw.terrainSetBy[key];
            if (typeof p === 'string' && p)
                base.terrainSetBy[key] = p;
        }
    }
    return base;
}
/** Count how many sectors use each win-condition. */
function winConditionCounts(record) {
    const counts = { combat: 0, card: 0, pet: 0 };
    for (const s of Object.values(record.sectors))
        counts[s.winCondition]++;
    return counts;
}
/** Whether `sector` may be (re)assigned to `wc` without breaking the max-7 rule.
 *  Re-assigning a sector already on `wc` is always allowed (no-op). */
function canAssignWinCondition(record, sector, wc) {
    const cur = record.sectors[String(Math.floor(Number(sector) || 0))];
    if (!cur)
        return false; // not a home sector of this village
    if (cur.winCondition === wc)
        return true;
    return winConditionCounts(record)[wc] < exports.MAX_SECTORS_PER_WIN_CONDITION;
}
/** How many sectors' terrain a given player currently owns the pick for. */
function terrainSetCountFor(record, player) {
    return Object.values(record.terrainSetBy).filter((p) => p === player).length;
}
/** Whether `player` (acting as `role`) may set `sector`'s terrain under the
 *  §17.3 quota: Kage 3 / elder 1. Re-setting a sector you already own is free; an
 *  elder cannot override a sector another leader picked; the Kage may override. */
function canSetTerrain(record, sector, player, role) {
    if (role === 'none')
        return { ok: false, error: 'not-authorized' };
    const key = String(Math.floor(Number(sector) || 0));
    if (!record.sectors[key])
        return { ok: false, error: 'not-home-sector' };
    const current = record.terrainSetBy[key];
    if (current && current !== player && role !== 'kage')
        return { ok: false, error: 'set-by-another' };
    const alreadyMine = current === player;
    const limit = role === 'kage' ? exports.TERRAIN_QUOTA_KAGE : exports.TERRAIN_QUOTA_ELDER;
    if (!alreadyMine && terrainSetCountFor(record, player) >= limit)
        return { ok: false, error: 'quota-reached' };
    return { ok: true };
}
/** Merc leases that have not yet expired at `now` (epoch ms). */
function activeMercLeases(record, now) {
    return record.mercLeases.filter((l) => l.expiresAt > now);
}
/** Total daily WR upkeep across the village's structures (raw, by level). */
function totalUpkeepWr(record) {
    let sum = 0;
    for (const k of exports.STRUCTURE_KEYS)
        sum += (0, _war_economy_js_1.structureMaintenanceWr)(record.structures[k]);
    return sum;
}
// ── Storage key ──
/** Slug used for the war-state key (matches the village-treasury slug shape). */
function villageWarSlug(village) {
    return String(village).toLowerCase().replace(/[^a-z0-9]/g, '');
}
function villageWarKey(village) {
    return `shared:village-war:${villageWarSlug(village)}`;
}
/** Pure one-day step for a village's war state (§8.1): accrue WR for the sectors
 *  it currently holds (capped), pay structure upkeep if affordable — else mothball
 *  the structures (dormant, no cost, no bonus, WR retained to recover) — expire
 *  merc leases, and stamp the day. Idempotent: a same-day re-run is a no-op.
 *  `sectorsControlled` is supplied by the caller (Phase 1 = home count; later it
 *  includes captures/occupation). */
function stepVillageWarDay(record, opts) {
    const sectors = Math.max(0, Math.floor(Number(opts.sectorsControlled) || 0));
    const idle = {
        ran: false, wrAccrued: 0, maintenanceOwed: totalUpkeepWr(record), maintenancePaid: 0,
        dormant: record.dormant, mercsExpired: 0, sectorsControlled: sectors,
    };
    if (record.lastWarPassDate === opts.today)
        return { record, summary: idle };
    const next = {
        ...record,
        structures: { ...record.structures },
        sectors: { ...record.sectors },
        mercLeases: [...record.mercLeases],
    };
    // WR income: caller may pass a Supply-Depot-boosted per-sector rate
    // (api/_war-structures.ts wrPerSector); default is the flat §6.1 rate.
    const perSector = Number(opts.wrPerSector);
    const wrAccrued = Number.isFinite(perSector)
        ? Math.floor(Math.max(0, perSector) * sectors)
        : (0, _war_economy_js_1.sectorBenefitWr)(sectors);
    let pool = Math.min(_war_economy_js_1.WR_POOL_CAP, next.warResources + wrAccrued);
    const owed = totalUpkeepWr(next);
    let paid = 0;
    let dormant = false;
    if (owed > 0) {
        if (pool >= owed) {
            pool -= owed;
            paid = owed;
        }
        else {
            dormant = true;
        } // mothballed: keep WR, suspend bonuses until affordable
    }
    next.warResources = pool;
    next.dormant = dormant;
    const before = next.mercLeases.length;
    next.mercLeases = activeMercLeases(next, opts.now);
    const mercsExpired = before - next.mercLeases.length;
    next.lastWarPassDate = opts.today;
    return {
        record: next,
        summary: { ran: true, wrAccrued, maintenanceOwed: owed, maintenancePaid: paid, dormant, mercsExpired, sectorsControlled: sectors },
    };
}
