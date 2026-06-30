import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import {
    validateSubmittedDeck,
    validatePlays,
    resolveTurn,
    determineWinner,
    createMatch,
    dealOpening,
    shuffleDeck,
    pickRandomLocationIds,
    type ClashCard,
    type ClashSide,
    type ClashMatch,
    type ClashSideKey,
    type ClashPlay,
} from '../clan/war/_card-clash-engine.js';
import { canonicalClashStats, buildCreatorBaseMap } from '../clan/war/_card-catalog.js';
import { normalizeVillageWarRecord, villageWarKey, SECTOR_CONTROL_HP_PER_WIN } from '../_war-state.js';
import { sectorWarDamageMultiplier } from '../_war-structures.js';
import { applyContestBattleByWinner, sectorWarKey } from '../_sector-war.js';
import { loadSectorWar, saveSectorWar, deleteSectorWar } from '../_sector-war-store.js';
import { captureSectorForVillage } from '../world-state.js';

/*
 * /api/village/sector-card — POST only. The sector-war "Card" win-condition (Phase 4c-2).
 *
 * A faithful fork of the clan-war Card Clash interactive session (api/clan/war/
 * tilecards.ts): two players play the same server-authoritative 3-location /
 * 6-turn card game, but anchored to a SECTOR-WAR CONTEST instead of a clan-war
 * challenge. p1 is always the ATTACKER-village opener, p2 the DEFENDER-village
 * joiner — so the winner side maps straight onto the contest (p1 win → attacker
 * chips Control HP, p2 win → defender regen, draw → no change). On the match
 * finishing, the result is applied to the contest and the sector flips on capture
 * — the same Control-HP loop Combat uses, just driven by a Card battle.
 *
 * The pure engine + card catalog are reused unchanged from clan-war; only the
 * session storage + finalize differ. Server-gated: 404 unless ENABLE_VILLAGE_WAR=1.
 *
 * Body: { action, sectorWarId, ... }
 *   join         { defaultDeck: ClashCard[12] }   attacker opens / defender joins
 *   submit-deck  { deck: ClashCard[12] }
 *   commit-turn  { plays: {handIndex,loc}[] }
 *   forfeit      {}
 *   state        {}                                (projected read, drives timeouts)
 */

const TURN_TIMEOUT_MS = 60_000;
const PICKING_TIMEOUT_MS = 30_000;
const SESSION_TTL_SEC = 2 * 60 * 60; // 2h hygiene — abandoned sessions self-clean

type SectorCardSession = {
    sectorWarId: string;
    sector: number;
    attackerVillage: string;
    defenderVillage: string;
    p1: ClashSide;          // attacker-side opener
    p2?: ClashSide;         // defender-side joiner
    match: ClashMatch | null;
    status: 'awaiting-defender' | 'picking' | 'active' | 'done';
    winner?: ClashSideKey | 'draw';
    coinFlip?: ClashSideKey;
    createdAt: number;
    updatedAt: number;
    turnDeadline?: number;
    pickingDeadline?: number;
    appliedToContest?: boolean;
};

function sessionKey(sectorWarId: string): string {
    return `sector-card:${sectorWarId}`;
}
async function saveSession(s: SectorCardSession): Promise<void> {
    await kv.set(sessionKey(s.sectorWarId), s, { ex: SESSION_TTL_SEC });
}
async function villageOf(playerName: string): Promise<string> {
    const save = await kv.get<{ character?: { village?: string } }>(`save:${playerName.toLowerCase()}`);
    return String(save?.character?.village ?? '').trim();
}

function freshSide(name: string, village: string, defaultDeck: ClashCard[]): ClashSide {
    return {
        name, clan: village, defaultDeck,
        deck: [], hand: [], chakra: 0, nextDiscount: 0,
        committed: false, pending: [], ready: false,
    };
}

// Verify every card id in the submitted deck is owned + canonicalize its stats
// from the server's source of truth (identical posture to clan-war tilecards —
// IDs are the trust anchor; client-submitted stats are overridden).
async function resolveOwnedDeck(
    deck: ClashCard[], playerName: string, isAdmin: boolean,
): Promise<{ ok: true; deck: ClashCard[] } | { ok: false }> {
    const save = playerName ? await kv.get<Record<string, unknown>>(`save:${playerName.toLowerCase()}`) : null;
    const char = (save?.character ?? null) as Record<string, unknown> | null;
    if (!isAdmin && !char) return { ok: false };
    const owned = Array.isArray(char?.tileCards) ? (char!.tileCards as unknown[]) : [];
    const ownedIds = new Set<string>(owned.map((v) => String(v)));
    const creatorBase = buildCreatorBaseMap((save as Record<string, unknown> | null)?.creatorCards);
    const out: ClashCard[] = [];
    for (const card of deck) {
        if (!isAdmin && !ownedIds.has(card.id)) return { ok: false };
        const canon = canonicalClashStats(card.id, creatorBase);
        out.push(canon ? { ...card, ...canon } : card);
    }
    return { ok: true, deck: out };
}

function promoteSide(side: ClashSide): ClashSide {
    const chosen = side.ready && side.deck.length > 0 ? side.deck : side.defaultDeck;
    const shuffled = shuffleDeck(chosen);
    const { hand, rest } = dealOpening(shuffled);
    return { ...side, deck: rest, hand, chakra: 1, nextDiscount: 0, committed: false, pending: [] };
}

function startMatch(session: SectorCardSession, now: number): SectorCardSession {
    const p1 = promoteSide(session.p1);
    const p2 = session.p2 ? promoteSide(session.p2) : undefined;
    const coinFlip: ClashSideKey = Math.random() < 0.5 ? 'p1' : 'p2';
    return {
        ...session,
        p1, p2,
        match: createMatch(pickRandomLocationIds()),
        status: 'active',
        coinFlip,
        turnDeadline: now + TURN_TIMEOUT_MS,
        pickingDeadline: undefined,
        updatedAt: now,
    };
}

function resolveCommittedTurn(session: SectorCardSession, now: number): void {
    if (!session.match || !session.p2) return;
    const { isFinal } = resolveTurn(session.match, session.p1, session.p2, session.coinFlip ?? 'p1');
    if (isFinal) {
        session.status = 'done';
        session.winner = determineWinner(session.match);
        session.turnDeadline = undefined;
    } else {
        session.turnDeadline = now + TURN_TIMEOUT_MS;
    }
    session.updatedAt = now;
}

// Finalize → apply the result to the sector-war contest. p1 = attacker, p2 =
// defender (enforced at join), so the winner side maps directly. Idempotent via
// appliedToContest; runs under the contest lock (nested inside the session lock
// the callers hold — order session → contest → territory, no cycle).
async function applyCardOutcomeToContest(session: SectorCardSession): Promise<void> {
    await withKvLock(sectorWarKey(session.sectorWarId), async () => {
        const contest = await loadSectorWar(session.sectorWarId);
        if (!contest || contest.flipped) return;
        const atkRecord = normalizeVillageWarRecord(session.attackerVillage, (await kv.get<Record<string, unknown>>(villageWarKey(session.attackerVillage))) ?? undefined);
        const damage = Math.round(SECTOR_CONTROL_HP_PER_WIN * sectorWarDamageMultiplier(atkRecord));
        const outcome = applyContestBattleByWinner(contest, session.winner ?? 'draw', { now: Date.now(), damage });
        if (!outcome) return; // draw — Control HP untouched
        if (outcome.captured) {
            await captureSectorForVillage(session.sector, session.attackerVillage, Date.now());
            await deleteSectorWar(session.sectorWarId);
        } else {
            await saveSectorWar(outcome.session);
        }
    }, { failClosed: true });
}

async function persistAndMaybeFinalize(session: SectorCardSession): Promise<void> {
    if (session.status === 'done' && session.winner && !session.appliedToContest) {
        await applyCardOutcomeToContest(session);
        session.appliedToContest = true;
    }
    await saveSession(session);
}

// ── Per-viewer projection — strips the opponent's hand contents + staged plays ──
function projectSide(side: ClashSide) {
    return {
        name: side.name, clan: side.clan, ready: side.ready,
        committed: side.committed, chakra: side.chakra,
        nextDiscount: side.nextDiscount, handCount: side.hand.length, deckCount: side.deck.length,
    };
}
function projectFor(session: SectorCardSession, viewer: ClashSideKey | null) {
    const base = {
        sectorWarId: session.sectorWarId, sector: session.sector,
        attackerVillage: session.attackerVillage, defenderVillage: session.defenderVillage,
        status: session.status, winner: session.winner, coinFlip: session.coinFlip,
        turnDeadline: session.turnDeadline, pickingDeadline: session.pickingDeadline,
        match: session.match, turn: session.match?.turn ?? 0,
    };
    const youKey = viewer;
    const oppKey: ClashSideKey | null = viewer === 'p1' ? 'p2' : viewer === 'p2' ? 'p1' : null;
    const youSide = youKey === 'p1' ? session.p1 : youKey === 'p2' ? session.p2 : null;
    const oppSide = oppKey === 'p1' ? session.p1 : oppKey === 'p2' ? session.p2 : null;
    return {
        ...base,
        side: youKey,
        you: youSide
            ? {
                  side: youKey, name: youSide.name, clan: youSide.clan, ready: youSide.ready,
                  committed: youSide.committed, chakra: youSide.chakra, nextDiscount: youSide.nextDiscount,
                  hand: youSide.hand, pending: youSide.pending, deckCount: youSide.deck.length,
              }
            : null,
        opponent: oppSide ? projectSide(oppSide) : null,
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (process.env.ENABLE_VILLAGE_WAR !== '1') return res.status(404).json({ error: 'Not found.' });

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'sector-card', 90, 60_000, identity.name))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const action = String(body?.action ?? '').toLowerCase();
        const sectorWarId = String(body?.sectorWarId ?? '').trim();
        if (!sectorWarId) return res.status(400).json({ error: 'Missing sectorWarId.' });

        const me = identity.admin ? String(body?.playerName ?? '') : identity.name;
        const meLower = me.toLowerCase();
        function viewerKey(session: SectorCardSession): ClashSideKey | null {
            if (session.p1.name.toLowerCase() === meLower) return 'p1';
            if (session.p2 && session.p2.name.toLowerCase() === meLower) return 'p2';
            return null;
        }

        // ── state read (handles picking + turn timeouts, returns projection) ──
        if (action === 'state') {
            const session = await kv.get<SectorCardSession>(sessionKey(sectorWarId));
            if (!session) return res.status(404).json({ error: 'No card duel session yet.' });
            const now = Date.now();

            if (session.status === 'picking' && session.pickingDeadline && now > session.pickingDeadline) {
                await withKvLock(sessionKey(sectorWarId), async () => {
                    const fresh = await kv.get<SectorCardSession>(sessionKey(sectorWarId));
                    if (!fresh || fresh.status !== 'picking' || !fresh.pickingDeadline || now <= fresh.pickingDeadline) return;
                    await saveSession(startMatch(fresh, now));
                });
            } else if (session.status === 'active' && session.turnDeadline && now > session.turnDeadline) {
                await withKvLock(sessionKey(sectorWarId), async () => {
                    const fresh = await kv.get<SectorCardSession>(sessionKey(sectorWarId));
                    if (!fresh || fresh.status !== 'active' || !fresh.turnDeadline || now <= fresh.turnDeadline || !fresh.p2) return;
                    if (!fresh.p1.committed) { fresh.p1.pending = []; fresh.p1.committed = true; }
                    if (!fresh.p2.committed) { fresh.p2.pending = []; fresh.p2.committed = true; }
                    resolveCommittedTurn(fresh, now);
                    await persistAndMaybeFinalize(fresh);
                });
            }

            const latest = (await kv.get<SectorCardSession>(sessionKey(sectorWarId))) ?? session;
            return res.status(200).json({ session: projectFor(latest, viewerKey(latest)) });
        }

        const result = await withKvLock(sessionKey(sectorWarId), async () => {
            const existing = await kv.get<SectorCardSession>(sessionKey(sectorWarId));

            // ── join (attacker opens p1 / defender joins p2) ──────────
            if (action === 'join') {
                const contest = await loadSectorWar(sectorWarId);
                if (!contest || contest.flipped) return { status: 409 as const, body: { error: 'No active sector war for that id.' } };
                if (contest.winCondition !== 'card') return { status: 409 as const, body: { error: 'That sector is not a Card contest.' } };
                const { attackerVillage, defenderVillage } = contest;

                const myVillage = identity.admin ? '' : await villageOf(me);
                const isAttackerSide = identity.admin ? String(body?.side ?? 'p1') !== 'p2' : myVillage === attackerVillage;
                const isDefenderSide = identity.admin ? String(body?.side ?? 'p1') === 'p2' : myVillage === defenderVillage;
                if (!isAttackerSide && !isDefenderSide) {
                    return { status: 403 as const, body: { error: 'You are not a participant in this sector war.' } };
                }

                const validated = validateSubmittedDeck(body?.defaultDeck);
                if (!validated.ok) return { status: 400 as const, body: { error: `Invalid default deck: ${validated.error}` } };
                const resolved = await resolveOwnedDeck(validated.deck, me, identity.admin);
                if (!resolved.ok) return { status: 403 as const, body: { error: 'Default deck contains cards you do not own.' } };

                const now = Date.now();
                const newSide = freshSide(me, identity.admin ? (isAttackerSide ? attackerVillage : defenderVillage) : myVillage, resolved.deck);

                // No session yet, or the previous battle is over → the attacker opens a fresh one.
                if (!existing || existing.status === 'done') {
                    if (!isAttackerSide) return { status: 409 as const, body: { error: 'Waiting for an attacker to open a card battle.' } };
                    const session: SectorCardSession = {
                        sectorWarId, sector: contest.sector, attackerVillage, defenderVillage,
                        p1: newSide, match: null, status: 'awaiting-defender', createdAt: now, updatedAt: now,
                    };
                    await saveSession(session);
                    return { status: 200 as const, body: { session: projectFor(session, 'p1') } };
                }
                // Idempotent re-join.
                if (existing.p1.name.toLowerCase() === meLower || (existing.p2 && existing.p2.name.toLowerCase() === meLower)) {
                    return { status: 200 as const, body: { session: projectFor(existing, viewerKey(existing)) } };
                }
                if (existing.status !== 'awaiting-defender') {
                    return { status: 409 as const, body: { error: 'Card battle is no longer accepting a joiner.' } };
                }
                if (!isDefenderSide) {
                    return { status: 409 as const, body: { error: 'A defender of this sector must join the battle.' } };
                }
                const session: SectorCardSession = {
                    ...existing, p2: newSide, status: 'picking',
                    pickingDeadline: now + PICKING_TIMEOUT_MS, updatedAt: now,
                };
                await saveSession(session);
                return { status: 200 as const, body: { session: projectFor(session, 'p2') } };
            }

            if (!existing) return { status: 404 as const, body: { error: 'No card duel session yet — call join first.' } };

            const isP1 = existing.p1.name.toLowerCase() === meLower;
            const isP2 = !!existing.p2 && existing.p2.name.toLowerCase() === meLower;
            if (!identity.admin && !isP1 && !isP2) {
                return { status: 403 as const, body: { error: 'Only the two duelists can act on this session.' } };
            }
            const mySide: ClashSideKey = identity.admin ? (String(body?.side ?? 'p1') as ClashSideKey) : (isP1 ? 'p1' : 'p2');

            // ── submit-deck ─────────────────────────────────────────
            if (action === 'submit-deck') {
                if (existing.status !== 'picking') return { status: 409 as const, body: { error: 'Deck-picking phase is closed.' } };
                const validated = validateSubmittedDeck(body?.deck);
                if (!validated.ok) return { status: 400 as const, body: { error: `Invalid deck: ${validated.error}` } };
                const resolvedDeck = await resolveOwnedDeck(validated.deck, me, identity.admin);
                if (!resolvedDeck.ok) return { status: 403 as const, body: { error: 'Deck contains cards you do not own.' } };

                const now = Date.now();
                const target = mySide === 'p1' ? existing.p1 : existing.p2!;
                const updatedSide: ClashSide = { ...target, deck: resolvedDeck.deck, ready: true };
                let next: SectorCardSession = {
                    ...existing,
                    p1: mySide === 'p1' ? updatedSide : existing.p1,
                    p2: mySide === 'p2' ? updatedSide : existing.p2,
                    updatedAt: now,
                };
                if (next.p1.ready && next.p2?.ready) next = startMatch(next, now);
                await saveSession(next);
                return { status: 200 as const, body: { session: projectFor(next, mySide) } };
            }

            // ── commit-turn ─────────────────────────────────────────
            if (action === 'commit-turn') {
                if (existing.status !== 'active' || !existing.match || !existing.p2) {
                    return { status: 409 as const, body: { error: 'Card duel is not active.' } };
                }
                const side = mySide === 'p1' ? existing.p1 : existing.p2;
                if (side.committed) return { status: 409 as const, body: { error: 'You already committed this turn.' } };

                const rawPlays = Array.isArray(body?.plays) ? body.plays : [];
                const plays: ClashPlay[] = rawPlays.map((p: unknown) => {
                    const o = (p ?? {}) as Record<string, unknown>;
                    return { handIndex: Number(o.handIndex), loc: Number(o.loc) };
                });
                const check = validatePlays(existing.match, side, mySide, plays);
                if (!check.ok) return { status: 400 as const, body: { error: check.error } };

                const now = Date.now();
                side.pending = plays;
                side.committed = true;
                if (existing.p1.committed && existing.p2.committed) {
                    resolveCommittedTurn(existing, now);
                }
                existing.updatedAt = now;
                await persistAndMaybeFinalize(existing);
                return { status: 200 as const, body: { session: projectFor(existing, mySide) } };
            }

            // ── forfeit ─────────────────────────────────────────────
            if (action === 'forfeit') {
                if (existing.status === 'done') return { status: 409 as const, body: { error: 'Card duel already over.' } };
                const now = Date.now();
                existing.status = 'done';
                existing.winner = mySide === 'p1' ? 'p2' : 'p1';
                existing.turnDeadline = undefined;
                existing.pickingDeadline = undefined;
                existing.updatedAt = now;
                await persistAndMaybeFinalize(existing);
                return { status: 200 as const, body: { session: projectFor(existing, mySide) } };
            }

            return { status: 400 as const, body: { error: `Unknown action: ${action}` } };
        });

        return res.status(result.status).json(result.body);
    } catch (err) {
        console.error('[village/sector-card]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
