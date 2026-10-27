/*
 * Chronicle Points from card battles outside Echoes of War (owner request
 * 2026-10-22; docs/economy-rebalance-2026-10.md, "Chronicle").
 *
 * PvP. Free-play Chronicle Showdown (card-clash/match.ts), clan-war card duels
 * (clan/war/tilecards.ts), sector-war duels between players
 * (village/sector-card.ts: the war table and open-world duels) and Village War
 * card strongholds held by a player (village/war-campaign.ts). A win pays
 * CARD_PVP_WIN_CP and the loss CARD_PVP_LOSS_CP, and only when the duel would
 * earn the free-play Legacy credit (_freeplay-legacy.ts): ended by play, 45 s,
 * three meaningful actions from each side, turn 3, not a reciprocal win. Since
 * both sides must have played it out and nobody forfeited or walked out, that
 * same rule is what makes a loss "engaged". One per-pair day counter shared by
 * every PvP card mode then scales both by 1 / 1 / 0.5 / 0.25 / 0
 * (pvp/_valid-fight.ts pvpPairWeight), so two accounts mint at most 2.75 duels'
 * worth from each other per UTC day however they spread them across modes.
 *
 * PvE. A won Dungeon Card seal (CARD_PVE_DUNGEON_CP, card-clash/ai-move.ts), a
 * won Hollow Gate card ambush (CARD_PVE_GATE_CP, hollow-gate/card-settle.ts)
 * and a won sector-war garrison assault or Village War assault on an ANBU or
 * Kage deck (CARD_PVE_GARRISON_CP, here through settleCardCpCredit). Each
 * mode's own access limit bounds it: a Dungeon key per run, one card ambush per
 * Rift, the garrison's two-hour re-form window, the campaign's personal daily
 * support allowance.
 *
 * Unpaid by design: Card Hall practice duels, externalStakes encounters that
 * carry no server seal (their start is a client flag), and two modes that keep
 * their own tables: Echoes of War (_echoes-catalog.ts) and Keeper's Path, which
 * pays a completed run once per UTC day (shared/keeper-path-contract.ts, settled
 * in ai-move). There is no daily cap on the faucets here (owner ruling).
 *
 * Exactly once. The Dungeon and Hollow Gate credits ride the existing terminal
 * write and its receipt. Every other credit is an outbox on the duel's session
 * (CardCpCredit) paid through payChroniclePointsOnce, whose in-save receipt
 * (serverSettlementReceipts) commits in the same write as the points, so a
 * retry, a lost reply or a second duelist's poll can never pay twice.
 */
import { createHash } from 'node:crypto';
import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { economyDial } from '../_economy-dials.js';
import { recordEconomyTxn } from '../_economy.js';
import { pushSaveVersion } from '../_realtime/notify.js';
import { mutatePlayerSave, type PlayerSaveMutationResult } from '../save/_mutate-player-save.js';
import { appendSettlementReceipt, inspectSettlementReceipt } from '../_settlement-receipts.js';
import { assignPvpCreditSlot, evaluateCreditedPvpFight, pvpAccountOldEnough, pvpPairWeight, pvpUtcDay } from '../pvp/_valid-fight.js';
import {
    FREEPLAY_LEGACY_MIN_ACTIONS_PER_SIDE,
    FREEPLAY_LEGACY_MIN_DURATION_MS,
    FREEPLAY_LEGACY_MIN_TURN,
    freePlayParticipationQualified,
    reserveFreePlayPairDecision,
    type FreePlayParticipation,
} from './_freeplay-legacy.js';
import {
    CARD_CHRONICLE_POINTS_DEFAULTS,
    type CardChroniclePointsRules,
    type CardChroniclePointsView,
} from '../../shared/card-chronicle-points.js';
import type { ChronicleMatch } from '../../shared/chronicle-duel.js';

// ── Dials (env read at call time; an out-of-range value falls back) ──────────

const CP_DIAL_RANGE = { min: 0, max: 100 };
const whole = (value: number): number => (Number.isFinite(value) && value > 0 ? Math.floor(value + 1e-9) : 0);

/** CARD_PVP_WIN_CP (default 20, range 0-100): a credited PvP card duel win, before the pair weight. */
export function cardPvpWinCp(): number {
    return whole(economyDial('CARD_PVP_WIN_CP', CARD_CHRONICLE_POINTS_DEFAULTS.pvpWin, CP_DIAL_RANGE));
}
/** CARD_PVP_LOSS_CP (default 8, range 0-100): a credited PvP card duel loss, before the pair weight. */
export function cardPvpLossCp(): number {
    return whole(economyDial('CARD_PVP_LOSS_CP', CARD_CHRONICLE_POINTS_DEFAULTS.pvpLoss, CP_DIAL_RANGE));
}
/** CARD_PVE_DUNGEON_CP (default 10, range 0-100): a won Dungeon Card seal. */
export function cardPveDungeonCp(): number {
    return whole(economyDial('CARD_PVE_DUNGEON_CP', CARD_CHRONICLE_POINTS_DEFAULTS.dungeon, CP_DIAL_RANGE));
}
/** CARD_PVE_GATE_CP (default 10, range 0-100): a won Hollow Gate card ambush. */
export function cardPveGateCp(): number {
    return whole(economyDial('CARD_PVE_GATE_CP', CARD_CHRONICLE_POINTS_DEFAULTS.gate, CP_DIAL_RANGE));
}
/** CARD_PVE_GARRISON_CP (default 15, range 0-100): a won sector-war garrison assault. */
export function cardPveGarrisonCp(): number {
    return whole(economyDial('CARD_PVE_GARRISON_CP', CARD_CHRONICLE_POINTS_DEFAULTS.garrison, CP_DIAL_RANGE));
}

/** The participation thresholds, as the player-facing copy should state them. */
export function cardPvpCpRules(): CardChroniclePointsRules {
    return {
        minSeconds: Math.round(FREEPLAY_LEGACY_MIN_DURATION_MS / 1000),
        minActionsPerSide: FREEPLAY_LEGACY_MIN_ACTIONS_PER_SIDE,
        minTurn: FREEPLAY_LEGACY_MIN_TURN,
    };
}

// ── Telemetry ────────────────────────────────────────────────────────────────

/** One economy-ledger tag per faucet. The coverage test pins these literals. */
export const CARD_CP_SOURCES = {
    pvpWin: 'card.pvp.win',
    pvpLoss: 'card.pvp.loss',
    dungeon: 'card.pve.dungeon',
    gate: 'card.pve.gate',
    garrison: 'card.pve.garrison',
} as const;
export type CardCpSourceKind = keyof typeof CARD_CP_SOURCES;

/** Record one committed, freshly paid credit. A replay records nothing. */
export function recordCardChroniclePoints(o: {
    kind: CardCpSourceKind;
    txnId: string;
    player: string;
    amount: number;
    balanceAfter?: number;
}): void {
    const amount = whole(o.amount);
    if (!amount) return;
    void recordEconomyTxn({
        txnId: o.txnId,
        player: safeName(o.player),
        currency: 'chroniclePoints',
        delta: amount,
        source: CARD_CP_SOURCES[o.kind],
        ...(Number.isFinite(o.balanceAfter) ? { balanceAfter: o.balanceAfter } : {}),
    });
}

// ── Save credit ──────────────────────────────────────────────────────────────

export function chroniclePointsOf(character: Record<string, unknown>): number {
    return Math.max(0, Math.floor(Number(character.chroniclePoints) || 0));
}

/** Pure: the character with `amount` Chronicle Points added. For a credit that rides another write. */
export function addChroniclePoints(character: Record<string, unknown>, amount: number): Record<string, unknown> {
    const add = whole(amount);
    return add ? { ...character, chroniclePoints: chroniclePointsOf(character) + add } : character;
}

/** The in-save receipt id for one credit (serverSettlementReceipts ids are 16-80 safe characters). */
export function cardCpRequestId(receiptId: string): string {
    return `cardcp_${createHash('sha256').update(receiptId).digest('hex').slice(0, 40)}`;
}

export type CardCpPayment =
    | { status: 'paid'; fresh: boolean; balance: number; character: Record<string, unknown>; saveVersion: number }
    /** The account (or its character) is gone: there is nobody to pay. */
    | { status: 'no-save' }
    | { status: 'failed'; error: string };

/**
 * Credit `amount` Chronicle Points to `player` exactly once for `receiptId`.
 * The receipt commits in the same save write as the points, and the currency
 * ledger row with them (mutatePlayerSave → commitPlayerSaveRecord). A receipt
 * already present pays nothing, whatever amount it recorded.
 */
export async function payChroniclePointsOnce(o: {
    player: string;
    receiptId: string;
    amount: number;
    kind: CardCpSourceKind;
}): Promise<CardCpPayment> {
    const amount = whole(o.amount);
    const requestId = cardCpRequestId(o.receiptId);
    const source = CARD_CP_SOURCES[o.kind];
    const fingerprint = `card-cp:v1:${source}:${amount}`;
    let result: PlayerSaveMutationResult<{ fresh: boolean; balance: number }>;
    try {
        result = await mutatePlayerSave<{ fresh: boolean; balance: number }>(o.player, ({ character }) => {
            const inspected = inspectSettlementReceipt(character, requestId, fingerprint);
            if (inspected.status === 'invalid') {
                return { ok: false as const, status: 409, error: 'The settlement receipt journal is invalid.' };
            }
            if (inspected.status !== 'fresh') {
                return { ok: true as const, character, value: { fresh: false, balance: chroniclePointsOf(character) }, write: false };
            }
            const credited = addChroniclePoints(character, amount);
            const next = appendSettlementReceipt(credited, inspected.receipts, {
                requestId,
                fingerprint,
                value: { chroniclePoints: amount, source },
                settledAt: Date.now(),
            });
            return { ok: true as const, character: next, value: { fresh: true, balance: chroniclePointsOf(next) } };
        });
    } catch (error) {
        return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
    if (!result.ok) {
        if (result.status === 404 || result.status === 400) return { status: 'no-save' };
        return { status: 'failed', error: result.error };
    }
    if (result.value.fresh) {
        recordCardChroniclePoints({ kind: o.kind, txnId: `card-cp:${o.receiptId}`, player: o.player, amount, balanceAfter: result.value.balance });
        // The other duelist's save is written by whoever settled the duel; tell
        // their open tabs the new version so their next autosave is not a 409.
        pushSaveVersion(safeName(o.player), result._saveVersion);
    }
    return { status: 'paid', fresh: result.value.fresh, balance: result.value.balance, character: result.character, saveVersion: result._saveVersion };
}

// ── Duel outbox (PvP duels and the garrison) ─────────────────────────────────

export type CardCpRole = 'winner' | 'loser';
export type CardCpReciprocalHistory = 'free-play' | 'war';
/** The reciprocal-win history shared by the clan-war and sector-war card duels. */
export const CARD_CP_WAR_PAIR_HISTORY_PREFIX = 'card-cp-war-pair';

/**
 * The Chronicle Point outbox a finished duel keeps on its session row.
 * `pending` → paid on this or a later request; `done` → every share committed;
 * `skipped` → the duel pays nothing (`reason` says why).
 */
export type CardCpCredit = {
    receiptId: string;
    kind: 'pvp' | 'garrison';
    /**
     * Which recent-winner history the reciprocal check reads. Free play reads
     * the free-play Legacy history (one decision per duel for both credits);
     * the war card duels share their own, so a war duel never changes a
     * free-play Legacy decision. The per-pair day count is shared by all.
     */
    reciprocalHistory?: CardCpReciprocalHistory;
    winnerName: string;
    /** The loser (PvP). Empty for the garrison, which has no player on the other seat. */
    targetName: string;
    /** The duel's terminal clock: the UTC day the pair counter is charged to. */
    endedAt: number;
    status: 'pending' | 'done' | 'skipped';
    reason?: 'participation' | 'reciprocal' | 'too-young' | 'level-gap';
    pairOrdinal?: number;
    pairWeight?: number;
    /** Sealed once, so every retry pays the same amounts. */
    amounts?: { winner: number; loser: number };
    /** The winner was not yet established, so the loss share is 0 (shown to the loser). */
    lossBlocked?: 'too-young';
    paid?: Partial<Record<CardCpRole, true>>;
    /** The player's authoritative save was handed back once after their share committed. */
    delivered?: Partial<Record<CardCpRole, true>>;
};

/** What a card host's session must carry for its PvP credit. */
export type CardPvpCpSession = {
    p1Name: string;
    p2Name?: string;
    state?: Pick<ChronicleMatch, 'status' | 'winner' | 'turnNumber'>;
    participation?: FreePlayParticipation;
    updatedAt: number;
    cpCredit?: CardCpCredit;
};

const pairSide = (name: string) => safeName(name);
export const cardCpPairCounterKey = (a: string, b: string, day: string): string => {
    const [lo, hi] = [pairSide(a), pairSide(b)].sort();
    return `card-cp:pair:${lo}:${hi}:${day}`;
};
export const cardCpPairSlotKey = (receiptId: string): string => `card-cp:pairslot:${receiptId}`;

/** A credit for a decided PvP duel, or null for an unfinished duel or a draw. */
export function prepareCardPvpCpCredit(
    session: CardPvpCpSession,
    receiptId: string,
    reciprocalHistory: CardCpReciprocalHistory = 'free-play',
): CardCpCredit | null {
    const state = session.state;
    if (!state || state.status !== 'complete') return null;
    if (state.winner !== 'p1' && state.winner !== 'p2') return null;
    const p2Name = session.p2Name ?? '';
    const winnerName = state.winner === 'p1' ? session.p1Name : p2Name;
    const targetName = state.winner === 'p1' ? p2Name : session.p1Name;
    if (!pairSide(winnerName) || !pairSide(targetName) || pairSide(winnerName) === pairSide(targetName)) return null;
    const endedAt = Number(session.updatedAt) || Date.now();
    const qualified = freePlayParticipationQualified({
        participation: session.participation,
        endedAt,
        turnNumber: state.turnNumber,
    });
    return {
        receiptId,
        kind: 'pvp',
        reciprocalHistory,
        winnerName,
        targetName,
        endedAt,
        status: qualified ? 'pending' : 'skipped',
        ...(qualified ? {} : { reason: 'participation' as const }),
    };
}

/** Attach the outbox once the duel has ended. Returns true when the session changed. */
export function ensureCardPvpCpCredit(
    session: CardPvpCpSession,
    receiptId: string,
    reciprocalHistory: CardCpReciprocalHistory,
): boolean {
    if (session.cpCredit) return false;
    const credit = prepareCardPvpCpCredit(session, receiptId, reciprocalHistory);
    if (!credit) return false;
    session.cpCredit = credit;
    return true;
}

/** A credit for a won garrison assault (null for a loss or a draw). */
export function prepareCardGarrisonCpCredit(o: {
    receiptId: string;
    attackerName: string;
    won: boolean;
    endedAt: number;
}): CardCpCredit | null {
    if (!o.won || !pairSide(o.attackerName)) return null;
    return {
        receiptId: o.receiptId,
        kind: 'garrison',
        winnerName: o.attackerName,
        targetName: '',
        endedAt: o.endedAt,
        status: 'pending',
        amounts: { winner: cardPveGarrisonCp(), loser: 0 },
    };
}

export type CardCpCommitted = Partial<Record<CardCpRole, { character: Record<string, unknown>; saveVersion: number }>>;

function shareKind(credit: CardCpCredit, role: CardCpRole): CardCpSourceKind {
    if (credit.kind === 'garrison') return 'garrison';
    return role === 'winner' ? 'pvpWin' : 'pvpLoss';
}

function nameOf(credit: CardCpCredit, role: CardCpRole): string {
    return role === 'winner' ? credit.winnerName : credit.targetName;
}

function roleOf(credit: CardCpCredit, viewer: string): CardCpRole | null {
    const slug = pairSide(viewer);
    if (!slug) return null;
    if (pairSide(credit.winnerName) === slug) return 'winner';
    if (credit.targetName && pairSide(credit.targetName) === slug) return 'loser';
    return null;
}

/**
 * Advance a pending outbox: decide the pair weight once (PvP), then pay each
 * share not yet paid. Never throws; a share that could not be paid stays
 * pending for the next request. `changed` tells the host to persist the row;
 * `committed` holds the save each share committed on THIS call.
 */
export async function settleCardCpCredit(credit: CardCpCredit | undefined): Promise<{ changed: boolean; committed: CardCpCommitted }> {
    const committed: CardCpCommitted = {};
    let changed = false;
    let winnerEstablished = true;
    if (!credit || credit.status !== 'pending') return { changed, committed };
    try {
        if (!credit.amounts && credit.kind === 'pvp') {
            // The PvP purse's credited-fight gate (pvp/_valid-fight.ts): a winner
            // more than 20 levels above the loser earns nobody anything, and a
            // loser that is not established (72 h old OR level 20) pays nobody.
            // A fresh winner earns the win but the loser gets no loss pay, so a
            // main can farm alts from neither seat. A deleted save or a missing
            // stamp passes; a failed read throws and leaves the credit pending.
            const [winnerChar, loserChar] = await Promise.all([credit.winnerName, credit.targetName].map(async (name) =>
                (await kv.get<{ character?: Record<string, unknown> }>(`save:${safeName(name)}`))?.character ?? {}));
            const gate = evaluateCreditedPvpFight({ winnerLevel: Number(winnerChar.level), loserLevel: Number(loserChar.level),
                loserCreatedAt: loserChar.createdAt, terminalAt: credit.endedAt });
            if (!gate.credited) {
                credit.status = 'skipped';
                credit.reason = gate.reason ?? 'too-young';
                return { changed: true, committed };
            }
            winnerEstablished = pvpAccountOldEnough(winnerChar.createdAt, credit.endedAt, winnerChar.level);
        }
        if (!credit.amounts) {
            // A free-play duel reads the free-play Legacy decision under the same
            // receipt, so it can never earn Legacy and not points (or the reverse).
            const eligible = await reserveFreePlayPairDecision(
                credit,
                credit.endedAt,
                credit.reciprocalHistory === 'war' ? CARD_CP_WAR_PAIR_HISTORY_PREFIX : undefined,
            );
            if (!eligible) {
                credit.status = 'skipped';
                credit.reason = 'reciprocal';
                return { changed: true, committed };
            }
            const pairOrdinal = await assignPvpCreditSlot(kv, {
                slotKey: cardCpPairSlotKey(credit.receiptId),
                counterKey: cardCpPairCounterKey(credit.winnerName, credit.targetName, pvpUtcDay(credit.endedAt)),
            });
            const pairWeight = pvpPairWeight(pairOrdinal);
            credit.pairOrdinal = pairOrdinal;
            credit.pairWeight = pairWeight;
            credit.amounts = {
                winner: whole(cardPvpWinCp() * pairWeight),
                loser: winnerEstablished ? whole(cardPvpLossCp() * pairWeight) : 0,
            };
            if (!winnerEstablished) credit.lossBlocked = 'too-young';
            changed = true;
        }
        for (const role of ['winner', 'loser'] as const) {
            const amount = credit.amounts[role];
            if (amount <= 0 || credit.paid?.[role]) continue;
            const paid = await payChroniclePointsOnce({
                player: nameOf(credit, role),
                receiptId: `${credit.receiptId}:${role}`,
                amount,
                kind: shareKind(credit, role),
            });
            if (paid.status === 'failed') {
                console.error(`[card-cp] ${credit.receiptId} ${role} share is still pending: ${paid.error}`);
                continue;
            }
            credit.paid = { ...(credit.paid ?? {}), [role]: true };
            changed = true;
            if (paid.status === 'paid') committed[role] = { character: paid.character, saveVersion: paid.saveVersion };
        }
        const amounts = credit.amounts;
        const settled = (role: CardCpRole) => amounts[role] <= 0 || credit.paid?.[role] === true;
        if (settled('winner') && settled('loser')) {
            credit.status = 'done';
            changed = true;
        }
    } catch (error) {
        console.error(`[card-cp] ${credit.receiptId} is still pending:`, error instanceof Error ? error.message : error);
    }
    return { changed, committed };
}

/** What the duel paid `viewer`, for the host's result screen. Undefined for a non-duelist. */
export function cardCpView(credit: CardCpCredit | undefined, viewer: string): CardChroniclePointsView | undefined {
    if (!credit) return undefined;
    const role = roleOf(credit, viewer);
    if (!role) return undefined;
    if (credit.status === 'skipped') {
        const reason = credit.reason ?? 'participation';
        return { earned: 0, status: 'none', reason, ...(reason === 'participation' ? { rules: cardPvpCpRules() } : {}) };
    }
    if (!credit.amounts) return { earned: 0, status: 'pending' };
    const earned = credit.amounts[role];
    const weight = credit.kind === 'pvp' && credit.pairWeight !== undefined ? { pairWeight: credit.pairWeight } : {};
    if (earned <= 0) {
        const reason = credit.pairWeight === 0 ? 'repeat' as const : role === 'loser' && credit.lossBlocked ? credit.lossBlocked : undefined;
        return { earned: 0, status: 'none', ...(reason ? { reason } : {}), ...weight };
    }
    return { earned, status: credit.paid?.[role] ? 'paid' : 'pending', ...weight };
}

/**
 * The body fields a card host adds to `viewer`'s reply: what the duel paid them
 * and, once, their authoritative save after their share committed, so the
 * result screen and the Card Hall show the new balance. `changed` tells the
 * host to persist the row (the delivery is recorded on it).
 */
export async function cardCpReply(
    credit: CardCpCredit | undefined,
    viewer: string,
    opts: { committed?: CardCpCommitted; deliver: boolean },
): Promise<{ body: Record<string, unknown>; changed: boolean }> {
    const view = cardCpView(credit, viewer);
    if (!credit || !view) return { body: {}, changed: false };
    const body: Record<string, unknown> = { chroniclePoints: view };
    const role = roleOf(credit, viewer);
    if (!opts.deliver || !role || !credit.paid?.[role] || credit.delivered?.[role] || !(credit.amounts?.[role] ?? 0)) {
        return { body, changed: false };
    }
    let snapshot = opts.committed?.[role];
    if (!snapshot) {
        const record = await kv.get<Record<string, unknown>>(`save:${pairSide(viewer)}`).catch(() => null);
        const character = record?.character;
        const saveVersion = Number(record?._saveVersion);
        if (character && typeof character === 'object' && Number.isSafeInteger(saveVersion) && saveVersion > 0) {
            snapshot = { character: character as Record<string, unknown>, saveVersion };
        }
    }
    credit.delivered = { ...(credit.delivered ?? {}), [role]: true };
    if (snapshot) {
        body.character = snapshot.character;
        body._saveVersion = snapshot.saveVersion;
    }
    return { body, changed: true };
}
