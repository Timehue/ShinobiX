/*
 * Village-War mercenaries — autonomous deployment (Phase 5 snipe). A frequent cron
 * tick gives active merc bands a life of their own, so mercs "attack whenever /
 * snipe low-HP players" without a leader hand-deploying each one. All resolution
 * is server-authoritative (resolveMercBattle via the towers engine) — the same
 * path the manual deploy and the roaming encounter use.
 *
 * Every band serves the ONE war it was hired for (owner redesign 2026-10-08;
 * api/_merc-context.ts), and acts only while that exact war instance is live:
 *   - Combat sector war: the DEFENDING village's band patrols its contested
 *     sector and snipes the lowest-HP ATTACKING-village player there. A band
 *     win scores the defence in full; an attacker who beats it scores a quarter.
 *   - All-out village war: each side's band hunts the lowest-HP enemy anywhere,
 *     and a merc win chips the enemy village's war HP (floored at 1).
 *   - A LEGACY band, hired before the redesign and bound to nothing, still
 *     fights only in its village's all-out village war, and lapses with its lease.
 *
 * Server-gated by the default-on Sector Map campaign. Shares the deployOneMerc core
 * with /api/village/war-merc so the two never drift.
 *
 * Mercs also hit players who LOGGED OUT in the wild (owner decision): a sleeper camp
 * (api/_realtime/sleeper-camps.ts) of an enemy-village player is raided with the
 * same consequence a player sleeper-kill applies — the hospital stamp + relocation
 * to the village — via the shared settlement in api/player/sleeper-kill.ts. No one
 * is rewarded (the merc is an NPC): no war points, no band member spent. Anti-spam:
 * the raid is once-per-camp by construction (the KO clears the camp and moves the
 * victim to sector 0, so they are not a sleeper again until they log in, walk out
 * and log off in the wild), AND it stamps the same 15-min per-target merc
 * cooldown, so a player who comes back and logs off again at once is not chained.
 * One raid per war context per tick, like the live snipe.
 */
import { kv } from './_storage.js';
import { loadAdminCombatContent } from './_admin-content.js';
import { withKvLock } from './_lock.js';
import { safeName } from './_utils.js';
import { normalizeVillageWarRecord, villageWarKey, villageWarSlug, type MercLease, type MercLeaseContext } from './_war-state.js';
import { sectorWarRoleOf, sectorControlSwing, ROLE_MERC } from './_war-role.js';
import { defenderPointsMultiplier } from './_war-structures.js';
import { applySectorWarBattle, sectorWarInstanceTag } from './_sector-war.js';
import { commitSectorWarBattle, listActiveSectorWars, type SectorWarBattleDecision } from './_sector-war-store.js';
import { sectorWarDamageMultiplier } from './_war-structures.js';
import { applyMercVillageWarDamage } from './world-state.js';
import { sealTowerFighter } from './towers/_seal.js';
import { resolveMercBattle, type MercBattleResult } from './towers/_merc-fighters.js';
import { bandsServing, claimMercFromBandKey, leaseServes, mercBandKey } from './_war-merc.js';
import { isMercTargetOnCooldown, mercTargetsOnCooldown, setMercTargetCooldown, pickMercTarget, type RoamTarget } from './_merc-roam.js';
import { wrMercTierById } from './_war-economy.js';
import { recordWarEcoEvent } from './_war-telemetry.js';
import { villageWarMapEnabled } from './_release-flags.js';
import { onlineStore } from './_realtime/online-store.js';
import { augmentSaveWithForgedDefs } from './_forged-item-registry.js';
import { listSleeperCamps, type SleeperCamp } from './_realtime/sleeper-camps.js';
import { settleSleeperKo } from './player/sleeper-kill.js';
import { pushOfflineNotice } from './player/_offline-notices.js';
import { LockContendedError } from './_lock.js';
import { listVillageWarInstances, sectorContestContext, villageWarActing, villageWarContext } from './_merc-context.js';
import { sweepRetiredWarMercenaryHires } from './_war-mercenary-hire.js';

export interface MercDeployResult {
    winner: 'merc' | 'player' | 'stall';
    attackerPoints: number;
    defenderPoints: number;
    mercsRemaining: number;
}

export type MercClaimArgs = {
    /** The band's own village (whose WR paid for it). */
    village: string;
    tierId: string;
    hirer: string;
    /** The band to spend (mercBandKey). Defaults to the legacy `${tierId}:${hirer}`. */
    bandKey?: string;
    /** The war the merc is being spent in. A band bound to another war is
     *  refused under the lock, so it can never fight outside its own war. */
    context?: MercLeaseContext | null;
    sector: number;
    targetPlayer: string;
    /** Current server-authoritative village the target must still belong to. */
    targetVillage: string;
    mercLevel: number;
    now: number;
};

/** Injectable surfaces so the claim/fight ordering is unit-testable without kv
 *  or the Towers engine. Defaults are the live paths. */
export type MercClaimDeps = {
    store?: { get<T = unknown>(key: string): Promise<T | null>; set(key: string, value: unknown): Promise<unknown> };
    lock?: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
    isOnCooldown?: (name: string, now: number) => Promise<boolean>;
    stampCooldown?: (name: string, now: number) => Promise<unknown>;
    /** Hydrate + seal the target from the authorized snapshot. Runs BEFORE the
     *  claim, so a throw here cannot cost the village a band member. */
    prepareFighter?: (targetSave: Record<string, unknown> | null) => Promise<unknown | null>;
    /** Run the headless fight. A throw returns the claimed merc to the band. */
    runFight?: (sealed: unknown, args: MercClaimArgs & { seed: number }) => MercBattleResult;
};

async function defaultPrepareFighter(rawSave: Record<string, unknown> | null): Promise<unknown | null> {
    const targetSave = await augmentSaveWithForgedDefs(rawSave);
    const targetChar = (targetSave?.character ?? null) as Record<string, unknown> | null;
    if (!targetChar) return null;
    return sealTowerFighter(targetChar, targetSave ?? null, {}, await loadAdminCombatContent());
}

/**
 * Shared core for every merc engagement: cooldown-gate the target, hydrate the
 * target's REAL loadout, claim a merc from the hirer's band (atomic), and run
 * the server-auth Towers fight. Returns null when the band is spent OR the
 * target is inside the 15-min per-target cooldown (so neither the cron nor a
 * hand-deploy can spam one player). The per-target cooldown is stamped the
 * moment a merc commits. The CALLER applies the outcome to the right war.
 *
 * ORDERING — a band member is WAR RESOURCES the village already paid for, so it
 * is spent only once the fight is certain to be attempted:
 *   1. authorize (target save lock): cooldown + village check, snapshot the save.
 *   2. build the sealed fighter OUTSIDE any lock. Every "no fight happens"
 *      outcome — a save that hydrates to no character, a throw in
 *      augmentSaveWithForgedDefs / loadAdminCombatContent / sealTowerFighter —
 *      lands here, before anything is spent.
 *   3. commit (target save lock again): RE-CHECK the cooldown and the target's
 *      village (they are only authoritative when checked with the claim), then
 *      claim the band member and stamp the cooldown.
 *   4. fight — and if even that throws, the claimed merc is RETURNED to the band
 *      and the cooldown stamp is left in place (it only costs one quiet tick).
 *
 * The caller gets the claimed band's snapshot back (`lease`) so that, should its
 * own scoring step fail to land the result, it can return the merc too
 * (returnMercToBand) rather than leave it spent with nothing to show.
 */
export async function claimAndResolveMerc(
    args: MercClaimArgs,
    deps: MercClaimDeps = {},
): Promise<{ battle: MercBattleResult; mercsRemaining: number; lease: MercLease } | null> {
    const store = deps.store ?? kv;
    const lock = deps.lock ?? (<T>(key: string, fn: () => Promise<T>) => withKvLock(key, fn, { failClosed: true }));
    const onCooldown = deps.isOnCooldown ?? isMercTargetOnCooldown;
    const stampCooldown = deps.stampCooldown ?? setMercTargetCooldown;
    const prepareFighter = deps.prepareFighter ?? defaultPrepareFighter;
    const runFight = deps.runFight ?? ((sealed, a) => resolveMercBattle({
        playerName: a.targetPlayer, playerSlug: a.targetPlayer,
        playerSealedChar: sealed as Parameters<typeof resolveMercBattle>[0]['playerSealedChar'],
        mercLevel: a.mercLevel, seed: a.seed, now: a.now,
    }));

    const targetSaveKey = `save:${args.targetPlayer}`;
    const warKey = villageWarKey(args.village);
    const stillValidTarget = async (): Promise<Record<string, unknown> | null> => {
        if (await onCooldown(args.targetPlayer, args.now)) return null;
        const save = await store.get<Record<string, unknown>>(targetSaveKey);
        const ch = (save?.character ?? null) as Record<string, unknown> | null;
        if (!ch || String(ch.village ?? '').trim() !== args.targetVillage) return null;
        return save ?? null;
    };

    // (1) A route-level target lookup is only advisory: village transfer/autosave
    // can race it. Hold the same save lock those writes use and read the exact
    // target village under it.
    const snapshot = await lock(targetSaveKey, stillValidTarget);
    if (!snapshot) return null;

    // (2) Everything that can fail without a fight happening, before any spend.
    const sealed = await prepareFighter(snapshot);
    if (!sealed) return null;

    // (3) Re-check under the lock and only THEN spend a band member. Keeping the
    // cooldown check and stamp inside that lock also prevents two concurrent
    // deploys from both passing the old pre-claim cooldown read.
    const bandKey = args.bandKey ?? `${args.tierId}:${args.hirer}`;
    const claim = await lock(targetSaveKey, async () => {
        if (!(await stillValidTarget())) return null;
        return lock(warKey, async () => {
            const rec = normalizeVillageWarRecord(args.village, (await store.get<Record<string, unknown>>(warKey)) ?? undefined);
            const lease = rec.mercLeases.find((l) => mercBandKey(l) === bandKey && l.expiresAt > args.now);
            // A band only ever fights in the war it was hired for.
            if (!lease || (args.context && !leaseServes(lease, args.context))) return null;
            const out = claimMercFromBandKey(rec.mercLeases, bandKey, args.now);
            if (!out.claimed) return null;
            await store.set(warKey, { ...rec, mercLeases: out.leases });
            return { remaining: out.remaining, lease: { ...lease } };
        });
    });
    if (!claim) return null;
    // The merc commits to this valid target → 15-min cooldown for the whole
    // band (win, lose, or stall), so it cannot re-hit the same player.
    await stampCooldown(args.targetPlayer, args.now);

    // (4) Resolve. A throw here would otherwise burn a merc with no battle.
    const seed = (args.now ^ (args.sector * 2654435761)) >>> 0;
    try {
        const battle = runFight(sealed, { ...args, seed });
        return { battle, mercsRemaining: claim.remaining, lease: claim.lease };
    } catch (err) {
        await returnMercToBand(args.village, claim.lease, { store, lock });
        throw err;
    }
}

/** Put a claimed merc back in its band — one that never fought, or whose fight
 *  could not be applied to its war. The lease is re-created at its original
 *  expiry (same id, same war) when the claim emptied it. Best-effort: a failure
 *  here is logged, never rethrown over the original error. */
export async function returnMercToBand(
    village: string,
    lease: MercLease,
    io: { store?: NonNullable<MercClaimDeps['store']>; lock?: NonNullable<MercClaimDeps['lock']> } = {},
): Promise<void> {
    const store = io.store ?? kv;
    const lock = io.lock ?? (<T>(key: string, fn: () => Promise<T>) => withKvLock(key, fn, { failClosed: true }));
    const warKey = villageWarKey(village);
    const bandKey = mercBandKey(lease);
    try {
        await lock(warKey, async () => {
            const rec = normalizeVillageWarRecord(village, (await store.get<Record<string, unknown>>(warKey)) ?? undefined);
            const has = rec.mercLeases.some((l) => mercBandKey(l) === bandKey);
            const { skipNextAutoDeploy: _skip, ...restored } = lease;
            const mercLeases = has
                ? rec.mercLeases.map((l) => (mercBandKey(l) === bandKey ? { ...l, count: l.count + 1 } : l))
                : [...rec.mercLeases, { ...restored, count: 1 }];
            await store.set(warKey, { ...rec, mercLeases });
        });
    } catch (err) {
        console.error('[merc-auto] could not return the merc to its band:', (err as Error).message);
    }
}

/** Resolve ONE merc of a DEFENDING village's band against an ATTACKING-village
 *  player in a Combat sector war, and score it. SHARED by the manual war-merc
 *  `attack` action, the roaming encounter and the autonomous tick.
 *
 *  Scoring (owner ruling 2026-10-08, `mercSide: 'defender'`): a band win scores
 *  the DEFENCE in full, role-weighted (merc vs the attacker's rank, the
 *  defender's Watchtower applies); an attacker who beats the band scores the
 *  attack at MERC_REPEL_POINTS_FRACTION; a stall is inert. Merc battles are AI
 *  battles: they never refresh `lastLiveBattleAt`. Receipt `by` is the human
 *  winner (the attacker who repelled it) or '' — a merc win earns no capture
 *  credit.
 *
 *  Returns null — and spends nothing — if the band is spent, serves another
 *  war, or the target is on the 15-minute cooldown. A merc that fought but whose
 *  result could not be applied (the war ended or was replaced, or the commit
 *  threw) is returned to its band. */
export async function deployOneMerc(args: {
    /** The band's village: the contest's DEFENDER. */
    village: string;
    tierId: string;
    hirer: string;
    bandKey?: string;
    sector: number;
    /** An ATTACKING-village player. */
    targetPlayer: string;
    /** The contest's attacker village. */
    targetVillage: string;
    contestId: string;
    /** The contest instance the band was hired for (sectorWarInstanceTag). */
    instance: string;
    mercLevel: number;
    now: number;
}, deps: Pick<MercClaimDeps, 'prepareFighter' | 'runFight'> = {}): Promise<MercDeployResult | null> {
    const context: MercLeaseContext = { kind: 'sector', contestId: args.contestId, instance: args.instance, sector: args.sector };
    const resolved = await claimAndResolveMerc({ ...args, context }, deps);
    if (!resolved) return null;
    const { battle, mercsRemaining, lease } = resolved;
    // A stall is inert by design: the merc is spent, nothing scores.
    if (!battle.mercWon && !battle.playerWon) {
        return { winner: battle.winner, attackerPoints: 0, defenderPoints: 0, mercsRemaining };
    }

    // The human is the attacker, so the attack wins exactly when the merc loses.
    const attackerWon = battle.playerWon;
    const by = attackerWon ? safeName(args.targetPlayer) : '';
    let result: Awaited<ReturnType<typeof commitSectorWarBattle>>;
    try {
        const playerRole = await sectorWarRoleOf(args.targetPlayer, args.targetVillage);
        result = await commitSectorWarBattle({
            contestId: args.contestId,
            // targetPlayer in the id: two mercs striking DIFFERENT players in the
            // same millisecond must not collide into one receipt (the dedupe
            // would silently drop the second battle's points).
            battleId: `merc:${args.contestId}:${args.targetPlayer}:${args.now}`,
            decide: async (live): Promise<SectorWarBattleDecision> => {
                // A settled war's row is no longer written, and a band hired for
                // one war on this sector never scores the war after it.
                if (live.flipped || live.expiredAt) return { kind: 'skip', reason: 'terminal' };
                if (args.now < live.startedAt
                    || sectorWarInstanceTag(live) !== args.instance
                    || live.defenderVillage !== args.village
                    || live.attackerVillage !== args.targetVillage) return { kind: 'skip', reason: 'superseded' };
                const [atkRaw, defRaw] = await Promise.all([
                    kv.get<Record<string, unknown>>(villageWarKey(live.attackerVillage)),
                    kv.get<Record<string, unknown>>(villageWarKey(live.defenderVillage)),
                ]);
                const atkRecord = normalizeVillageWarRecord(live.attackerVillage, atkRaw ?? undefined);
                const defRecord = normalizeVillageWarRecord(live.defenderVillage, defRaw ?? undefined);
                // Winner's weight + the loser's rank penalty: a Kage who falls to
                // the band is a full bounty for the defence; a Kage who cuts it
                // down scores more for the attack (at the repel fraction).
                const roleSwing = battle.mercWon
                    ? sectorControlSwing(ROLE_MERC, playerRole)
                    : sectorControlSwing(playerRole, ROLE_MERC);
                const outcome = applySectorWarBattle(live, attackerWon, {
                    now: args.now,
                    roleSwing,
                    attackerMult: sectorWarDamageMultiplier(atkRecord),
                    defenderMult: defenderPointsMultiplier(defRecord),
                    by,
                    mercBattle: true,
                    mercSide: 'defender',
                });
                return { kind: 'score', outcome, attackerWon, by, at: args.now };
            },
        });
    } catch (err) {
        await returnMercToBand(args.village, lease);
        throw err;
    }
    if (result.status !== 'applied') {
        // The war is over or was replaced: the fight changed nothing, so the
        // merc goes back (it can only ever serve this war, so it simply idles).
        await returnMercToBand(args.village, lease);
        return null;
    }
    return {
        winner: battle.winner,
        attackerPoints: result.session.attackerPoints,
        defenderPoints: result.session.defenderPoints,
        mercsRemaining,
    };
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
 *  finish), a player win / stall is inert. Returns null if the band is spent,
 *  serves another war, or the target is on the 15-min cooldown. A merc WIN whose
 *  damage could not land (the war ended or froze meanwhile, or the write threw)
 *  is returned to its band — it fought for nothing. */
export async function deployMercVillageWar(args: {
    village: string;       // the band's village
    enemyVillage: string;
    tierId: string;
    hirer: string;
    bandKey?: string;
    /** The war instance the band serves (a legacy band serves any of its village's). */
    war?: { id: string; generation: number };
    sector: number;
    targetPlayer: string;
    mercLevel: number;
    now: number;
}, deps: Pick<MercClaimDeps, 'prepareFighter' | 'runFight'> = {}): Promise<MercVillageWarResult | null> {
    const context = args.war ? villageWarContext(args.war) : null;
    const resolved = await claimAndResolveMerc({ ...args, targetVillage: args.enemyVillage, context }, deps);
    if (!resolved) return null;
    const { battle, mercsRemaining, lease } = resolved;

    let enemyWarHp: number | null = null;
    if (battle.mercWon) {
        let dmg: Awaited<ReturnType<typeof applyMercVillageWarDamage>>;
        try {
            dmg = await applyMercVillageWarDamage(args.village, args.enemyVillage, MERC_VILLAGE_WAR_DAMAGE, args.now);
        } catch (err) {
            await returnMercToBand(args.village, lease);
            throw err;
        }
        if (!dmg) {
            await returnMercToBand(args.village, lease);
            return null;
        }
        enemyWarHp = dmg.enemyHp;
    }
    return { winner: battle.winner, enemyWarHp, mercsRemaining };
}

/** Raid ONE sleeper camp as an NPC: cooldown-gated + stamped under the target's
 *  save lock, then the shared sleeper-KO settlement (hospital + village + camp
 *  cleared). `sector` pins the camp — if it moved, the raid is refused. Returns
 *  true only if the KO landed. Lock contention is a quiet "not this tick". */
export async function raidSleeperCamp(args: { targetPlayer: string; sector: number; now: number; attackerVillage: string }): Promise<boolean> {
    const slug = safeName(args.targetPlayer);
    if (!slug) return false;
    try {
        const ko = await settleSleeperKo(slug, {
            now: args.now,
            expectSector: args.sector,
            gate: async () => !(await isMercTargetOnCooldown(slug, args.now)),
            afterKo: () => setMercTargetCooldown(slug, args.now),
        });
        const result = ko.status === 200;
        if (result === true) {
            // The victim wakes in the hospital with no idea why — leave them a
            // note for their next heartbeat. Best-effort; the raid already landed.
            await pushOfflineNotice(slug, {
                kind: 'merc-raid',
                by: `${args.attackerVillage} mercenaries`,
                village: args.attackerVillage,
                sector: args.sector,
                at: args.now,
            }).catch((err) => console.error('[merc-auto] offline notice failed', err));
        }
        return result === true;
    } catch (err) {
        if (err instanceof LockContendedError) return false;
        throw err;
    }
}

/** Sleeper camps a merc band can raid: enemy-village campers in the given sector
 *  (or anywhere when `sector` is null — village wars), as RoamTargets so the same
 *  lowest-HP pick order applies. Safe-zone logouts never mint a camp (sector 0 is
 *  rejected at the store), and are filtered again here for belt-and-braces. */
async function sleeperMercTargets(
    camps: readonly SleeperCamp[],
    sector: number | null,
    enemyVillage: string,
    now: number,
    targetsOf: (names: readonly string[], enemyVillage: string, now: number) => Promise<RoamTarget[]>,
): Promise<RoamTarget[]> {
    const names = camps
        .filter((c) => c.sector >= 1 && (sector == null || c.sector === sector))
        .map((c) => c.name);
    if (!names.length) return [];
    return targetsOf(names, enemyVillage, now);
}

/** A live sector-war contest as the tick reads it (a SectorWarSession satisfies it). */
type TickContest = {
    id: string;
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    winCondition: string;
    flipped: boolean;
    startedAt?: number;
    declarationGeneration?: number;
};
/** A live village war as the tick reads it. `id`/`generation` name the instance
 *  its bands must be bound to; without them only legacy bands can serve it. */
type TickVillageWar = { villages: [string, string]; id?: string; generation?: number };
/** The band chosen to act in a war context this tick. */
export type TickBand = { tierId: string; player: string; level: number; key?: string };

// Minimal injectable surfaces so the tick is unit-testable.
type AutoDeps = {
    now?: number;
    listContests?: () => Promise<TickContest[]>;
    listVillageWars?: () => Promise<TickVillageWar[]>;
    onlineNames?: (sector: number) => string[];
    onlineAll?: () => string[];
    /** offline sleeper camps (api/_realtime/sleeper-camps.ts) */
    listSleepers?: () => Promise<SleeperCamp[]>;
    /** the band of `village` that acts in `context` this tick (see activeBand) */
    bandOf?: (village: string, now: number, context: MercLeaseContext | null, skippedThisTick: Set<string>) => Promise<TickBand | null>;
    /** names → live merc marks (village check + cooldown + HP from the save) */
    targetsOf?: (names: readonly string[], enemyVillage: string, now: number) => Promise<RoamTarget[]>;
    deploy?: typeof deployOneMerc;
    deployVillage?: typeof deployMercVillageWar;
    raidSleeper?: typeof raidSleeperCamp;
    /** finishes Honor-Seal strikes the retired Town Hall hire left mid-saga */
    sweepRetiredHires?: (now: number) => Promise<unknown>;
};

export interface MercAutoResult {
    enabled: boolean;
    /** live (online) targets fought this tick */
    deployed: number;
    /** offline sleeper camps KO'd this tick */
    raided: number;
}

/**
 * The band of `village` that acts in `context` this tick (with its tier level),
 * or null if none serves it. Bands act in hire order — the oldest contract first.
 * A null context (a village war whose instance is unknown) admits legacy bands only.
 *
 * Village Stores: a band the daily pass marked UNFED (`skipNextAutoDeploy`) sits
 * out exactly one tick. The flag is cleared on first sight and the band is put
 * in `skippedThisTick`, so it sits out the WHOLE tick — clearing the flag alone
 * used to let a village's second war context deploy the same unfed band in the
 * very tick it was meant to miss. Skipping is per band: another, fed band of the
 * village may still act.
 */
export async function activeBand(
    village: string,
    now: number,
    context: MercLeaseContext | null,
    skippedThisTick: Set<string>,
): Promise<TickBand | null> {
    const rec = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(villageWarKey(village))) ?? undefined);
    const serving = context
        ? bandsServing(rec.mercLeases, context, now)
        : rec.mercLeases.filter((l) => !l.context && l.expiresAt > now && l.count > 0);
    for (const lease of serving) {
        const key = mercBandKey(lease);
        const tickKey = `${villageWarSlug(village)}|${key}`;
        if (skippedThisTick.has(tickKey)) continue;
        if (lease.skipNextAutoDeploy) {
            skippedThisTick.add(tickKey);
            await clearMercSkip(village, key);
            continue;
        }
        const tier = wrMercTierById(lease.tierId);
        if (tier) return { key, tierId: lease.tierId, player: lease.player, level: tier.level };
    }
    return null;
}

/** Clear a band's one-tick stores skip under the war-record lock (pure helper
 *  exported for the test; the live path runs it from activeBand). Addresses
 *  every lease of (tier, hirer) — clearMercSkipForBand addresses ONE band. */
export function clearMercSkipInRecord<T extends { mercLeases: Array<{ tierId: string; player: string; skipNextAutoDeploy?: boolean }> }>(record: T, tierId: string, player: string): T {
    return {
        ...record,
        mercLeases: record.mercLeases.map((l) => {
            if (l.tierId !== tierId || l.player !== player || !l.skipNextAutoDeploy) return l;
            const { skipNextAutoDeploy: _skip, ...rest } = l;
            return rest as typeof l;
        }),
    };
}
/** Clear ONE band's one-tick stores skip (by mercBandKey). Pure. */
export function clearMercSkipForBand<T extends { mercLeases: MercLease[] }>(record: T, bandKey: string): T {
    return {
        ...record,
        mercLeases: record.mercLeases.map((l) => {
            if (mercBandKey(l) !== bandKey || !l.skipNextAutoDeploy) return l;
            const { skipNextAutoDeploy: _skip, ...rest } = l;
            return rest;
        }),
    };
}
async function clearMercSkip(village: string, bandKey: string): Promise<void> {
    try {
        await withKvLock(villageWarKey(village), async () => {
            const rec = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(villageWarKey(village))) ?? undefined);
            await kv.set(villageWarKey(village), clearMercSkipForBand(rec, bandKey));
        }, { failClosed: true });
    } catch (err) {
        if (!(err instanceof LockContendedError)) throw err;
    }
}

/** Live merc targets among a set of online players: only `enemyVillage` members who
 *  are alive and NOT inside the 15-min merc cooldown (so the cron picks the next
 *  mark instead of wasting a deploy on someone just hit). HP comes from the save —
 *  presence carries no reliable HP. */
export async function liveMercTargets(names: readonly string[], enemyVillage: string, now: number): Promise<RoamTarget[]> {
    if (!names.length) return [];
    const slugs = names.map(safeName);
    const saves = await kv.mget<{ character?: Record<string, unknown> }[]>(...slugs.map(slug => `save:${slug}`));
    const out: RoamTarget[] = [];
    for (let index = 0; index < slugs.length; index++) {
        const safe = slugs[index];
        const ch = saves[index]?.character;
        if (!ch || String(ch.village ?? '').trim() !== enemyVillage) continue;
        const hp = Number(ch.hp);
        out.push({ name: safe, village: enemyVillage, hp, maxHp: Number(ch.maxHp) || hp });
    }
    const coolingDown = await mercTargetsOnCooldown(out.map(target => target.name), now);
    return out.filter(target => !coolingDown.has(target.name));
}

/** Live village wars whose bands may act now (hot, not frozen), with the
 *  instance identity their bands are bound to. */
async function actingVillageWars(now: number): Promise<TickVillageWar[]> {
    return (await listVillageWarInstances(now))
        .filter(villageWarActing)
        .map((war) => ({ villages: war.villages, id: war.id, generation: war.generation }));
}

/** One failed war context must never cost the rest of the tick its turn. */
function logTickFailure(scope: string, err: unknown): void {
    if (err instanceof LockContendedError) return; // a busy row: just not this tick
    console.error(`[merc-auto] ${scope} skipped this tick:`, (err as Error)?.message ?? err);
}

/** One autonomous tick (owner redesign 2026-10-08).
 *
 *  Sector wars: each Combat contest's DEFENDING village fields one merc from a
 *  band hired for that contest; it snipes the lowest-HP ATTACKING-village player
 *  in the contested sector (no min-HP gate; the snipe is just the pick order) and
 *  raids one attacker sleeper camp pitched there.
 *  Village wars: each side's band hired for that war (or a legacy band) hunts
 *  the lowest-HP enemy player ANYWHERE, and one enemy sleeper camp in the wild.
 *
 *  One merc per war context per tick, so bands deplete organically; the 15-min
 *  per-target cooldown stops them spamming one player. Each context runs in its
 *  own try/catch: a throw (say, a fail-closed save lock while the target
 *  autosaves) skips that context for this tick and the rest still run. With the
 *  campaign disabled, only the retired-hire sweep runs. */
export async function runMercAutoDeploy(deps: AutoDeps = {}): Promise<MercAutoResult> {
    const now = deps.now ?? Date.now();
    // A retired Town Hall Honor-Seal hire caught mid-saga freezes its village
    // war's row until someone helps it forward. Nobody can start one any more,
    // so the tick is where a stranded one gets finished — even with the Sector
    // Map switched off, because the all-out village war it freezes is not.
    const sweepRetiredHires = deps.sweepRetiredHires ?? ((at: number) => sweepRetiredWarMercenaryHires(at));
    try {
        await sweepRetiredHires(now);
    } catch (err) {
        logTickFailure('retired mercenary sweep', err);
    }
    if (!villageWarMapEnabled()) return { enabled: false, deployed: 0, raided: 0 };
    const listContests = deps.listContests ?? (() => listActiveSectorWars(now));
    const listVillageWars = deps.listVillageWars ?? (() => actingVillageWars(now));
    const onlineNames = deps.onlineNames ?? ((sector: number) => onlineStore.list().filter((p) => p.sector === sector).map((p) => p.name));
    const onlineAll = deps.onlineAll ?? (() => onlineStore.list().map((p) => p.name));
    const listSleepers = deps.listSleepers ?? (async () => [...(await listSleeperCamps()).values()]);
    const bandOf = deps.bandOf ?? activeBand;
    const targetsOf = deps.targetsOf ?? liveMercTargets;
    const deploy = deps.deploy ?? deployOneMerc;
    const deployVillage = deps.deployVillage ?? deployMercVillageWar;
    const raidSleeper = deps.raidSleeper ?? raidSleeperCamp;

    let deployed = 0;
    let raided = 0;
    // Fetched lazily — only a war with a live band ever needs the camp list.
    let sleepers: SleeperCamp[] | null = null;
    const campList = async () => (sleepers ??= await listSleepers());
    const skippedThisTick = new Set<string>();

    // ── Sector wars: the DEFENDER's band snipes the lowest-HP attacker in its
    // contested Combat sector, and raids one attacker sleeper camp pitched there.
    let contests: TickContest[] = [];
    try {
        contests = await listContests();
    } catch (err) {
        logTickFailure('sector-war scan', err);
    }
    for (const contest of contests) {
        try {
            if (contest.winCondition !== 'combat' || contest.flipped) continue;
            const context = sectorContestContext({
                id: contest.id,
                sector: contest.sector,
                startedAt: Number(contest.startedAt) || 0,
                declarationGeneration: contest.declarationGeneration,
            });
            if (context.kind !== 'sector') continue;
            const defender = contest.defenderVillage;
            const attacker = contest.attackerVillage;
            const band = await bandOf(defender, now, context, skippedThisTick);
            if (!band) continue;
            const target = pickMercTarget(await targetsOf(onlineNames(contest.sector), attacker, now), attacker);
            if (target) {
                const r = await deploy({
                    village: defender, tierId: band.tierId, hirer: band.player, bandKey: band.key,
                    sector: contest.sector, targetPlayer: target.name, targetVillage: attacker,
                    contestId: contest.id, instance: context.instance, mercLevel: band.level, now,
                });
                if (r) deployed++;
            }
            const sleeper = pickMercTarget(await sleeperMercTargets(await campList(), contest.sector, attacker, now, targetsOf), attacker);
            if (sleeper && await raidSleeper({ targetPlayer: sleeper.name, sector: contest.sector, now, attackerVillage: defender })) raided++;
        } catch (err) {
            logTickFailure(`sector war ${contest.id}`, err);
        }
    }

    // ── Village wars: each side's band hunts the lowest-HP enemy player anywhere —
    // online, and one enemy sleeper camp anywhere in the wild.
    let wars: TickVillageWar[] = [];
    try {
        wars = await listVillageWars();
    } catch (err) {
        logTickFailure('village-war scan', err);
    }
    for (const war of wars) {
        const context = war.id && war.generation ? villageWarContext({ id: war.id, generation: war.generation }) : null;
        for (const side of war.villages) {
            try {
                const enemy = war.villages.find((v) => v !== side);
                if (!enemy) continue;
                const band = await bandOf(side, now, context, skippedThisTick);
                if (!band) continue;
                const target = pickMercTarget(await targetsOf(onlineAll(), enemy, now), enemy);
                if (target) {
                    const r = await deployVillage({
                        village: side, enemyVillage: enemy, tierId: band.tierId, hirer: band.player, bandKey: band.key,
                        ...(war.id && war.generation ? { war: { id: war.id, generation: war.generation } } : {}),
                        sector: 0, targetPlayer: target.name, mercLevel: band.level, now,
                    });
                    if (r) deployed++;
                }
                const camps = await campList();
                const sleeper = pickMercTarget(await sleeperMercTargets(camps, null, enemy, now, targetsOf), enemy);
                const campSector = sleeper ? (camps.find((c) => c.name === sleeper.name)?.sector ?? 0) : 0;
                if (sleeper && campSector >= 1 && await raidSleeper({ targetPlayer: sleeper.name, sector: campSector, now, attackerVillage: side })) raided++;
            } catch (err) {
                logTickFailure(`village war ${war.id ?? war.villages.join(' vs ')} (${side})`, err);
            }
        }
    }
    return { enabled: true, deployed, raided };
}
