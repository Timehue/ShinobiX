"use strict";
/*
 * Village War Map — the read-only view assembly for the client War-Map panel
 * (Phase 6, pure). Given a village's war record + its treasury seal balance + how
 * many sectors it currently holds, produce the display shape the UI needs: WR/seal
 * pools, structure levels + daily upkeep + dormancy, the Supply-Depot WR rate, the
 * effective tax tier, and each home sector's win-condition / terrain / Control-HP
 * cap. IO-free — the endpoint (api/village/war-map.ts) does the reads and the
 * territory/contest scans, then calls this per village.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WAR_MAP_STRUCTURE_KEYS = void 0;
exports.villageWarMapView = villageWarMapView;
const _war_economy_js_1 = require("./_war-economy.js");
const _war_state_js_1 = require("./_war-state.js");
const _war_structures_js_1 = require("./_war-structures.js");
const _war_map_sectors_js_1 = require("./_war-map-sectors.js");
function round2(n) {
    return Math.round(n * 100) / 100;
}
/** Assemble one village's War-Map view from its (already-normalized) war record,
 *  treasury seal balance, and current held-sector count. Pure. */
function villageWarMapView(args) {
    const { village, record } = args;
    const treasurySeals = Math.max(0, Math.floor(Number(args.treasurySeals) || 0));
    const sectorsHeld = Math.max(0, Math.floor(Number(args.sectorsHeld) || 0));
    const biome = (0, _war_map_sectors_js_1.isWarVillage)(village) ? _war_map_sectors_js_1.VILLAGE_BIOME[village] : 'central';
    const home = (0, _war_map_sectors_js_1.homeSectorsForVillage)(village);
    const controlHpMax = (0, _war_structures_js_1.sectorControlHpMax)(record);
    const sectors = home.map((s) => {
        const cfg = record.sectors[String(s)];
        return {
            sector: s,
            alias: (0, _war_map_sectors_js_1.sectorAlias)(s),
            winCondition: cfg?.winCondition ?? 'combat',
            terrain: cfg?.terrain ?? biome,
            controlHpMax,
        };
    });
    const taxRatePct = round2((0, _war_economy_js_1.taxRateForSectors)(sectorsHeld) * (0, _war_structures_js_1.taxRateMultiplier)(record) * 100);
    return {
        village,
        biome,
        homeSectors: [...home],
        warResources: record.warResources,
        warResourcesCap: _war_economy_js_1.WR_POOL_CAP,
        treasurySeals,
        structures: { ...record.structures },
        upkeepWr: (0, _war_state_js_1.totalUpkeepWr)(record),
        dormant: record.dormant,
        wrPerSector: round2((0, _war_structures_js_1.wrPerSector)(record)),
        sectorsHeld,
        taxRatePct,
        sectors,
    };
}
/** The structure keys, in display order, for the client (mirror of STRUCTURE_KEYS). */
exports.WAR_MAP_STRUCTURE_KEYS = _war_state_js_1.STRUCTURE_KEYS;
