"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MERC_SNIPE_HP_FRACTION = void 0;
exports.deployOneMerc = deployOneMerc;
exports.pickSnipeTarget = pickSnipeTarget;
exports.runMercAutoDeploy = runMercAutoDeploy;
/*
 * Village-War mercenaries — autonomous deployment (Phase 5 snipe). A frequent cron
 * tick gives active merc bands a life of their own: for each Combat sector a
 * village is besieging, a merc snipes the LOWEST-HP enemy defender currently in
 * that sector (online presence), so mercs "attack whenever / snipe low-HP players"
 * without the Kage hand-deploying each one. All resolution is server-authoritative
 * (resolveMercBattle via the towers engine) — the same path the manual deploy uses.
 *
 * Server-gated: a no-op unless ENABLE_VILLAGE_WAR=1. Shares the deployOneMerc core
 * with /api/village/war-merc so the two never drift.
 */
const _storage_js_1 = require("./_storage.js");
const _lock_js_1 = require("./_lock.js");
const _utils_js_1 = require("./_utils.js");
const _war_state_js_1 = require("./_war-state.js");
const _sector_war_js_1 = require("./_sector-war.js");
const _sector_war_store_js_1 = require("./_sector-war-store.js");
const _war_structures_js_1 = require("./_war-structures.js");
const world_state_js_1 = require("./world-state.js");
const _seal_js_1 = require("./towers/_seal.js");
const _merc_fighters_js_1 = require("./towers/_merc-fighters.js");
const _war_merc_js_1 = require("./_war-merc.js");
const _war_economy_js_1 = require("./_war-economy.js");
const _war_telemetry_js_1 = require("./_war-telemetry.js");
const online_store_js_1 = require("./_realtime/online-store.js");
// Mercs only auto-snipe a defender whose HP has dropped to/under this fraction of
// max — the "snipe low-health players" rule. Tunable.
exports.MERC_SNIPE_HP_FRACTION = 0.5;
/** Resolve ONE merc deployment against a target + apply it to the contest. SHARED
 *  by the manual war-merc `attack` action and the autonomous tick. Claims a merc
 *  from the hirer's band (atomic), hydrates the target's real loadout, runs the
 *  server-auth battle, applies the outcome under the contest lock (merc win → full
 *  chip + flip-on-capture; player win → 25% regen; stall → inert), and spends the
 *  merc. Returns null if the band is spent or the target save is missing. */
async function deployOneMerc(args) {
    // 1. Claim one merc from the hirer's band (rejects if it's spent).
    const claim = await (0, _lock_js_1.withKvLock)((0, _war_state_js_1.villageWarKey)(args.village), async () => {
        const rec = (0, _war_state_js_1.normalizeVillageWarRecord)(args.village, (await _storage_js_1.kv.get((0, _war_state_js_1.villageWarKey)(args.village))) ?? undefined);
        const out = (0, _war_merc_js_1.claimMercFromBand)(rec.mercLeases, args.tierId, args.hirer, args.now);
        if (!out.claimed)
            return { claimed: false, remaining: 0 };
        await _storage_js_1.kv.set((0, _war_state_js_1.villageWarKey)(args.village), { ...rec, mercLeases: out.leases });
        return { claimed: true, remaining: out.remaining };
    }, { failClosed: true });
    if (!claim.claimed)
        return null;
    // 2. Hydrate the target's real combat loadout + resolve the battle (server-auth).
    const targetSave = await _storage_js_1.kv.get(`save:${args.targetPlayer}`);
    const targetChar = (targetSave?.character ?? null);
    if (!targetChar)
        return { winner: 'stall', captured: false, controlHp: 0, mercsRemaining: claim.remaining };
    const sealed = (0, _seal_js_1.sealTowerFighter)(targetChar, targetSave ?? null, {});
    const seed = (args.now ^ (args.sector * 2654435761)) >>> 0;
    const battle = (0, _merc_fighters_js_1.resolveMercBattle)({ playerName: args.targetPlayer, playerSlug: args.targetPlayer, playerSealedChar: sealed, mercLevel: args.mercLevel, seed, now: args.now });
    // 3. Apply to the contest Control HP under its lock.
    let captured = false;
    let controlHp = 0;
    if (battle.mercWon || battle.playerWon) {
        const result = await (0, _lock_js_1.withKvLock)((0, _sector_war_js_1.sectorWarKey)(args.contestId), async () => {
            const live = await (0, _sector_war_store_js_1.loadSectorWar)(args.contestId);
            if (!live || live.flipped)
                return { captured: false, controlHp: 0 };
            const atkRecord = (0, _war_state_js_1.normalizeVillageWarRecord)(args.village, (await _storage_js_1.kv.get((0, _war_state_js_1.villageWarKey)(args.village))) ?? undefined);
            const damage = Math.round(_war_state_js_1.SECTOR_CONTROL_HP_PER_WIN * (0, _war_structures_js_1.sectorWarDamageMultiplier)(atkRecord));
            const outcome = (0, _sector_war_js_1.applySectorBattleResult)(live, battle.mercWon, { now: args.now, damage, mercBattle: true });
            if (outcome.captured) {
                await (0, world_state_js_1.captureSectorForVillage)(live.sector, args.village, args.now);
                await (0, _sector_war_store_js_1.deleteSectorWar)(live.id);
            }
            else {
                await (0, _sector_war_store_js_1.saveSectorWar)(outcome.session);
            }
            return { captured: outcome.captured, controlHp: outcome.session.controlHp };
        }, { failClosed: true });
        captured = result.captured;
        controlHp = result.controlHp;
        if (captured) {
            void (0, _war_telemetry_js_1.recordWarEcoEvent)({ eventId: `merc-capture:${args.contestId}:${args.now}`, village: args.village, kind: 'sector.capture', amount: 1, meta: `sector:${args.sector}` });
        }
    }
    return { winner: battle.winner, captured, controlHp, mercsRemaining: claim.remaining };
}
/** Pure: the lowest-HP defender-village candidate at/under the snipe threshold (the
 *  merc's prey), or null if none qualifies. Ties break by name for determinism. */
function pickSnipeTarget(candidates, defenderVillage, threshold = exports.MERC_SNIPE_HP_FRACTION) {
    const eligible = candidates
        .filter((c) => c.village === defenderVillage && c.hp > 0 && c.maxHp > 0 && c.hp / c.maxHp <= threshold)
        .sort((a, b) => (a.hp / a.maxHp - b.hp / b.maxHp) || (a.name < b.name ? -1 : 1));
    return eligible[0] ?? null;
}
/** One autonomous tick: for every active Combat siege, a merc from the attacker's
 *  band snipes the lowest-HP enemy defender currently standing in that sector. One
 *  merc per siege per tick, so a band depletes organically as prey appears. No-op
 *  unless ENABLE_VILLAGE_WAR=1. */
async function runMercAutoDeploy(deps = {}) {
    if (process.env.ENABLE_VILLAGE_WAR !== '1')
        return { enabled: false, deployed: 0 };
    const now = deps.now ?? Date.now();
    const listContests = deps.listContests ?? _sector_war_store_js_1.listActiveSectorWars;
    const onlineNames = deps.onlineNames ?? ((sector) => online_store_js_1.onlineStore.list().filter((p) => p.sector === sector).map((p) => p.name));
    const deploy = deps.deploy ?? deployOneMerc;
    let deployed = 0;
    const contests = await listContests();
    for (const contest of contests) {
        if (contest.winCondition !== 'combat' || contest.flipped)
            continue;
        const village = contest.attackerVillage;
        const rec = (0, _war_state_js_1.normalizeVillageWarRecord)(village, (await _storage_js_1.kv.get((0, _war_state_js_1.villageWarKey)(village))) ?? undefined);
        const band = rec.mercLeases.find((l) => l.expiresAt > now && l.count > 0);
        if (!band)
            continue;
        // The defenders standing in the contested sector right now, with HP from
        // their save (presence carries no reliable HP; few candidates per sector).
        const candidates = [];
        for (const name of onlineNames(contest.sector)) {
            const save = await _storage_js_1.kv.get(`save:${(0, _utils_js_1.safeName)(name)}`);
            const ch = save?.character;
            if (!ch)
                continue;
            const hp = Number(ch.hp);
            const maxHp = Number(ch.maxHp) || hp;
            candidates.push({ name: (0, _utils_js_1.safeName)(name), village: String(ch.village ?? '').trim(), hp, maxHp });
        }
        const target = pickSnipeTarget(candidates, contest.defenderVillage);
        if (!target)
            continue;
        const tier = (0, _war_economy_js_1.wrMercTierById)(band.tierId);
        if (!tier)
            continue;
        const r = await deploy({ village, tierId: band.tierId, hirer: band.player, sector: contest.sector, targetPlayer: target.name, contestId: contest.id, mercLevel: tier.level, now });
        if (r)
            deployed++;
    }
    return { enabled: true, deployed };
}
