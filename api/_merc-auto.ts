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
 * One raid per siege / per war-side per tick, like the live snipe.
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
import { listSleeperCamps, type SleeperCamp } from './_realtime/sleeper-camps.js';
import { settleSleeperKoLocked } from './player/sleeper-kill.js';
import { pushOfflineNotice } from './player/_offline-notices.js';
import { LockContendedError } from './_lock.js';

export interface MercDeployResult {
    winner: 'merc' | 'player' | 'stall';
    attackerPoints: number;
    defenderPoints: number;
    mercsRemaining: number;
}

export type MercClaimArgs = {
    village: string;
    tierId: string;
    hirer: string;
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
 */
export async function claimAndResolveMerc(
    args: MercClaimArgs,
    deps: MercClaimDeps = {},
): Promise<{ battle: MercBattleResult; mercsRemaining: number } | null> {
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
    const claim = await lock(targetSaveKey, async () => {
        if (!(await stillValidTarget())) return null;
        return lock(warKey, async () => {
            const rec = normalizeVillageWarRecord(args.village, (await store.get<Record<string, unknown>>(warKey)) ?? undefined);
            const lease = rec.mercLeases.find((l) => l.tierId === args.tierId && l.player === args.hirer && l.expiresAt > args.now);
            const out = claimMercFromBand(rec.mercLeases, args.tierId, args.hirer, args.now);
            if (!out.claimed || !lease) return null;
            await store.set(warKey, { ...rec, mercLeases: out.leases });
            return { remaining: out.remaining, expiresAt: lease.expiresAt };
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
        return { battle, mercsRemaining: claim.remaining };
    } catch (err) {
        await returnMercToBand(args, claim.expiresAt, { store, lock });
        throw err;
    }
}

/** Put a claimed-but-unfought merc back in its band (the lease is re-created at
 *  its original expiry when the claim emptied it). Best-effort: a failure here
 *  is logged, never rethrown over the original fight error. */
async function returnMercToBand(
    args: MercClaimArgs,
    expiresAt: number,
    io: { store: NonNullable<MercClaimDeps['store']>; lock: NonNullable<MercClaimDeps['lock']> },
): Promise<void> {
    const warKey = villageWarKey(args.village);
    try {
        await io.lock(warKey, async () => {
            const rec = normalizeVillageWarRecord(args.village, (await io.store.get<Record<string, unknown>>(warKey)) ?? undefined);
            const has = rec.mercLeases.some((l) => l.tierId === args.tierId && l.player === args.hirer);
            const mercLeases = has
                ? rec.mercLeases.map((l) => (l.tierId === args.tierId && l.player === args.hirer ? { ...l, count: l.count + 1 } : l))
                : [...rec.mercLeases, { tierId: args.tierId, player: args.hirer, expiresAt, count: 1 }];
            await io.store.set(warKey, { ...rec, mercLeases });
        });
    } catch (err) {
        console.error('[merc-auto] could not return the unfought merc to its band:', (err as Error).message);
    }
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

/** Raid ONE sleeper camp as an NPC: cooldown-gated + stamped under the target's
 *  save lock, then the shared sleeper-KO settlement (hospital + village + camp
 *  cleared). `sector` pins the camp — if it moved, the raid is refused. Returns
 *  true only if the KO landed. Lock contention is a quiet "not this tick". */
export async function raidSleeperCamp(args: { targetPlayer: string; sector: number; now: number; attackerVillage: string }): Promise<boolean> {
    const slug = safeName(args.targetPlayer);
    if (!slug) return false;
    try {
        const result = await withKvLock(`save:${slug}`, async () => {
            if (await isMercTargetOnCooldown(slug, args.now)) return false;
            // We hold save:<slug>, so use the locked settlement directly.
            const ko = await settleSleeperKoLocked(slug, { now: args.now, expectSector: args.sector });
            if (ko.status !== 200) return false;
            await setMercTargetCooldown(slug, args.now);
            return true;
        }, { failClosed: true });
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

// Minimal injectable surfaces so the tick is unit-testable.
type AutoDeps = {
    now?: number;
    listContests?: () => Promise<Array<{ id: string; sector: number; attackerVillage: string; defenderVillage: string; winCondition: string; flipped: boolean }>>;
    listVillageWars?: () => Promise<Array<{ villages: [string, string] }>>;
    onlineNames?: (sector: number) => string[];
    onlineAll?: () => string[];
    /** offline sleeper camps (api/_realtime/sleeper-camps.ts) */
    listSleepers?: () => Promise<SleeperCamp[]>;
    /** the attacker village's live merc band */
    bandOf?: (village: string, now: number) => Promise<{ tierId: string; player: string; level: number } | null>;
    /** names → live merc marks (village check + cooldown + HP from the save) */
    targetsOf?: (names: readonly string[], enemyVillage: string, now: number) => Promise<RoamTarget[]>;
    deploy?: typeof deployOneMerc;
    deployVillage?: typeof deployMercVillageWar;
    raidSleeper?: typeof raidSleeperCamp;
};

export interface MercAutoResult {
    enabled: boolean;
    /** live (online) targets fought this tick */
    deployed: number;
    /** offline sleeper camps KO'd this tick */
    raided: number;
}

/** The attacker's active merc band (with its tier level), or null if it has none.
 *  Village Stores: a band the daily pass marked UNFED (`skipNextAutoDeploy`) sits
 *  out exactly one tick — the flag is cleared here so the next tick deploys. */
async function activeBand(village: string, now: number): Promise<{ tierId: string; player: string; level: number } | null> {
    const rec = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(villageWarKey(village))) ?? undefined);
    const band = rec.mercLeases.find((l) => l.expiresAt > now && l.count > 0);
    if (!band) return null;
    if (band.skipNextAutoDeploy) {
        await clearMercSkip(village, band.tierId, band.player);
        return null;
    }
    const tier = wrMercTierById(band.tierId);
    return tier ? { tierId: band.tierId, player: band.player, level: tier.level } : null;
}

/** Clear a band's one-tick stores skip under the war-record lock (pure helper
 *  exported for the test; the live path runs it from activeBand). */
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
async function clearMercSkip(village: string, tierId: string, player: string): Promise<void> {
    try {
        await withKvLock(villageWarKey(village), async () => {
            const rec = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(villageWarKey(village))) ?? undefined);
            await kv.set(villageWarKey(village), clearMercSkipInRecord(rec, tierId, player));
        }, { failClosed: true });
    } catch (err) {
        if (!(err instanceof LockContendedError)) throw err;
    }
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
    if (!villageWarMapEnabled()) return { enabled: false, deployed: 0, raided: 0 };
    const now = deps.now ?? Date.now();
    const listContests = deps.listContests ?? listActiveSectorWars;
    const listVillageWars = deps.listVillageWars ?? listActiveVillageWars;
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
    // Fetched lazily — only a siege/war with a live band ever needs the camp list.
    let sleepers: SleeperCamp[] | null = null;
    const campList = async () => (sleepers ??= await listSleepers());

    // ── Sector wars: snipe the lowest-HP enemy defender in each besieged Combat sector,
    // and raid one enemy sleeper camp pitched in that sector.
    for (const contest of await listContests()) {
        if (contest.winCondition !== 'combat' || contest.flipped) continue;
        const band = await bandOf(contest.attackerVillage, now);
        if (!band) continue;
        const target = pickMercTarget(await targetsOf(onlineNames(contest.sector), contest.defenderVillage, now), contest.defenderVillage);
        if (target) {
            const r = await deploy({ village: contest.attackerVillage, tierId: band.tierId, hirer: band.player, sector: contest.sector, targetPlayer: target.name, targetVillage: contest.defenderVillage, contestId: contest.id, mercLevel: band.level, now });
            if (r) deployed++;
        }
        const sleeper = pickMercTarget(await sleeperMercTargets(await campList(), contest.sector, contest.defenderVillage, now, targetsOf), contest.defenderVillage);
        if (sleeper && await raidSleeper({ targetPlayer: sleeper.name, sector: contest.sector, now, attackerVillage: contest.attackerVillage })) raided++;
    }

    // ── Village wars: each side's band hunts the lowest-HP enemy player anywhere —
    // online, and one enemy sleeper camp anywhere in the wild.
    for (const war of await listVillageWars()) {
        for (const attacker of war.villages) {
            const enemy = war.villages.find((v) => v !== attacker);
            if (!enemy) continue;
            const band = await bandOf(attacker, now);
            if (!band) continue;
            const target = pickMercTarget(await targetsOf(onlineAll(), enemy, now), enemy);
            if (target) {
                const r = await deployVillage({ village: attacker, enemyVillage: enemy, tierId: band.tierId, hirer: band.player, sector: 0, targetPlayer: target.name, mercLevel: band.level, now });
                if (r) deployed++;
            }
            const camps = await campList();
            const sleeper = pickMercTarget(await sleeperMercTargets(camps, null, enemy, now, targetsOf), enemy);
            const campSector = sleeper ? (camps.find((c) => c.name === sleeper.name)?.sector ?? 0) : 0;
            if (sleeper && campSector >= 1 && await raidSleeper({ targetPlayer: sleeper.name, sector: campSector, now, attackerVillage: attacker })) raided++;
        }
    }
    return { enabled: true, deployed, raided };
}
