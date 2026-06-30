"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MERC_VILLAGE_WAR_DAMAGE = void 0;
exports.deployOneMerc = deployOneMerc;
exports.deployMercVillageWar = deployMercVillageWar;
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
const _merc_roam_js_1 = require("./_merc-roam.js");
const _war_economy_js_1 = require("./_war-economy.js");
const _war_telemetry_js_1 = require("./_war-telemetry.js");
const online_store_js_1 = require("./_realtime/online-store.js");
/** Shared core for every merc engagement: cooldown-gate the target, claim a merc
 *  from the hirer's band (atomic), hydrate the target's REAL loadout, and run the
 *  server-auth Towers fight. Returns null when the band is spent OR the target is
 *  inside the 15-min per-target cooldown (so neither the cron nor a hand-deploy can
 *  spam one player). The per-target cooldown is stamped the moment a merc commits.
 *  The CALLER applies the outcome to the right war (sector Control-HP or village-war
 *  HP). A missing target save resolves to a harmless stall (no damage either way). */
async function claimAndResolveMerc(args) {
    // Anti-spam: a player a merc just fought is off-limits to the WHOLE band for
    // 15 min — don't even spend a merc on them.
    if (await (0, _merc_roam_js_1.isMercTargetOnCooldown)(args.targetPlayer, args.now))
        return null;
    // Claim one merc from the hirer's band (rejects if it's spent).
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
    // The merc commits to this target → 15-min cooldown for the whole band (win,
    // lose, or stall), so it can't re-hit the same player.
    await (0, _merc_roam_js_1.setMercTargetCooldown)(args.targetPlayer, args.now);
    // Hydrate the target's real combat loadout + resolve the battle (server-auth).
    const targetSave = await _storage_js_1.kv.get(`save:${args.targetPlayer}`);
    const targetChar = (targetSave?.character ?? null);
    if (!targetChar) {
        return { battle: { winner: 'stall', mercWon: false, playerWon: false, rounds: 0, log: [] }, mercsRemaining: claim.remaining };
    }
    const sealed = (0, _seal_js_1.sealTowerFighter)(targetChar, targetSave ?? null, {});
    const seed = (args.now ^ (args.sector * 2654435761)) >>> 0;
    const battle = (0, _merc_fighters_js_1.resolveMercBattle)({ playerName: args.targetPlayer, playerSlug: args.targetPlayer, playerSealedChar: sealed, mercLevel: args.mercLevel, seed, now: args.now });
    return { battle, mercsRemaining: claim.remaining };
}
/** Resolve ONE merc deployment against a target in a SECTOR war + apply it to the
 *  contest. SHARED by the manual war-merc `attack` action and the autonomous tick.
 *  Merc win → full Control-HP chip + flip-on-capture; player win → 25% regen; stall
 *  → inert. Returns null if the band is spent or the target is on cooldown. */
async function deployOneMerc(args) {
    const resolved = await claimAndResolveMerc(args);
    if (!resolved)
        return null;
    const { battle, mercsRemaining } = resolved;
    // Apply to the contest Control HP under its lock.
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
    return { winner: battle.winner, captured, controlHp, mercsRemaining };
}
// Per-win damage a merc lands on the ENEMY village's war HP in a village war.
// Modest vs the 5000 war-HP pool — a finite band (3-5 mercs) pressures the enemy
// but can never win a war alone (and is floored, so it never lands the killing
// blow). Tunable.
exports.MERC_VILLAGE_WAR_DAMAGE = 50;
/** Resolve ONE merc deployment against an enemy-village player in a VILLAGE war +
 *  apply it. Same server-auth fight as the sector path (claimAndResolveMerc); a
 *  merc win chips the enemy village's war HP (floored — mercs soften, players
 *  finish), a player win / stall is inert. Returns null if the band is spent or the
 *  target is on the 15-min cooldown. */
async function deployMercVillageWar(args) {
    const resolved = await claimAndResolveMerc(args);
    if (!resolved)
        return null;
    const { battle, mercsRemaining } = resolved;
    let enemyWarHp = null;
    if (battle.mercWon) {
        const dmg = await (0, world_state_js_1.applyMercVillageWarDamage)(args.village, args.enemyVillage, exports.MERC_VILLAGE_WAR_DAMAGE, args.now);
        enemyWarHp = dmg ? dmg.enemyHp : null;
    }
    return { winner: battle.winner, enemyWarHp, mercsRemaining };
}
/** The attacker's active merc band (with its tier level), or null if it has none. */
async function activeBand(village, now) {
    const rec = (0, _war_state_js_1.normalizeVillageWarRecord)(village, (await _storage_js_1.kv.get((0, _war_state_js_1.villageWarKey)(village))) ?? undefined);
    const band = rec.mercLeases.find((l) => l.expiresAt > now && l.count > 0);
    if (!band)
        return null;
    const tier = (0, _war_economy_js_1.wrMercTierById)(band.tierId);
    return tier ? { tierId: band.tierId, player: band.player, level: tier.level } : null;
}
/** Live merc targets among a set of online players: only `enemyVillage` members who
 *  are alive and NOT inside the 15-min merc cooldown (so the cron picks the next
 *  mark instead of wasting a deploy on someone just hit). HP comes from the save —
 *  presence carries no reliable HP. */
async function liveMercTargets(names, enemyVillage, now) {
    const out = [];
    for (const name of names) {
        const safe = (0, _utils_js_1.safeName)(name);
        const save = await _storage_js_1.kv.get(`save:${safe}`);
        const ch = save?.character;
        if (!ch || String(ch.village ?? '').trim() !== enemyVillage)
            continue;
        if (await (0, _merc_roam_js_1.isMercTargetOnCooldown)(safe, now))
            continue;
        const hp = Number(ch.hp);
        out.push({ name: safe, village: enemyVillage, hp, maxHp: Number(ch.maxHp) || hp });
    }
    return out;
}
/** One autonomous tick. Sector wars: a merc snipes the lowest-HP enemy defender in
 *  each besieged Combat sector (ANY enemy now — no min-HP gate; the snipe is just
 *  the pick order). Village wars: each side's band hunts the lowest-HP enemy player
 *  ANYWHERE (the mercs "go where the enemy players are"). One merc per siege /
 *  per war-side per tick, so bands deplete organically; the 15-min per-target
 *  cooldown stops them spamming one player. No-op unless ENABLE_VILLAGE_WAR=1. */
async function runMercAutoDeploy(deps = {}) {
    if (process.env.ENABLE_VILLAGE_WAR !== '1')
        return { enabled: false, deployed: 0 };
    const now = deps.now ?? Date.now();
    const listContests = deps.listContests ?? _sector_war_store_js_1.listActiveSectorWars;
    const listVillageWars = deps.listVillageWars ?? world_state_js_1.listActiveVillageWars;
    const onlineNames = deps.onlineNames ?? ((sector) => online_store_js_1.onlineStore.list().filter((p) => p.sector === sector).map((p) => p.name));
    const onlineAll = deps.onlineAll ?? (() => online_store_js_1.onlineStore.list().map((p) => p.name));
    const deploy = deps.deploy ?? deployOneMerc;
    const deployVillage = deps.deployVillage ?? deployMercVillageWar;
    let deployed = 0;
    // ── Sector wars: snipe the lowest-HP enemy defender in each besieged Combat sector.
    for (const contest of await listContests()) {
        if (contest.winCondition !== 'combat' || contest.flipped)
            continue;
        const band = await activeBand(contest.attackerVillage, now);
        if (!band)
            continue;
        const target = (0, _merc_roam_js_1.pickMercTarget)(await liveMercTargets(onlineNames(contest.sector), contest.defenderVillage, now), contest.defenderVillage);
        if (!target)
            continue;
        const r = await deploy({ village: contest.attackerVillage, tierId: band.tierId, hirer: band.player, sector: contest.sector, targetPlayer: target.name, contestId: contest.id, mercLevel: band.level, now });
        if (r)
            deployed++;
    }
    // ── Village wars: each side's band hunts the lowest-HP enemy player anywhere.
    for (const war of await listVillageWars()) {
        for (const attacker of war.villages) {
            const enemy = war.villages.find((v) => v !== attacker);
            if (!enemy)
                continue;
            const band = await activeBand(attacker, now);
            if (!band)
                continue;
            const target = (0, _merc_roam_js_1.pickMercTarget)(await liveMercTargets(onlineAll(), enemy, now), enemy);
            if (!target)
                continue;
            const r = await deployVillage({ village: attacker, enemyVillage: enemy, tierId: band.tierId, hirer: band.player, sector: 0, targetPlayer: target.name, mercLevel: band.level, now });
            if (r)
                deployed++;
        }
    }
    return { enabled: true, deployed };
}
