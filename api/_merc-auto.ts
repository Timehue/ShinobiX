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
import { captureSectorForVillage } from './world-state.js';
import { sealTowerFighter } from './towers/_seal.js';
import { resolveMercBattle } from './towers/_merc-fighters.js';
import { claimMercFromBand } from './_war-merc.js';
import { wrMercTierById } from './_war-economy.js';
import { recordWarEcoEvent } from './_war-telemetry.js';
import { onlineStore } from './_realtime/online-store.js';

// Mercs only auto-snipe a defender whose HP has dropped to/under this fraction of
// max — the "snipe low-health players" rule. Tunable.
export const MERC_SNIPE_HP_FRACTION = 0.5;

export interface MercDeployResult {
    winner: 'merc' | 'player' | 'stall';
    captured: boolean;
    controlHp: number;
    mercsRemaining: number;
}

/** Resolve ONE merc deployment against a target + apply it to the contest. SHARED
 *  by the manual war-merc `attack` action and the autonomous tick. Claims a merc
 *  from the hirer's band (atomic), hydrates the target's real loadout, runs the
 *  server-auth battle, applies the outcome under the contest lock (merc win → full
 *  chip + flip-on-capture; player win → 25% regen; stall → inert), and spends the
 *  merc. Returns null if the band is spent or the target save is missing. */
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
    // 1. Claim one merc from the hirer's band (rejects if it's spent).
    const claim = await withKvLock(villageWarKey(args.village), async () => {
        const rec = normalizeVillageWarRecord(args.village, (await kv.get<Record<string, unknown>>(villageWarKey(args.village))) ?? undefined);
        const out = claimMercFromBand(rec.mercLeases, args.tierId, args.hirer, args.now);
        if (!out.claimed) return { claimed: false as const, remaining: 0 };
        await kv.set(villageWarKey(args.village), { ...rec, mercLeases: out.leases });
        return { claimed: true as const, remaining: out.remaining };
    }, { failClosed: true });
    if (!claim.claimed) return null;

    // 2. Hydrate the target's real combat loadout + resolve the battle (server-auth).
    const targetSave = await kv.get<Record<string, unknown>>(`save:${args.targetPlayer}`);
    const targetChar = (targetSave?.character ?? null) as Record<string, unknown> | null;
    if (!targetChar) return { winner: 'stall', captured: false, controlHp: 0, mercsRemaining: claim.remaining };
    const sealed = sealTowerFighter(targetChar, targetSave ?? null, {});
    const seed = (args.now ^ (args.sector * 2654435761)) >>> 0;
    const battle = resolveMercBattle({ playerName: args.targetPlayer, playerSlug: args.targetPlayer, playerSealedChar: sealed, mercLevel: args.mercLevel, seed, now: args.now });

    // 3. Apply to the contest Control HP under its lock.
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
    return { winner: battle.winner, captured, controlHp, mercsRemaining: claim.remaining };
}

export interface SnipeCandidate {
    name: string;
    village: string;
    hp: number;
    maxHp: number;
}

/** Pure: the lowest-HP defender-village candidate at/under the snipe threshold (the
 *  merc's prey), or null if none qualifies. Ties break by name for determinism. */
export function pickSnipeTarget(
    candidates: readonly SnipeCandidate[],
    defenderVillage: string,
    threshold = MERC_SNIPE_HP_FRACTION,
): SnipeCandidate | null {
    const eligible = candidates
        .filter((c) => c.village === defenderVillage && c.hp > 0 && c.maxHp > 0 && c.hp / c.maxHp <= threshold)
        .sort((a, b) => (a.hp / a.maxHp - b.hp / b.maxHp) || (a.name < b.name ? -1 : 1));
    return eligible[0] ?? null;
}

// Minimal injectable surfaces so the tick is unit-testable.
type AutoDeps = {
    now?: number;
    listContests?: () => Promise<Array<{ id: string; sector: number; attackerVillage: string; defenderVillage: string; winCondition: string; flipped: boolean }>>;
    onlineNames?: (sector: number) => string[];
    deploy?: typeof deployOneMerc;
};

export interface MercAutoResult { enabled: boolean; deployed: number; }

/** One autonomous tick: for every active Combat siege, a merc from the attacker's
 *  band snipes the lowest-HP enemy defender currently standing in that sector. One
 *  merc per siege per tick, so a band depletes organically as prey appears. No-op
 *  unless ENABLE_VILLAGE_WAR=1. */
export async function runMercAutoDeploy(deps: AutoDeps = {}): Promise<MercAutoResult> {
    if (process.env.ENABLE_VILLAGE_WAR !== '1') return { enabled: false, deployed: 0 };
    const now = deps.now ?? Date.now();
    const listContests = deps.listContests ?? listActiveSectorWars;
    const onlineNames = deps.onlineNames ?? ((sector: number) => onlineStore.list().filter((p) => p.sector === sector).map((p) => p.name));
    const deploy = deps.deploy ?? deployOneMerc;

    let deployed = 0;
    const contests = await listContests();
    for (const contest of contests) {
        if (contest.winCondition !== 'combat' || contest.flipped) continue;
        const village = contest.attackerVillage;
        const rec = normalizeVillageWarRecord(village, (await kv.get<Record<string, unknown>>(villageWarKey(village))) ?? undefined);
        const band = rec.mercLeases.find((l) => l.expiresAt > now && l.count > 0);
        if (!band) continue;

        // The defenders standing in the contested sector right now, with HP from
        // their save (presence carries no reliable HP; few candidates per sector).
        const candidates: SnipeCandidate[] = [];
        for (const name of onlineNames(contest.sector)) {
            const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${safeName(name)}`);
            const ch = save?.character;
            if (!ch) continue;
            const hp = Number(ch.hp);
            const maxHp = Number(ch.maxHp) || hp;
            candidates.push({ name: safeName(name), village: String(ch.village ?? '').trim(), hp, maxHp });
        }
        const target = pickSnipeTarget(candidates, contest.defenderVillage);
        if (!target) continue;

        const tier = wrMercTierById(band.tierId);
        if (!tier) continue;
        const r = await deploy({ village, tierId: band.tierId, hirer: band.player, sector: contest.sector, targetPlayer: target.name, contestId: contest.id, mercLevel: tier.level, now });
        if (r) deployed++;
    }
    return { enabled: true, deployed };
}
