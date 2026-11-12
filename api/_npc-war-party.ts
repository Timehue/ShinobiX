/**
 * Cinderhold's war party (Push 4, 2026-11-10): how an NPC village with no
 * players presses a sector war, on either side.
 *
 * Without this a Cinderhold siege could only score when a defender walked up
 * to an NPC and lost, and a siege on Cinderhold could be won by never meeting
 * one. Each tick, for every live Combat sector war with Cinderhold on one side,
 * ONE free Cinderhold war participant (api/_npc-war-roster.ts
 * npcWarParticipants: its ANBU first, then its Genin and Chunin at level 15+)
 * strikes:
 *   - an enemy player standing in the contested sector (lowest HP first,
 *     honouring the shared 15-minute merc-target cooldown) is ATTACKED for
 *     real (owner ruling 2026-11-10): a shinobi standing in that sector opens a
 *     world duel exactly as a player would (api/_npc-war-strike.ts), which the
 *     server plays and which scores the war like any duel there; or
 *   - when Cinderhold is attacking and no defender has fought for the garrison
 *     idle window, the defending village's garrison (its sealed ANBU or Kage),
 *     auto-resolved on the server (resolveMercBattle) as a player's garrison
 *     assault is: an NPC win scores at garrison weight under the war's cap, a
 *     garrison that holds scores the defence like a merc repel, a stall nothing.
 * A possessed, wounded, logged-off or busy NPC sits the tick out.
 */
import { kv } from './_storage.js';
import { withKvLock, LockContendedError } from './_lock.js';
import { safeName } from './_utils.js';
import { loadAdminCombatContent } from './_admin-content.js';
import { loadAdminJutsuObjects } from './_admin-jutsu-catalog.js';
import { resolvePveGapClosingJutsu, type AiOpponentJutsu } from './_ai-opponent-loadout.js';
import { augmentSaveWithForgedDefs } from './_forged-item-registry.js';
import { sealTowerFighter } from './towers/_seal.js';
import { resolveMercBattle, type MercBattleResult } from './towers/_merc-fighters.js';
import { normalizeVillageWarRecord, villageWarKey } from './_war-state.js';
import { ROLE_ANBU, sectorControlSwing, sectorWarRoleOf, type RoleWeights } from './_war-role.js';
import { defenderPointsMultiplier, sectorWarDamageMultiplier } from './_war-structures.js';
import { applySectorWarBattle, isGarrisonAssaultable, sectorWarInstanceTag, type SectorWarSession } from './_sector-war.js';
import { commitSectorWarBattle, listActiveSectorWars, type SectorWarBattleDecision } from './_sector-war-store.js';
import { mercTargetsOnCooldown, pickMercTarget, setMercTargetCooldown, type RoamTarget } from './_merc-roam.js';
import { fieldGarrisonDefender } from './_sector-war-garrison-defender.js';
import { getOrSealAnbuSnapshot } from './_anbu-infiltration-store.js';
import { onlineStore } from './_realtime/online-store.js';
import { villageWarMapEnabled } from './_release-flags.js';
import { npcVillageClosed } from './_npc-village-switch.js';
import { isNpcPossessed } from './_npc-possession.js';
import { npcEngaged } from './_npc-duel.js';
import { isNpcWounded, woundNpc } from './_npc-wounds.js';
import { npcOffDuty } from './_npc-presence.js';
import { NPC_VILLAGE } from '../shared/npc-village.js';
import { isNpcAccount, type NpcShinobi } from '../shared/npc-village-roster.js';
import { isNpcWarDefenderRank, npcWarParticipants } from './_npc-war-roster.js';
import { npcStandsIn, openNpcWarDuel, type NpcWarDuel } from './_npc-war-strike.js';

export const NPC_WAR_PARTY_TICK_MS = 10 * 60 * 1000;

type Contest = Pick<SectorWarSession, 'id' | 'sector' | 'attackerVillage' | 'defenderVillage' | 'winCondition' | 'flipped' | 'expiredAt' | 'startedAt' | 'endsAt' | 'lastLiveBattleAt' | 'declarationGeneration'>;
type Sealed = { npc: NpcShinobi; name: string; level: number; character: Record<string, unknown> };
/** A garrison strike is settled at once; a strike on a player opens a real duel (`battleId`) that settles when it is fought. */
export type NpcWarStrike = { contestId: string; kind: 'player' | 'garrison'; npc: string; target: string; winner: MercBattleResult['winner'] | 'duel'; attackerWon: boolean | null; awarded: number; battleId?: string };

export type NpcWarPartyDeps = {
    now?: number;
    listContests?: (now: number) => Promise<Contest[]>;
    /** Non-NPC presences in a sector. */
    onlineIn?: (sector: number) => string[];
    targetsOf?: (names: readonly string[], enemyVillage: string, now: number) => Promise<RoamTarget[]>;
    npcFree?: (npcId: string, now: number) => Promise<boolean>;
    sealNpc?: (npc: NpcShinobi) => Promise<Sealed | null>;
    sealPlayer?: (player: string, village: string, now: number) => Promise<Record<string, unknown> | null>;
    garrisonOf?: (village: string) => Promise<{ slug: string; character: Record<string, unknown> } | null>;
    runFight?: (args: Parameters<typeof resolveMercBattle>[0]) => MercBattleResult;
    commit?: typeof commitSectorWarBattle;
    roleOf?: (name: string, village: string) => Promise<RoleWeights>;
    wound?: (npc: string, now: number, by?: string) => Promise<void>;
    /** Whether this NPC stands in the sector, free to attack (onlineStore). */
    standsIn?: (npc: NpcShinobi, sector: number) => boolean;
    /** Opens the real world duel (api/_npc-war-strike.ts). */
    openDuel?: (npc: NpcShinobi, target: string, sector: number) => Promise<NpcWarDuel>;
    /** Who may strike (npcWarParticipants: the ANBU, then Genin and Chunin at level 15+). */
    participants?: (now: number) => Promise<readonly NpcShinobi[]>;
};

/** Which side Cinderhold fights on in this war, or null when it is not in it. */
export function npcSideOf(contest: Pick<Contest, 'attackerVillage' | 'defenderVillage'>): 'attacker' | 'defender' | null {
    return contest.attackerVillage === NPC_VILLAGE ? 'attacker' : contest.defenderVillage === NPC_VILLAGE ? 'defender' : null;
}

/** Free to strike: not admin-played, not wounded, not logged off for the day (a player offline fights no one), not mid-fight. */
async function defaultNpcFree(npcId: string, now: number): Promise<boolean> {
    if (npcOffDuty(npcId, now)) return false;
    return !(await isNpcPossessed(npcId, now)) && !(await isNpcWounded(npcId, now)) && !(await npcEngaged(npcId, now));
}

async function defaultSealNpc(npc: NpcShinobi): Promise<Sealed | null> {
    const save = await augmentSaveWithForgedDefs(await kv.get<Record<string, unknown>>(`save:${npc.id}`));
    const ch = (save?.character ?? null) as Record<string, unknown> | null;
    if (!ch) return null;
    return { npc, name: String(ch.name ?? npc.name), level: Math.max(1, Math.floor(Number(ch.level) || 1)), character: sealTowerFighter(ch, save ?? null, {}, await loadAdminCombatContent()) };
}

/** The enemy's sealed kit, read under its save lock and only while it is still in that village. */
async function defaultSealPlayer(player: string, village: string): Promise<Record<string, unknown> | null> {
    const key = `save:${safeName(player)}`;
    return withKvLock(key, async () => {
        const save = await augmentSaveWithForgedDefs(await kv.get<Record<string, unknown>>(key));
        const ch = (save?.character ?? null) as Record<string, unknown> | null;
        if (!ch || String(ch.village ?? '').trim() !== village) return null;
        return sealTowerFighter(ch, save ?? null, {}, await loadAdminCombatContent());
    }, { failClosed: true });
}

async function defaultGarrisonOf(village: string): Promise<{ slug: string; character: Record<string, unknown> } | null> {
    const fielded = await fieldGarrisonDefender(village, (slug) => getOrSealAnbuSnapshot(village, slug));
    return fielded.ok ? { slug: fielded.defender.slug, character: fielded.fielded.character } : null;
}

let gapClosing: AiOpponentJutsu[] | null = null;
async function gapClosingJutsu(): Promise<AiOpponentJutsu[]> {
    return gapClosing ??= resolvePveGapClosingJutsu({ jutsu: await loadAdminJutsuObjects(), items: new Map() });
}

/**
 * The free war participant whose turn it is (rotation by tick), sealed from its
 * save. Its ANBU first, then (owner ruling 2026-11-11) its Genin and Chunin at
 * level 15 or more, each group rotating on its own. `where` keeps it to one
 * that can reach the target.
 */
async function pickStriker(contest: Contest, now: number, deps: Required<Pick<NpcWarPartyDeps, 'npcFree' | 'sealNpc'>>, used: Set<string>, participants: readonly NpcShinobi[], where: (npc: NpcShinobi) => boolean = () => true): Promise<Sealed | null> {
    const groups = [participants.filter((npc) => isNpcWarDefenderRank(npc.rank)), participants.filter((npc) => !isNpcWarDefenderRank(npc.rank))];
    for (const group of groups) {
        const n = group.length;
        if (!n) continue;
        const start = (Math.floor(now / NPC_WAR_PARTY_TICK_MS) + contest.sector) % n;
        for (let i = 0; i < n; i++) {
            const npc = group[(start + i) % n]!;
            if (used.has(npc.id) || !where(npc) || !(await deps.npcFree(npc.id, now))) continue;
            const sealed = await deps.sealNpc(npc);
            if (sealed) { used.add(npc.id); return sealed; }
        }
    }
    return null;
}

/**
 * Score one resolved war-party fight. The id names the war and the target, so
 * a retried tick for the same moment can never score twice, and the decision
 * re-checks under the war's lock that this is still the same war instance.
 */
async function scoreStrike(contest: Contest, args: {
    battleId: string; npcSide: 'attacker' | 'defender'; npcWon: boolean; npcRole: RoleWeights; enemyRole: RoleWeights;
    garrison: boolean; by: string; now: number; instance: string;
}, commit: typeof commitSectorWarBattle) {
    const attackerWon = args.npcSide === 'attacker' ? args.npcWon : !args.npcWon;
    return commit({
        contestId: contest.id,
        battleId: args.battleId,
        decide: async (live): Promise<SectorWarBattleDecision> => {
            if (live.flipped || live.expiredAt) return { kind: 'skip', reason: 'terminal' };
            if (args.now < live.startedAt || sectorWarInstanceTag(live) !== args.instance
                || live.attackerVillage !== contest.attackerVillage || live.defenderVillage !== contest.defenderVillage) {
                return { kind: 'skip', reason: 'superseded' };
            }
            const [atkRaw, defRaw] = await Promise.all([
                kv.get<Record<string, unknown>>(villageWarKey(live.attackerVillage)),
                kv.get<Record<string, unknown>>(villageWarKey(live.defenderVillage)),
            ]);
            const roleSwing = args.npcWon ? sectorControlSwing(args.npcRole, args.enemyRole) : sectorControlSwing(args.enemyRole, args.npcRole);
            const outcome = applySectorWarBattle(live, attackerWon, {
                now: args.now,
                roleSwing,
                attackerMult: sectorWarDamageMultiplier(normalizeVillageWarRecord(live.attackerVillage, atkRaw ?? undefined)),
                defenderMult: defenderPointsMultiplier(normalizeVillageWarRecord(live.defenderVillage, defRaw ?? undefined)),
                by: args.by,
                // A garrison taken scores at garrison weight under the war's cap;
                // a garrison that holds, or any fight with the party, is an AI
                // fight scored like a merc band fighting for Cinderhold's side.
                ...(args.garrison
                    ? (attackerWon ? { garrisonBattle: true, supportMultiplier: 1 } : { mercBattle: true })
                    : { mercBattle: true, mercSide: args.npcSide }),
            });
            // Never a purse win: the party strikes whoever stands in the sector,
            // so a player could idle there and collect. It scores the war only.
            return { kind: 'score', outcome, attackerWon, by: args.by, at: args.now, purseEligible: false };
        },
    });
}

/** One tick of every Cinderhold war. Never throws: one war's failure skips only that war. */
export async function runNpcWarParty(deps: NpcWarPartyDeps = {}): Promise<NpcWarStrike[]> {
    // Closed (the kill switch, or no session tokens): players cannot fight
    // Cinderhold then, so it scores nothing either, garrison assaults included.
    if (npcVillageClosed() || !villageWarMapEnabled()) return [];
    const now = deps.now ?? Date.now();
    const d = {
        listContests: deps.listContests ?? ((at: number) => listActiveSectorWars(at)),
        onlineIn: deps.onlineIn ?? ((sector: number) => onlineStore.list().filter((p) => p.sector === sector && !isNpcAccount(p.name)).map((p) => p.name)),
        targetsOf: deps.targetsOf ?? defaultTargetsOf,
        npcFree: deps.npcFree ?? defaultNpcFree,
        sealNpc: deps.sealNpc ?? defaultSealNpc,
        sealPlayer: deps.sealPlayer ?? defaultSealPlayer,
        garrisonOf: deps.garrisonOf ?? defaultGarrisonOf,
        runFight: deps.runFight ?? resolveMercBattle,
        commit: deps.commit ?? commitSectorWarBattle,
        roleOf: deps.roleOf ?? sectorWarRoleOf,
        wound: deps.wound ?? woundNpc,
        standsIn: deps.standsIn ?? npcStandsIn,
        openDuel: deps.openDuel ?? openNpcWarDuel,
        participants: deps.participants ?? npcWarParticipants,
    };
    let contests: Contest[] = [];
    try { contests = await d.listContests(now); } catch (err) { logSkip('scan', err); return []; }
    const strikes: NpcWarStrike[] = [];
    const used = new Set<string>();
    let participants: readonly NpcShinobi[] | null = null;
    for (const contest of contests) {
        const npcSide = npcSideOf(contest);
        if (!npcSide || contest.winCondition !== 'combat' || contest.flipped || contest.expiredAt) continue;
        try {
            participants ??= await d.participants(now);
            const strike = await strikeOnce(contest, npcSide, now, d, used, participants, deps.runFight ? [] : await gapClosingJutsu());
            if (strike) strikes.push(strike);
        } catch (err) {
            logSkip(`war ${contest.id}`, err);
        }
    }
    return strikes;
}

async function strikeOnce(
    contest: Contest, npcSide: 'attacker' | 'defender', now: number,
    d: Required<Omit<NpcWarPartyDeps, 'now'>>, used: Set<string>, participants: readonly NpcShinobi[], gapJutsu: AiOpponentJutsu[],
): Promise<NpcWarStrike | null> {
    const enemyVillage = npcSide === 'attacker' ? contest.defenderVillage : contest.attackerVillage;
    const instance = sectorWarInstanceTag(contest as SectorWarSession);
    const seed = (now ^ (contest.sector * 2654435761)) >>> 0;

    const target = pickMercTarget(await d.targetsOf(d.onlineIn(contest.sector), enemyVillage, now), enemyVillage);
    if (target) {
        // Only a shinobi standing in the sector can attack someone there, as
        // for a player: the front squad (api/_npc-presence.ts) is who strikes.
        const striker = await pickStriker(contest, now, d, used, participants, (npc) => d.standsIn(npc, contest.sector));
        if (!striker) return null;
        const duel = await d.openDuel(striker.npc, target.name, contest.sector);
        // Refused at admission (they are travelling, recovering, protected,
        // already fighting...): no strike this tick, as a player's attack would fail.
        if (!duel.ok) return null;
        // Committed to this target: the shared merc cooldown, win or lose.
        await setMercTargetCooldown(target.name, now);
        return { contestId: contest.id, kind: 'player', npc: striker.npc.id, target: target.name, winner: 'duel', attackerWon: null, awarded: 0, battleId: duel.battleId };
    }

    // No defender to strike: an attacking Cinderhold storms the garrison once
    // the defence has stayed away for the idle window, as a player attacker can.
    if (npcSide !== 'attacker' || !isGarrisonAssaultable(contest, now)) return null;
    const garrison = await d.garrisonOf(enemyVillage);
    if (!garrison) return null;
    const striker = await pickStriker(contest, now, d, used, participants);
    if (!striker) return null;
    const battle = d.runFight({ playerName: `${enemyVillage} garrison`, playerSlug: garrison.slug, playerSealedChar: garrison.character, mercLevel: striker.level, seed, now, gapClosingJutsu: gapJutsu, mercSealed: { name: striker.name, character: striker.character } });
    return finish(contest, striker, garrison.slug, 'garrison', battle, npcSide, now, instance, d, ROLE_ANBU);
}

async function finish(
    contest: Contest, striker: Sealed, target: string, kind: 'player' | 'garrison', battle: MercBattleResult,
    npcSide: 'attacker' | 'defender', now: number, instance: string,
    d: Required<Omit<NpcWarPartyDeps, 'now'>>, enemyRole: RoleWeights,
): Promise<NpcWarStrike> {
    const base = { contestId: contest.id, kind, npc: striker.npc.id, target, winner: battle.winner };
    if (!battle.mercWon && !battle.playerWon) return { ...base, attackerWon: null, awarded: 0 };
    const npcWon = battle.mercWon;
    // Beaten by a player, the striker is wounded like a guard beaten at the front.
    if (!npcWon && kind === 'player') await d.wound(striker.npc.id, now, safeName(target)).catch(() => undefined);
    const npcRole = await d.roleOf(striker.npc.id, NPC_VILLAGE);
    const result = await scoreStrike(contest, {
        // Keyed on the tick, not the millisecond: two schedulers firing the
        // same tick (a lapsed lease) collide on one receipt and score once.
        battleId: `npc-war:${contest.id}:${kind}:${safeName(target)}:${Math.floor(now / NPC_WAR_PARTY_TICK_MS)}`,
        npcSide, npcWon, npcRole, enemyRole,
        garrison: kind === 'garrison',
        // Capture credit goes to a player who beat the party, never to an NPC or the garrison.
        by: !npcWon && kind === 'player' ? safeName(target) : '',
        now, instance,
    }, d.commit);
    const attackerWon = npcSide === 'attacker' ? npcWon : !npcWon;
    return { ...base, attackerWon, awarded: result.status === 'applied' ? result.receipt.points : 0 };
}

async function defaultTargetsOf(names: readonly string[], enemyVillage: string, now: number): Promise<RoamTarget[]> {
    if (!names.length) return [];
    const slugs = names.map(safeName);
    const saves = await kv.mget<{ character?: Record<string, unknown> }[]>(...slugs.map((slug) => `save:${slug}`));
    const out: RoamTarget[] = [];
    slugs.forEach((name, index) => {
        const ch = saves[index]?.character;
        if (!ch || String(ch.village ?? '').trim() !== enemyVillage) return;
        const hp = Number(ch.hp);
        out.push({ name, village: enemyVillage, hp, maxHp: Number(ch.maxHp) || hp });
    });
    const cooling = await mercTargetsOnCooldown(out.map((t) => t.name), now);
    return out.filter((t) => !cooling.has(t.name));
}

function logSkip(scope: string, err: unknown): void {
    if (err instanceof LockContendedError) return;
    console.error(`[npc-war-party] ${scope} skipped this tick:`, (err as Error)?.message ?? err);
}
