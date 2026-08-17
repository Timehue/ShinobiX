/*
 * Village-War mercenaries — autonomous deployment (Phase 5 snipe). A frequent cron
 * tick gives active merc bands a life of their own: for each Combat sector a
 * village is besieging, a merc snipes the LOWEST-HP enemy defender currently in
 * that sector (online presence), so mercs "attack whenever / snipe low-HP players"
 * without the Kage hand-deploying each one. All resolution is server-authoritative
 * (resolveMercBattle via the towers engine) — the same path the manual deploy uses.
 *
 * Server-gated by the default-on Sector Map campaign. Shares the deployOneMerc core
 * with /api/village/war-merc so the two never drift.
 */
import { kv } from './_storage.js';
import { loadAdminCombatContent } from './_admin-content.js';
import { withKvLock } from './_lock.js';
import { safeName } from './_utils.js';
import { normalizeVillageWarRecord, villageWarKey } from './_war-state.js';
import { sectorWarRoleOf, sectorControlSwing, ROLE_MERC } from './_war-role.js';
import { defenderPointsMultiplier } from './_war-structures.js';
import { sectorWarKey, applySectorWarBattle, recordSectorWarBattleOutcome } from './_sector-war.js';
import { loadSectorWar, saveSectorWar, listActiveSectorWars } from './_sector-war-store.js';
import { sectorWarDamageMultiplier } from './_war-structures.js';
import { applyMercVillageWarDamage, listActiveVillageWars } from './world-state.js';
import { sealTowerFighter } from './towers/_seal.js';
import { resolveMercBattle, type MercBattleResult } from './towers/_merc-fighters.js';
import { claimMercFromBand } from './_war-merc.js';
import { isMercTargetOnCooldown, setMercTargetCooldown, pickMercTarget, type RoamTarget } from './_merc-roam.js';
import { wrMercTierById } from './_war-economy.js';
import { recordWarEcoEvent } from './_war-telemetry.js';
import { villageWarMapEnabled } from './_release-flags.js';
import { onlineStore } from './_realtime/online-store.js';
import { augmentSaveWithForgedDefs } from './_forged-item-registry.js';

export interface MercDeployResult {
    winner: 'merc' | 'player' | 'stall';
    attackerPoints: number;
    defenderPoints: number;
    mercsRemaining: number;
}

/** Shared core for every merc engagement: cooldown-gate the target, claim a merc
 *  from the hirer's band (atomic), hydrate the target's REAL loadout, and run the
 *  server-auth Towers fight. Returns null when the band is spent OR the target is
 *  inside the 15-min per-target cooldown (so neither the cron nor a hand-deploy can
 *  spam one player). The per-target cooldown is stamped the moment a merc commits.
 *  The CALLER applies the outcome to the right war (sector Control-HP or village-war
 *  HP). A missing target save or target-village mismatch rejects before a band
 *  member is spent. */
async function claimAndResolveMerc(args: {
    village: string;
    tierId: string;
    hirer: string;
    sector: number;
    targetPlayer: string;
    /** Current server-authoritative village the target must still belong to. */
    targetVillage: string;
    mercLevel: number;
    now: number;
}): Promise<{ battle: MercBattleResult; mercsRemaining: number } | null> {
    const targetSaveKey = `save:${args.targetPlayer}`;
    // A route-level target lookup is only advisory: village transfer/autosave can
    // race it. Hold the same save lock those writes use, re-read the exact target
    // village, and only then spend a band member. Keeping the cooldown check and
    // stamp inside that lock also prevents two concurrent deploys from both
    // passing the old pre-claim cooldown read.
    const authority = await withKvLock(targetSaveKey, async () => {
        if (await isMercTargetOnCooldown(args.targetPlayer, args.now)) return null;
        const targetSave = await kv.get<Record<string, unknown>>(targetSaveKey);
        const targetChar = (targetSave?.character ?? null) as Record<string, unknown> | null;
        if (!targetChar || String(targetChar.village ?? '').trim() !== args.targetVillage) return null;

        const claim = await withKvLock(villageWarKey(args.village), async () => {
            const rec = normalizeVillageWarRecord(args.village, (await kv.get<Record<string, unknown>>(villageWarKey(args.village))) ?? undefined);
            const out = claimMercFromBand(rec.mercLeases, args.tierId, args.hirer, args.now);
            if (!out.claimed) return { claimed: false as const, remaining: 0 };
            await kv.set(villageWarKey(args.village), { ...rec, mercLeases: out.leases });
            return { claimed: true as const, remaining: out.remaining };
        }, { failClosed: true });
        if (!claim.claimed) return null;

        // The merc commits to this valid target → 15-min cooldown for the whole
        // band (win, lose, or stall), so it cannot re-hit the same player.
        await setMercTargetCooldown(args.targetPlayer, args.now);
        return { targetSave, remaining: claim.remaining };
    }, { failClosed: true });
    if (!authority) return null;

    // Hydrate the exact save snapshot authorized above + resolve server-side.
    const targetSave = await augmentSaveWithForgedDefs(authority.targetSave);
    const targetChar = (targetSave?.character ?? null) as Record<string, unknown> | null;
    if (!targetChar) return null;
    const sealed = sealTowerFighter(targetChar, targetSave ?? null, {}, await loadAdminCombatContent());
    const seed = (args.now ^ (args.sector * 2654435761)) >>> 0;
    const battle = resolveMercBattle({ playerName: args.targetPlayer, playerSlug: args.targetPlayer, playerSealedChar: sealed, mercLevel: args.mercLevel, seed, now: args.now });
    return { battle, mercsRemaining: authority.remaining };
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
    targetVillage: string;
    contestId: string;
    mercLevel: number;
    now: number;
}): Promise<MercDeployResult | null> {
    const resolved = await claimAndResolveMerc(args);
    if (!resolved) return null;
    const { battle, mercsRemaining } = resolved;

    // Score the war under its lock. A merc win adds attacker points at villager
    // weight; the defending PLAYER's rank sets the rest of the kill value — a Kage
    // who falls to a merc is a full bounty, a Kage who repels one scores more
    // (at the reduced merc-repel fraction; §17.6). Sectors never flip mid-war —
    // settlement compares the tallies when the 72 hours close.
    let attackerPoints = 0;
    let defenderPoints = 0;
    if (battle.mercWon || battle.playerWon) {
        const playerRole = await sectorWarRoleOf(args.targetPlayer, args.targetVillage);
        const result = await withKvLock(sectorWarKey(args.contestId), async () => {
            const live = await loadSectorWar(args.contestId);
            if (!live) return null;
            const [atkRaw, defRaw] = await Promise.all([
                kv.get<Record<string, unknown>>(villageWarKey(args.village)),
                kv.get<Record<string, unknown>>(villageWarKey(live.defenderVillage)),
            ]);
            const atkRecord = normalizeVillageWarRecord(args.village, atkRaw ?? undefined);
            const defRecord = normalizeVillageWarRecord(live.defenderVillage, defRaw ?? undefined);
            const roleSwing = battle.mercWon
                ? sectorControlSwing(ROLE_MERC, playerRole)
                : sectorControlSwing(playerRole, ROLE_MERC);
            const outcome = applySectorWarBattle(live, battle.mercWon, {
                now: args.now,
                roleSwing,
                attackerMult: sectorWarDamageMultiplier(atkRecord),
                defenderMult: defenderPointsMultiplier(defRecord),
                // A merc kill is the band's, not a player's; a repel is the
                // defender's (attribution feeds the settlement capture credit).
                by: battle.mercWon ? '' : args.targetPlayer,
                mercBattle: true,
            });
            const recorded = recordSectorWarBattleOutcome(outcome, {
                // targetPlayer in the id: two mercs striking DIFFERENT defenders in
                // the same millisecond must not collide into one receipt (the dedupe
                // would silently drop the second battle's points).
                battleId: `merc:${args.contestId}:${args.targetPlayer}:${args.now}`,
                attackerWon: battle.mercWon,
                by: battle.mercWon ? '' : args.targetPlayer,
                at: args.now,
            });
            await saveSectorWar(recorded.session);
            return { attackerPoints: recorded.session.attackerPoints, defenderPoints: recorded.session.defenderPoints };
        }, { failClosed: true });
        if (result) {
            attackerPoints = result.attackerPoints;
            defenderPoints = result.defenderPoints;
        }
    }
    return { winner: battle.winner, attackerPoints, defenderPoints, mercsRemaining };
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
    const resolved = await claimAndResolveMerc({ ...args, targetVillage: args.enemyVillage });
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
 *  cooldown stops them spamming one player. No-op when the campaign is disabled. */
export async function runMercAutoDeploy(deps: AutoDeps = {}): Promise<MercAutoResult> {
    if (!villageWarMapEnabled()) return { enabled: false, deployed: 0 };
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
        const r = await deploy({ village: contest.attackerVillage, tierId: band.tierId, hirer: band.player, sector: contest.sector, targetPlayer: target.name, targetVillage: contest.defenderVillage, contestId: contest.id, mercLevel: band.level, now });
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
