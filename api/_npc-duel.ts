/**
 * Cinderhold NPC duels (Push 2, 2026-11-09): a player fights a Cinderhold
 * shinobi in a REAL PvP session while the server plays the NPC's seat.
 *
 * - Sealed at create (api/pvp/session.ts): `npcDuel` names the NPC, its seat
 *   and whether this fight may pay. An NPC under admin control is played by
 *   the admin and its duel never pays; a takeover waits until the NPC's live
 *   duel ends.
 * - Pay (owner rulings 2026-11-09 "Normal PvP win, capped" and 2026-11-11
 *   "Only player wins"): the player's normal PvP purse for a WIN, but only the
 *   first win over a given NPC each UTC day pays, and at most
 *   NPC_DUEL_PAID_PER_DAY wins a day pay. The slot is spent when the player
 *   wins (settleNpcDuelWin), never at the seal. A loss pays the normal PvP
 *   loss credit (engaged-loser rules unchanged) from its OWN allowance: the
 *   first loss to each NPC a day, at most NPC_DUEL_PAID_PER_DAY
 *   (settleNpcDuelLoss). A loss never spends a win slot, nor a win a loss
 *   slot. The NPC itself is never credited. No Elo or ranked standing either way.
 * - Driven by api/_npc-duel-driver.ts, which joins and plays the NPC's turns
 *   through the real move route.
 */
import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { safeName } from './_utils.js';
import { isNpcPossessed, npcPossessKey } from './_npc-possession.js';
import { readNpcWound, woundShieldUntil } from './_npc-wounds.js';
import { NPC_DUEL_HOLD_MS, pinNpc, unpinNpc } from './_npc-attack-hold.js';
import { NPC_VILLAGE_ROSTER, isNpcAccount, type NpcShinobi } from '../shared/npc-village-roster.js';

// Kept here (not in _npc-ai-seat.ts) so api/pvp/session.ts never loads the
// planner, which imports the move route and would close an import cycle.
export type PvpSeat = 'p1' | 'p2';
type Seated = { p1?: { name?: unknown } | null; p2?: { name?: unknown } | null };

/** The roster entry sitting in a seat, or null for a player. */
export function npcInSeat(session: Seated, seat: PvpSeat): NpcShinobi | null {
    const name = safeName(String(session[seat]?.name ?? ''));
    return isNpcAccount(name) ? NPC_VILLAGE_ROSTER.find((npc) => npc.id === name) ?? null : null;
}

/** The NPC's seat, or null when no NPC (or, impossibly, two) is seated. */
export function npcSeatOf(session: Seated): PvpSeat | null {
    const p1 = npcInSeat(session, 'p1'), p2 = npcInSeat(session, 'p2');
    return p1 && !p2 ? 'p1' : p2 && !p1 ? 'p2' : null;
}

export const NPC_DUEL_PAID_PER_DAY = 5;
export const NPC_DUEL_ACTIVE_KEY = 'npc-duel:active';
/**
 * A duel is registered just before its session row is published, so for a
 * moment the registry names a battle with no row yet. Within this window the
 * NPC counts as engaged; after it, a row that never appeared (the create
 * failed) no longer holds the NPC.
 */
export const NPC_DUEL_PUBLISH_GRACE_MS = 15_000;
/**
 * `controlled`: an admin was playing the NPC when the duel was sealed. It pays
 * nobody, but it still scores a sector war (owner ruling 2026-11-09: an
 * admin-controlled NPC gives war points). Absent on stamps sealed before Push 4.
 */
/**
 * `payOnWin` (2026-11-11, owner ruling "Only player wins"): `paid` then means
 * the fight MAY pay: a player WIN spends a win slot (settleNpcDuelWin), a paid
 * LOSS a loss slot (settleNpcDuelLoss), a draw nothing, and sealing nothing
 * (a fight the NPC starts uses no slot until it ends). Stamps sealed before this carry no
 * `payOnWin`: their slot was spent at the seal and `paid` is final.
 */
export type NpcDuelStamp = { version: 1; npc: string; seat: PvpSeat; paid: boolean; controlled?: boolean; payOnWin?: true };
export type NpcDuelRegistry = Record<string, { npc: string; seat: PvpSeat; at: number }>;
/** One row per player per UTC day: which NPC each paid fight was against. */
export type NpcDuelPayDay = { npcs: Record<string, string> };

const DAY_MS = 86_400_000;
const utcDay = (now: number) => new Date(Math.floor(now / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
/** Shinobi duels and card duels each have their own daily allowance (owner rulings 2026-11-09). */
export type NpcDuelPayMode = 'combat' | 'cards';
/**
 * Wins and losses each have their own allowance (2026-11-11: only a win
 * spends a win slot; a loss pays the normal PvP loss credit from its own
 * count, the first loss to each NPC a day, at most NPC_DUEL_PAID_PER_DAY).
 * A loss never spends a win slot and a win never spends a loss slot.
 */
export type NpcDuelPaySide = 'win' | 'loss';
const slotPrefix = (mode: NpcDuelPayMode, side: NpcDuelPaySide) =>
    `${mode === 'cards' ? 'npc-card-duel' : 'npc-duel'}${side === 'loss' ? '-loss' : ''}`;
export const npcDuelDayKey = (player: string, now: number, mode: NpcDuelPayMode = 'combat', side: NpcDuelPaySide = 'win') =>
    `${slotPrefix(mode, side)}:day:${utcDay(now)}:${safeName(player)}`;

/** Whether a fight starting now would pay (reads only; admin view and tests). */
export async function npcDuelPayAvailable(player: string, npc: string, now = Date.now(), mode: NpcDuelPayMode = 'combat', side: NpcDuelPaySide = 'win'): Promise<boolean> {
    const row = (await kv.get<NpcDuelPayDay>(npcDuelDayKey(player, now, mode, side)))?.npcs ?? {};
    return !(npc in row) && Object.keys(row).length < NPC_DUEL_PAID_PER_DAY;
}

/**
 * Why a fight with an NPC paid the player nothing, as the claim reply tells
 * them: `npc-repeat` / `npc-daily-cap` (a win over this NPC already paid today
 * / NPC_DUEL_PAID_PER_DAY wins already paid today), `npc-loss-repeat` /
 * `npc-loss-daily-cap` (the same for losses, from their own count), and
 * `npc-campaign` (a village-war objective fight, which scores the war and pays
 * no purse).
 */
export type NpcDuelUnpaidReason = 'npc-repeat' | 'npc-daily-cap' | 'npc-loss-repeat' | 'npc-loss-daily-cap' | 'npc-campaign';
export type NpcDuelPayVerdict = { pays: boolean; reason?: Exclude<NpcDuelUnpaidReason, 'npc-campaign'> };

/** The verdict of one battle's slot, kept as long as its claim can still be made, so every reader of the battle agrees. */
export const npcDuelVerdictKey = (battleId: string, mode: NpcDuelPayMode = 'combat', side: NpcDuelPaySide = 'win') =>
    `${slotPrefix(mode, side)}:verdict:${battleId}`;
const VERDICT_TTL_SEC = 4 * 86_400;

/**
 * Spends the player's pay slot for this NPC, atomically, for a battle the
 * player WON (`side` 'win') or LOST (`side` 'loss'): the first such result
 * against a given NPC each UTC day pays, at most NPC_DUEL_PAID_PER_DAY a day,
 * each side from its own row. One row holds the day, written under its lock,
 * so the per-NPC rule and the daily count can never disagree. Once per battle:
 * the verdict is stored with the battle, so a retried claim, a terminal
 * replay or a second process gets the same answer (paid or not, and why).
 */
export async function spendNpcDuelSlot(player: string, npc: string, battleId: string, now = Date.now(), mode: NpcDuelPayMode = 'combat', side: NpcDuelPaySide = 'win'): Promise<NpcDuelPayVerdict> {
    const verdictKey = npcDuelVerdictKey(battleId, mode, side);
    const known = await kv.get<NpcDuelPayVerdict>(verdictKey);
    if (known && typeof known.pays === 'boolean') return known;
    const dayKey = npcDuelDayKey(player, now, mode, side);
    return withKvLock(dayKey, async () => {
        const again = await kv.get<NpcDuelPayVerdict>(verdictKey);
        if (again && typeof again.pays === 'boolean') return again;
        const row = (await kv.get<NpcDuelPayDay>(dayKey)) ?? { npcs: {} };
        const npcs = row.npcs && typeof row.npcs === 'object' ? row.npcs : {};
        let verdict: NpcDuelPayVerdict;
        if (npc in npcs) verdict = npcs[npc] === battleId ? { pays: true } : { pays: false, reason: side === 'loss' ? 'npc-loss-repeat' : 'npc-repeat' };
        else if (Object.keys(npcs).length >= NPC_DUEL_PAID_PER_DAY) verdict = { pays: false, reason: side === 'loss' ? 'npc-loss-daily-cap' : 'npc-daily-cap' };
        else {
            await kv.set(dayKey, { npcs: { ...npcs, [npc]: battleId } }, { ex: VERDICT_TTL_SEC });
            verdict = { pays: true };
        }
        await kv.set(verdictKey, verdict, { ex: VERDICT_TTL_SEC });
        return verdict;
    }, { failClosed: true });
}

/** A win slot (the form the shinobi duel settlement and its tests use). */
export async function spendNpcDuelWinSlot(player: string, npc: string, battleId: string, now = Date.now(), mode: NpcDuelPayMode = 'combat'): Promise<NpcDuelPayVerdict> {
    return spendNpcDuelSlot(player, npc, battleId, now, mode, 'win');
}

/** The boolean form (card duels' Chronicle Points): whether this battle's result pays from that side's allowance. */
export async function spendNpcDuelPay(player: string, npc: string, battleId: string, now = Date.now(), mode: NpcDuelPayMode = 'combat', side: NpcDuelPaySide = 'win'): Promise<boolean> {
    return (await spendNpcDuelSlot(player, npc, battleId, now, mode, side)).pays;
}

type DuelForPay = Seated & { battleId?: unknown; status?: unknown; winner?: unknown; endedAt?: unknown; npcDuel?: NpcDuelStamp | null; villageWarObjective?: unknown };

/**
 * Each won battle's verdict, kept in this process once settleNpcDuelWin has
 * read or made it, so the synchronous reward gates (api/pvp/session.ts
 * pvpSessionMayReward) can read it. Every path that can pay a fight (the
 * terminal replay, the claim, the mission report) settles first; a gate that
 * finds no verdict pays nothing (fail closed).
 */
const winVerdicts = new Map<string, NpcDuelPayVerdict>();
const MAX_REMEMBERED_VERDICTS = 5_000;
function remember(battleId: string, verdict: NpcDuelPayVerdict): void {
    winVerdicts.delete(battleId);
    winVerdicts.set(battleId, verdict);
    while (winVerdicts.size > MAX_REMEMBERED_VERDICTS) winVerdicts.delete(winVerdicts.keys().next().value as string);
}

function humanWon(session: DuelForPay): boolean {
    const stamp = session.npcDuel;
    if (!stamp || stamp.version !== 1) return false;
    const human = stamp.seat === 'p1' ? 'p2' : 'p1';
    return session.status === 'done' && session.winner === human;
}
function humanLost(session: DuelForPay): boolean {
    const stamp = session.npcDuel;
    return !!stamp && stamp.version === 1 && session.status === 'done' && session.winner === stamp.seat;
}

const lossVerdicts = new Map<string, NpcDuelPayVerdict>();
/**
 * The player's LOSS to an NPC in a duel sealed `payOnWin`: spends today's
 * loss slot for that NPC (spendNpcDuelSlot 'loss'). Called by the loser's own
 * loss-credit settlement (api/pvp/claim-rewards.ts) only when the normal PvP
 * loss rules would pay something (an engaged loser), so a forfeit, an AFK or a
 * fight that pays nothing never uses one. Null when not a payable NPC loss.
 */
export async function settleNpcDuelLoss(session: DuelForPay, now = Date.now()): Promise<NpcDuelPayVerdict | null> {
    const stamp = session.npcDuel;
    if (!stamp || stamp.version !== 1 || stamp.payOnWin !== true || stamp.paid !== true) return null;
    const battleId = String(session.battleId ?? '');
    if (!battleId || !humanLost(session)) return null;
    const cached = lossVerdicts.get(battleId);
    if (cached) return cached;
    const human = String(session[stamp.seat === 'p1' ? 'p2' : 'p1']?.name ?? '');
    const at = Number(session.endedAt);
    const verdict = await spendNpcDuelSlot(human, stamp.npc, battleId, Number.isSafeInteger(at) && at > 0 ? at : now, 'combat', 'loss');
    lossVerdicts.set(battleId, verdict);
    while (lossVerdicts.size > MAX_REMEMBERED_VERDICTS) lossVerdicts.delete(lossVerdicts.keys().next().value as string);
    return verdict;
}

/** Why the player's LOSS to an NPC paid nothing (read only: the stored verdict), or null. */
export async function npcDuelLossUnpaidReason(session: DuelForPay): Promise<NpcDuelUnpaidReason | null> {
    const stamp = session.npcDuel;
    if (!stamp || stamp.version !== 1 || stamp.payOnWin !== true || !humanLost(session)) return null;
    const battleId = String(session.battleId ?? '');
    const verdict = lossVerdicts.get(battleId) ?? await kv.get<NpcDuelPayVerdict>(npcDuelVerdictKey(battleId, 'combat', 'loss'));
    return verdict && verdict.pays === false ? verdict.reason ?? null : null;
}

/**
 * Settles a finished NPC duel's pay slot: for a stamp sealed `payOnWin`, a
 * player WIN spends today's slot for that NPC (spendNpcDuelWinSlot); anything
 * else (a loss, a draw, an unfinished duel) spends nothing and pays nothing.
 * Returns null for a session this does not apply to (no NPC, a legacy stamp, a
 * fight that could never pay).
 */
export async function settleNpcDuelWin(session: DuelForPay, now = Date.now()): Promise<NpcDuelPayVerdict | null> {
    const stamp = session.npcDuel;
    if (!stamp || stamp.version !== 1 || stamp.payOnWin !== true || stamp.paid !== true) return null;
    const battleId = String(session.battleId ?? '');
    if (!battleId || !humanWon(session)) return null;
    const cached = winVerdicts.get(battleId);
    if (cached) return cached;
    const human = String(session[stamp.seat === 'p1' ? 'p2' : 'p1']?.name ?? '');
    const at = Number(session.endedAt);
    const verdict = await spendNpcDuelWinSlot(human, stamp.npc, battleId, Number.isSafeInteger(at) && at > 0 ? at : now);
    remember(battleId, verdict);
    return verdict;
}

/**
 * Synchronous: whether this NPC duel may pay its player. A legacy stamp's
 * `paid` stands. A `payOnWin` stamp pays a player WIN only when its win slot
 * was spent (settleNpcDuelWin). A player LOSS is authorized here: the only
 * thing a loss pays is the loser's own loss credit, and that settlement spends
 * (or is refused by) the separate loss slot itself (settleNpcDuelLoss in
 * api/pvp/claim-rewards.ts). A draw pays nothing. True for a session with no
 * NPC stamp (not this rule's to judge).
 */
export function npcDuelPays(session: DuelForPay): boolean {
    const stamp = session.npcDuel;
    if (!stamp || stamp.version !== 1) return true;
    if (stamp.paid !== true) return false;
    if (stamp.payOnWin !== true) return true;
    if (humanLost(session)) return true;
    return humanWon(session) && winVerdicts.get(String(session.battleId ?? ''))?.pays === true;
}

/** Whether this is a player's loss to an NPC whose loss credit is gated by the loss slot (settleNpcDuelLoss). */
export function npcDuelLossSlotGated(session: DuelForPay): boolean {
    const stamp = session.npcDuel;
    return !!stamp && stamp.version === 1 && stamp.payOnWin === true && stamp.paid === true && humanLost(session);
}

/** Why a player's WIN over an NPC paid nothing (for the claim reply), or null when it paid or is no NPC win. */
export function npcDuelUnpaidReason(session: DuelForPay): NpcDuelUnpaidReason | null {
    const stamp = session.npcDuel;
    if (!stamp || stamp.version !== 1 || !humanWon(session)) return null;
    if (stamp.paid !== true) return session.villageWarObjective && !stamp.controlled ? 'npc-campaign' : null;
    if (stamp.payOnWin !== true) return null;
    const verdict = winVerdicts.get(String(session.battleId ?? ''));
    return verdict && !verdict.pays ? verdict.reason ?? null : null;
}

/** Tests: forget every remembered verdict (a fresh "process"). */
export function forgetNpcDuelVerdictsForTest(): void { winVerdicts.clear(); lossVerdicts.clear(); }

/**
 * Whether a duel other than `exceptBattleId` has this NPC seated: one whose
 * row is still live, or one registered moments ago and still being published.
 */
export async function npcInLiveDuel(npc: string, exceptBattleId = '', now = Date.now()): Promise<boolean> {
    const live = await liveNpcDuels();
    for (const [battleId, entry] of Object.entries(live)) {
        if (entry.npc !== npc || battleId === exceptBattleId) continue;
        const session = await kv.get<{ status?: string }>(`pvp:${battleId}`);
        if (session ? session.status !== 'done' : now - Number(entry.at) < NPC_DUEL_PUBLISH_GRACE_MS) return true;
    }
    return false;
}

/**
 * What to seal on a new PvP session: null for an ordinary fight, a stamp for a
 * fight with a Cinderhold NPC. Called as the last step before the row is
 * published, under the NPC's possession lock (the lock an admin takeover
 * holds), so a takeover and a new duel can never interleave:
 *   - an NPC already in another duel refuses (`npc-duel-busy`);
 *   - under admin control nothing pays (the admin plays the seat);
 *   - otherwise the duel is stamped as one that MAY pay (`payOnWin`; no slot
 *     is spent until the player wins it) and registered for the driver before
 *     the row exists.
 * Throws `npc-duel-unavailable` when the server cannot drive the seat (no
 * session tokens, or DISABLE_NPC_VILLAGE), so the create refuses instead of
 * seating an NPC that would never move. A retry of an already-published battle
 * gets that row's own stamp back, so it still matches what was published.
 */
export async function sealNpcDuel(
    session: Seated & { battleId?: unknown; rewardAuthority?: unknown; villageWarObjective?: unknown; clanWarId?: unknown; clanWarChallengeId?: unknown },
    opts: { sessionsEnabled: boolean; now?: number },
): Promise<NpcDuelStamp | null> {
    const seat = npcSeatOf(session);
    const npc = seat ? npcInSeat(session, seat) : null;
    if (!seat || !npc) return null;
    if (!opts.sessionsEnabled || process.env.DISABLE_NPC_VILLAGE === '1') throw new Error('npc-duel-unavailable');
    // Owner ruling 2026-11-09: a Cinderhold shinobi is fought only where it
    // stands, by the world attack. A spar, a challenge or an admin-made duel
    // (any session without world reward authority) is refused outright. The
    // one other door (Push 4b): a village-war objective battle the campaign
    // dispatcher sealed (a queued stronghold defender, a shrine holder). Its
    // binding only ever comes from a server challenge record
    // (api/pvp/_challenge-authorization.ts), never from a request.
    // And a clan-war duel (NPC clans, 2026-11-10): the session create only
    // stamps 'clan-war' after binding the battle to an accepted campaign match
    // inside the war row (api/pvp/_clan-war-authorization.ts), so it too comes
    // from a server record, never from a request.
    const clanWar = session.rewardAuthority === 'clan-war'
        && typeof session.clanWarId === 'string' && !!session.clanWarId
        && typeof session.clanWarChallengeId === 'string' && !!session.clanWarChallengeId;
    const campaign = clanWar || (session.rewardAuthority === 'challenge' && !!session.villageWarObjective && typeof session.villageWarObjective === 'object');
    if (session.rewardAuthority !== 'world' && !campaign) throw new Error('npc-duel-open-world-only');
    const battleId = String(session.battleId ?? '');
    if (!battleId) throw new Error('npc-duel-unavailable');
    const published = await kv.get<{ npcDuel?: NpcDuelStamp }>(`pvp:${battleId}`);
    const prior = published?.npcDuel;
    if (prior?.version === 1 && prior.npc === npc.id && prior.seat === seat) return prior;
    const now = opts.now ?? Date.now();
    return withKvLock(npcPossessKey(npc.id), async () => {
        if (await npcInLiveDuel(npc.id, battleId, now) || await npcInLiveCardDuel(npc.id, '', now)) throw new Error('npc-duel-busy');
        // Recovering from a defeat (api/_npc-wounds.ts): in the hospital or under
        // the Field Recovery shield, exactly as a beaten player would be.
        if (woundShieldUntil(await readNpcWound(npc.id), now) > 0) throw new Error('npc-duel-busy');
        const possessed = await isNpcPossessed(npc.id, now);
        // A village-war objective fight pays no purse to anyone (it never did
        // between players): it scores the war only, and spends no paid slot.
        // A clan-war duel pays the human the base purse a clan-war duel against
        // a player clan pays (owner ruling: normal player-side clan-war
        // rewards); the war's own daily slots bound it, so it spends no NPC
        // paid slot either. Under admin control nothing pays.
        // A world duel (one the player started, or one the NPC started: a war
        // strike, a rival hunt) spends NO slot here (owner ruling 2026-11-11,
        // "Only player wins"): it may pay, and the slot is spent only if the
        // player wins it (settleNpcDuelWin, at the duel's settlement).
        const worldPay = !possessed && !clanWar && !campaign;
        const paid = !possessed && (clanWar || !campaign);
        const stamp: NpcDuelStamp = { version: 1, npc: npc.id, seat, paid, ...(possessed ? { controlled: true } : {}), ...(worldPay ? { payOnWin: true as const } : {}) };
        await registerNpcDuel(battleId, stamp, now);
        // It stands its ground from here until its seat joins (api/_npc-attack-hold.ts);
        // the duel's hold replaces the attack's.
        pinNpc(npc.id, `duel:${battleId}`, now + NPC_DUEL_HOLD_MS, now);
        const foe = seat === 'p1' ? session.p2?.name : session.p1?.name;
        unpinNpc(npc.id, `attack:${safeName(String(foe ?? ''))}`);
        return stamp;
    }, { failClosed: true });
}

/** Remembers a live NPC duel so the driver keeps playing it across restarts. */
export async function registerNpcDuel(battleId: string, stamp: NpcDuelStamp, now = Date.now()): Promise<void> {
    await withKvLock(NPC_DUEL_ACTIVE_KEY, async () => {
        const live = (await kv.get<NpcDuelRegistry>(NPC_DUEL_ACTIVE_KEY)) ?? {};
        live[battleId] = { npc: stamp.npc, seat: stamp.seat, at: now };
        await kv.set(NPC_DUEL_ACTIVE_KEY, live);
    }, { failClosed: true });
}

export async function forgetNpcDuel(battleId: string): Promise<void> {
    await withKvLock(NPC_DUEL_ACTIVE_KEY, async () => {
        const live = (await kv.get<NpcDuelRegistry>(NPC_DUEL_ACTIVE_KEY)) ?? {};
        if (!(battleId in live)) return;
        const npc = live[battleId]?.npc;
        delete live[battleId];
        await kv.set(NPC_DUEL_ACTIVE_KEY, live);
        if (npc) unpinNpc(npc, `duel:${battleId}`);
    }, { failClosed: true });
}

export async function liveNpcDuels(): Promise<NpcDuelRegistry> {
    return (await kv.get<NpcDuelRegistry>(NPC_DUEL_ACTIVE_KEY)) ?? {};
}

// --- War card duels (Push 3): the registry the card seat sweeps -------------
// Kept here, beside the shinobi registry, so every busy check (a new shinobi
// duel, a war engage, an admin takeover) can see both without loading the
// card AI (api/_npc-card-duel-driver.ts plays them).
export const NPC_CARD_DUEL_ACTIVE_KEY = 'npc-card-duel:active';
export type NpcCardDuelEntry = { npc: string; sectorWarId: string; at: number };
export type NpcCardDuelRegistry = Record<string, NpcCardDuelEntry>;

export async function registerNpcCardDuel(engageId: string, entry: NpcCardDuelEntry): Promise<void> {
    await withKvLock(NPC_CARD_DUEL_ACTIVE_KEY, async () => {
        const live = (await kv.get<NpcCardDuelRegistry>(NPC_CARD_DUEL_ACTIVE_KEY)) ?? {};
        live[engageId] = entry;
        await kv.set(NPC_CARD_DUEL_ACTIVE_KEY, live);
    }, { failClosed: true });
}
export async function forgetNpcCardDuel(engageId: string): Promise<void> {
    await withKvLock(NPC_CARD_DUEL_ACTIVE_KEY, async () => {
        const live = (await kv.get<NpcCardDuelRegistry>(NPC_CARD_DUEL_ACTIVE_KEY)) ?? {};
        if (!(engageId in live)) return;
        delete live[engageId];
        await kv.set(NPC_CARD_DUEL_ACTIVE_KEY, live);
    }, { failClosed: true });
}
export async function liveNpcCardDuels(): Promise<NpcCardDuelRegistry> {
    return (await kv.get<NpcCardDuelRegistry>(NPC_CARD_DUEL_ACTIVE_KEY)) ?? {};
}
/**
 * The clan-war Chronicle Showdown registry the clan-war card seat sweeps
 * (api/_npc-clan-war-campaign.ts NPC_CLAN_CARD_DUEL_ACTIVE_KEY, the same key).
 * Read here so every busy check sees a clan-war card duel too: that module
 * loads the village campaign, which loads this one, so it cannot be imported.
 */
export const NPC_CLAN_CARD_DUEL_REGISTRY_KEY = 'npc-clan-card-duel:active';
type ClanCardRegistry = Record<string, { npc?: string; warId?: string; at?: number }>;

/**
 * Whether a clan-war Chronicle Showdown other than `exceptChallengeId` holds
 * this NPC: its duel row is still being played, or the match is admitted and
 * the player has not opened the duel yet.
 */
async function npcInLiveClanCardDuel(npc: string, exceptChallengeId: string): Promise<boolean> {
    const live = (await kv.get<ClanCardRegistry>(NPC_CLAN_CARD_DUEL_REGISTRY_KEY)) ?? {};
    for (const [challengeId, entry] of Object.entries(live)) {
        if (entry?.npc !== npc || challengeId === exceptChallengeId) continue;
        const duel = await kv.get<{ status?: string }>(`cw-tilecards:${challengeId}`);
        if (duel) { if (duel.status !== 'done') return true; continue; }
        const war = await kv.get<{ endedAt?: unknown; campaign?: { matches?: Record<string, { status?: string }> } }>(`clan-war:${String(entry.warId ?? '')}`);
        const status = war?.campaign?.matches?.[challengeId]?.status;
        if (war && !war.endedAt && (status === 'ready' || status === 'active')) return true;
    }
    return false;
}

/** Whether a war card duel (sector war or clan war) other than `exceptEngageId` still has this NPC seated. */
export async function npcInLiveCardDuel(npc: string, exceptEngageId = '', now = Date.now()): Promise<boolean> {
    for (const [engageId, entry] of Object.entries(await liveNpcCardDuels())) {
        if (entry.npc !== npc || engageId === exceptEngageId) continue;
        const duel = await kv.get<{ status?: string }>(`sector-card-open:${engageId}`);
        if (duel ? duel.status === 'awaiting-target' || duel.status === 'active' : now - Number(entry.at) < NPC_DUEL_PUBLISH_GRACE_MS) return true;
    }
    return await npcInLiveClanCardDuel(npc, exceptEngageId) || await npcInLiveCampaignCardRun(npc, now);
}

/**
 * A village-war raid card battle the server plays for the NPC
 * (api/_npc-campaign-card-seat.ts registers it under this key). Read directly,
 * not through that module, so this file imports no campaign code. A run counts
 * until it is done; a registered run whose row is gone counts for the publish
 * grace only.
 */
const NPC_CAMPAIGN_CARD_RUNS_REGISTRY_KEY = 'npc-village:campaign-card-runs';
async function npcInLiveCampaignCardRun(npc: string, now = Date.now()): Promise<boolean> {
    const live = (await kv.get<Record<string, { npc?: string; at?: number }>>(NPC_CAMPAIGN_CARD_RUNS_REGISTRY_KEY)) ?? {};
    for (const [runId, entry] of Object.entries(live)) {
        if (entry?.npc !== npc) continue;
        const run = await kv.get<{ status?: string }>(`village-campaign-run:${runId}`);
        if (run ? run.status !== 'done' : now - Number(entry.at) < NPC_DUEL_PUBLISH_GRACE_MS) return true;
    }
    return false;
}
/** Whether the NPC is already in any fight the server plays for it (shinobi duel or war card duel). */
export async function npcEngaged(npc: string, now = Date.now()): Promise<boolean> {
    return await npcInLiveDuel(npc, '', now) || await npcInLiveCardDuel(npc, '', now);
}

/**
 * Each NPC's fight record and its rivals (plan: "a rival who wins remembers you").
 * `beatAt`: when that rival last beat the NPC (2026-11-10; the rival hunt,
 * api/_npc-hunt.ts, reads it). Older rows lack it.
 */
export type NpcDuelRecord = { wins: number; losses: number; draws: number; rivals: Record<string, { wins: number; losses: number; last: number; beatAt?: number }> };
export const npcDuelRecordKey = (npc: string) => `npc-village:record:${npc}`;

export async function recordNpcDuelResult(npc: string, opponent: string, result: 'win' | 'loss' | 'draw', battleId: string, now = Date.now()): Promise<void> {
    const key = npcDuelRecordKey(npc);
    await withKvLock(key, async () => {
        // Once per battle: a sweep that retries after a late failure never counts
        // it twice. Marked inside the lock, so a failed write is retried, not lost.
        const marker = `npc-duel:recorded:${battleId}`;
        if (await kv.get(marker)) return;
        const row = (await kv.get<NpcDuelRecord>(key)) ?? { wins: 0, losses: 0, draws: 0, rivals: {} };
        const slug = safeName(opponent);
        const rival = row.rivals[slug] ?? { wins: 0, losses: 0, last: 0 };
        if (result === 'win') { row.wins++; rival.wins++; } else if (result === 'loss') { row.losses++; rival.losses++; rival.beatAt = now; } else row.draws++;
        rival.last = now;
        row.rivals[slug] = rival;
        // Keep the 50 most recent rivals so the row stays small.
        const keep = Object.entries(row.rivals).sort((a, b) => b[1].last - a[1].last).slice(0, 50);
        row.rivals = Object.fromEntries(keep);
        await kv.set(key, row);
        await kv.set(marker, 1, { ex: 2 * 86_400 });
    }, { failClosed: true });
}
