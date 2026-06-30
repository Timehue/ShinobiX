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
import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { safeName } from './_utils.js';
import { normalizeVillageWarRecord, villageWarKey, SECTOR_CONTROL_HP_PER_WIN } from './_war-state.js';
import { sectorWarKey, applySectorBattleResult } from './_sector-war.js';
import { loadSectorWar, saveSectorWar, deleteSectorWar, listActiveSectorWars } from './_sector-war-store.js';
import { sectorWarDamageMultiplier } from './_war-structures.js';
import { captureSectorForVillage, applyMercVillageWarDamage, listActiveVillageWars } from './world-state.js';
import { sealTowerFighter } from './towers/_seal.js';
import { resolveMercBattle, type MercBattleResult } from './towers/_merc-fighters.js';
import { claimMercFromBand } from './_war-merc.js';
import { isMercTargetOnCooldown, setMercTargetCooldown, pickMercTarget, type RoamTarget } from './_merc-roam.js';
import { wrMercTierById } from './_war-economy.js';
import { recordWarEcoEvent } from './_war-telemetry.js';
import { onlineStore } from './_realtime/online-store.js';

export interface MercDeployResult {
    winner: 'merc' | 'player' | 'stall';
    captured: boolean;
    controlHp: number;
    mercsRemaining: number;
}

/** Shared core for every merc engagement: cooldown-gate the target, claim a merc
 *  from the hirer's band (atomic), hydrate the target's REAL loadout, and run the
 *  server-auth Towers fight. Returns null when the band is spent OR the target is
 *  inside the 15-min per-target cooldown (so neither the cron nor a hand-deploy can
 *  spam one player). The per-target cooldown is stamped the moment a merc commits.
 *  The CALLER applies the outcome to the right war (sector Control-HP or village-war
 *  HP). A missing target save resolves to a harmless stall (no damage either way). */
async function claimAndResolveMerc(args: {
    village: string;
    tierId: string;
    hirer: string;
    sector: number;
    targetPlayer: string;
    mercLevel: number;
    now: number;
}): Promise<{ battle: MercBattleResult; mercsRemaining: number } | null> {
    // Anti-spam: a player a merc just fought is off-limits to the WHOLE band for
    // 15 min — don't even spend a merc on them.
    if (await isMercTargetOnCooldown(args.targetPlayer, args.now)) return null;

    // Claim one merc from the hirer's band (rejects if it's spent).
    const claim = await withKvLock(villageWarKey(args.village), async () => {
        const rec = normalizeVillageWarRecord(args.village, (await kv.get<Record<string, unknown>>(villageWarKey(args.village))) ?? undefined);
        const out = claimMercFromBand(rec.mercLeases, args.tierId, args.hirer, args.now);
        if (!out.claimed) return { claimed: false as const, remaining: 0 };
        await kv.set(villageWarKey(args.village), { ...rec, mercLeases: out.leases });
        return { claimed: true as const, remaining: out.remaining };
    }, { failClosed: true });
    if (!claim.claimed) return null;

    // The merc commits to this target → 15-min cooldown for the whole band (win,
    // lose, or stall), so it can't re-hit the same player.
    await setMercTargetCooldown(args.targetPlayer, args.now);

    // Hydrate the target's real combat loadout + resolve the battle (server-auth).
    const targetSave = await kv.get<Record<string, unknown>>(`save:${args.targetPlayer}`);
    const targetChar = (targetSave?.character ?? null) as Record<string, unknown> | null;
    if (!targetChar) {
        return { battle: { winner: 'stall', mercWon: false, playerWon: false, rounds: 0, log: [] }, mercsRemaining: claim.remaining };
    }
    const sealed = sealTowerFighter(targetChar, targetSave ?? null, {});
    const seed = (args.now ^ (args.sector * 2654435761)) >>> 0;
    const battle = resolveMercBattle({ playerName: args.targetPlayer, playerSlug: args.targetPlayer, playerSealedChar: sealed, mercLevel: args.mercLevel, seed, now: args.now });
    return { battle, mercsRemaining: claim.remaining };
}

/** Resolve ONE merc deployment against a target in a SECTOR war + apply it to the
 *  contest. SHARED by the manual war-merc `attack` action and the autonomous tick.
 *  Merc win → full Control-HP chip + flip-on-capture; player win → 25% regen; stall
 *  → inert. Returns null if the band is spent or the target is on cooldown. */
export async function deployOneMerc(args: {
    village: string;
    tierId: string;
    hirer: string;
    sector: number;
    targetPlayer: string;
    contestId: string;
    mercLevel: number;
    now: number;
}): Promise<MercDeployResult | null> {
    const resolved = await claimAndResolveMerc(args);
    if (!resolved) return null;
    const { battle, mercsRemaining } = resolved;

    // Apply to the contest Control HP under its lock.
    let captured = false;
    let controlHp = 0;
    if (battle.mercWon || battle.playerWon) {
        const result = await withKvLock(sectorWarKey(args.contestId), async () => {
            const live = await loadSectorWar(args.contestId);
            if (!live || live.flipped) return { captured: false, controlHp: 0 };
            const atkRecord = normalizeVillageWarRecord(args.village, (await kv.get<Record<string, unknown>>(villageWarKey(args.village))) ?? undefined);
            const damage = Math.round(SECTOR_CONTROL_HP_PER_WIN * sectorWarDamageMultiplier(atkRecord));
            const outcome = applySectorBattleResult(live, battle.mercWon, { now: args.now, damage, mercBattle: true });
            if (outcome.captured) {
                await captureSectorForVillage(live.sector, args.village, args.now);
                await deleteSectorWar(live.id);
            } else {
                await saveSectorWar(outcome.session);
            }
            return { captured: outcome.captured, controlHp: outcome.session.controlHp };
        }, { failClosed: true });
        captured = result.captured;
        controlHp = result.controlHp;
        if (captured) {
            void recordWarEcoEvent({ eventId: `merc-capture:${args.contestId}:${args.now}`, village: args.village, kind: 'sector.capture', amount: 1, meta: `sector:${args.sector}` });
        }
    }
    return { winner: battle.winner, captured, controlHp, mercsRemaining };
}

// Per-win damage a merc lands on the ENEMY village's war HP in a village war.
// Modest vs the 5000 war-HP pool — a finite band (3-5 mercs) pressures the enemy
// but can never win a war alone (and is floored, so it never lands the killing
// blow). Tunable.
export const MERC_VILLAGE_WAR_DAMAGE = 50;

export interface MercVillageWarResult {
    winner: 'merc' | 'player' | 'stall';
    /** the enemy village's war HP after a merc win (null = no live war, or not a merc win) */
    enemyWarHp: number | null;
    mercsRemaining: number;
}

/** Resolve ONE merc deployment against an enemy-village player in a VILLAGE war +
 *  apply it. Same server-auth fight as the sector path (claimAndResolveMerc); a
 *  merc win chips the enemy village's war HP (floored — mercs soften, players
 *  finish), a player win / stall is inert. Returns null if the band is spent or the
 *  target is on the 15-min cooldown. */
export async function deployMercVillageWar(args: {
    village: string;       // attacker — the merc owner's village
    enemyVillage: string;  // defender
    tierId: string;
    hirer: string;
    sector: number;
    targetPlayer: string;
    mercLevel: number;
    now: number;
}): Promise<MercVillageWarResult | null> {
    const resolved = await claimAndResolveMerc(args);
    if (!resolved) return null;
    const { battle, mercsRemaining } = resolved;

    let enemyWarHp: number | null = null;
    if (battle.mercWon) {
        const dmg = await applyMercVillageWarDamage(args.village, args.enemyVillage, MERC_VILLAGE_WAR_DAMAGE, args.now);
        enemyWarHp = dmg ? dmg.enemyHp : null;
    }
    return { winner: battle.winner, enemyWarHp, mercsRemaining };
}

// Minimal injectable surfaces so the tick is unit-testable.
type AutoDeps = {
    now?: number;
    listContests?: () => Promise<Array<{ id: string; sector: number; attackerVillage: string; defenderVillage: string; winCondition: string; flipped: boolean }>>;
    listVillageWars?: () => Promise<Array<{ villages: [string, string] }>>;
    onlineNames?: (sector: number) => string[];
    onlineAll?: () => string[];
    deploy?: typeof deployOneMerc;
    deployVillage?: typeof deployMercVillageWar;
};

export interface MercAutoResult { enabled: boolean; deployed: number; }

/** The attacker's active merc band (with its tier level), or null if it has none. */
async function activeBand(village: string, now: number): Promise<{ tierId: string; player: string; level: number } | null> {
    const rec = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(villageWarKey(village))) ?? undefined);
    const band = rec.mercLeases.find((l) => l.expiresAt > now && l.count > 0);
    if (!band) return null;
    const tier = wrMercTierById(band.tierId);
    return tier ? { tierId: band.tierId, player: band.player, level: tier.level } : null;
}

/** Live merc targets among a set of online players: only `enemyVillage` members who
 *  are alive and NOT inside the 15-min merc cooldown (so the cron picks the next
 *  mark instead of wasting a deploy on someone just hit). HP comes from the save —
 *  presence carries no reliable HP. */
async function liveMercTargets(names: readonly string[], enemyVillage: string, now: number): Promise<RoamTarget[]> {
    const out: RoamTarget[] = [];
    for (const name of names) {
        const safe = safeName(name);
        const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${safe}`);
        const ch = save?.character;
        if (!ch || String(ch.village ?? '').trim() !== enemyVillage) continue;
        if (await isMercTargetOnCooldown(safe, now)) continue;
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
export async function runMercAutoDeploy(deps: AutoDeps = {}): Promise<MercAutoResult> {
    if (process.env.ENABLE_VILLAGE_WAR !== '1') return { enabled: false, deployed: 0 };
    const now = deps.now ?? Date.now();
    const listContests = deps.listContests ?? listActiveSectorWars;
    const listVillageWars = deps.listVillageWars ?? listActiveVillageWars;
    const onlineNames = deps.onlineNames ?? ((sector: number) => onlineStore.list().filter((p) => p.sector === sector).map((p) => p.name));
    const onlineAll = deps.onlineAll ?? (() => onlineStore.list().map((p) => p.name));
    const deploy = deps.deploy ?? deployOneMerc;
    const deployVillage = deps.deployVillage ?? deployMercVillageWar;

    let deployed = 0;

    // ── Sector wars: snipe the lowest-HP enemy defender in each besieged Combat sector.
    for (const contest of await listContests()) {
        if (contest.winCondition !== 'combat' || contest.flipped) continue;
        const band = await activeBand(contest.attackerVillage, now);
        if (!band) continue;
        const target = pickMercTarget(await liveMercTargets(onlineNames(contest.sector), contest.defenderVillage, now), contest.defenderVillage);
        if (!target) continue;
        const r = await deploy({ village: contest.attackerVillage, tierId: band.tierId, hirer: band.player, sector: contest.sector, targetPlayer: target.name, contestId: contest.id, mercLevel: band.level, now });
        if (r) deployed++;
    }

    // ── Village wars: each side's band hunts the lowest-HP enemy player anywhere.
    for (const war of await listVillageWars()) {
        for (const attacker of war.villages) {
            const enemy = war.villages.find((v) => v !== attacker);
            if (!enemy) continue;
            const band = await activeBand(attacker, now);
            if (!band) continue;
            const target = pickMercTarget(await liveMercTargets(onlineAll(), enemy, now), enemy);
            if (!target) continue;
            const r = await deployVillage({ village: attacker, enemyVillage: enemy, tierId: band.tierId, hirer: band.player, sector: 0, targetPlayer: target.name, mercLevel: band.level, now });
            if (r) deployed++;
        }
    }
    return { enabled: true, deployed };
}
