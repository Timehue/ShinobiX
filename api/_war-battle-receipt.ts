/*
 * Village War — battle receipts for HP damage (pure core).
 *
 * WHY: `POST /api/world-state {kind:'war'}` used to accept ANY HP number from a
 * member of a warring village, bounded only by a 100-per-request delta cap and the
 * endpoint's 60/min rate limit. Village HP is 5000, so one authenticated player
 * could drain an enemy village to zero in under a minute WITHOUT FIGHTING, then
 * claim the win — which transfers 15% of the loser village's treasury, stamps a
 * 3-day village-wide debuff on every enemy member, and mints the war crate.
 *
 * The client only ever reports damage from inside `handlePvpWin`, so a real,
 * finished, server-owned `pvp:<battleId>` session always exists behind legitimate
 * damage. This module is the check that it does. It mirrors the pattern the newer
 * sector war already uses (api/village/sector-war.ts): the authoritative session is
 * the source of truth, and each battle is consumed once.
 *
 * SCOPE (deliberate): this validates that damage is BACKED by a won battle and
 * bounds how much a single battle may authorize. It does not yet RECOMPUTE the
 * damage number server-side — that needs the village-war role table (clan-size
 * gate, village-Elder seats, home-sector bonus) ported to the server and is a
 * balance-touching change. Until then the per-request cap remains the ceiling.
 *
 * Underscore-prefixed → a shared helper, not a route.
 */

/** The single-use marker key for a battle already spent on a war. */
export function warBattleReceiptKey(warId: string, battleId: string): string {
    return `war:battle:${warId}:${battleId}`;
}

/** How long a spent-battle marker lives. Comfortably longer than the 14-day max
 *  war duration so a battle can never be replayed inside the war that used it. */
export const WAR_BATTLE_RECEIPT_TTL_SEC = 21 * 24 * 60 * 60;

/** Total village-war HP one battle may ever authorize, across however many writes
 *  the client splits it into.
 *
 *  A single won fight legitimately produces up to ~250: a war-ground raid banks the
 *  ground drain AND the same damage to village HP, a capture adds the bonus (itself
 *  clamped to the 100-per-request delta cap), and the PvP credit write adds a
 *  Kage-beats-Kage 92 on home ground — and the client splits that across two writes.
 *  400 clears that comfortably so honest play is never refused, while still meaning
 *  a 5000-HP village costs at least 13 REAL wins against real enemy players instead
 *  of 50 unbacked POSTs. Tightening this further wants server-side damage recompute
 *  (see the module header), not a smaller number. */
export const WAR_BATTLE_DAMAGE_BUDGET = 400;

export type WarBattleDecline =
    | 'missing-battle-id'
    | 'battle-not-found'
    | 'battle-unfinished'
    | 'battle-drawn'
    | 'not-a-two-fighter-battle'
    | 'not-a-participant'
    | 'not-a-cross-village-battle'
    | 'loser-cannot-deal-damage'
    | 'battle-predates-war'
    | 'battle-budget-spent';

export interface WarBattleShape {
    status?: string;
    winner?: string | null;
    createdAt?: number;
    p1?: { name?: string };
    p2?: { name?: string };
}

export interface ValidateWarBattleArgs {
    /** The authoritative `pvp:<battleId>` record (null when missing/expired). */
    battle: WarBattleShape | null | undefined;
    /** Canonical (lowercased) name of the player submitting the write. */
    actorName: string;
    /** The submitting player's SAVED village (never the request body). */
    actorVillage: string;
    /** The two villages on the war record. */
    warVillages: readonly string[];
    /** Saved village of the battle's p1 / p2, resolved server-side. */
    p1Village: string;
    p2Village: string;
    /** When the war effectively started — a battle older than this can't count. */
    warStartedAt: number;
    /** Damage already authorized by this battle (0 on first use). */
    budgetSpent?: number;
}

export type ValidateWarBattleResult =
    | { ok: true; winnerName: string; loserName: string; budgetRemaining: number }
    | { ok: false; reason: WarBattleDecline };

function norm(v: unknown): string {
    return String(v ?? '').trim().toLowerCase();
}

/**
 * Validate that a finished PvP session authorizes the actor to deal village-war
 * damage. Pure — the caller supplies the session and the server-resolved villages.
 *
 * Requires ALL of: the session is finished with a decisive winner; both fighters
 * are named; the actor is one of them; the two fighters sit on OPPOSITE sides of
 * this war; the actor's village is the WINNING side (you don't damage the enemy by
 * losing); the battle started after the war did; and the battle still has damage
 * budget left.
 */
export function validateWarBattle(args: ValidateWarBattleArgs): ValidateWarBattleResult {
    const battle = args.battle;
    if (!battle) return { ok: false, reason: 'battle-not-found' };
    if (battle.status !== 'done') return { ok: false, reason: 'battle-unfinished' };

    const winnerSide = String(battle.winner ?? '');
    if (winnerSide !== 'p1' && winnerSide !== 'p2') return { ok: false, reason: 'battle-drawn' };

    const p1 = norm(battle.p1?.name);
    const p2 = norm(battle.p2?.name);
    if (!p1 || !p2 || p1 === p2) return { ok: false, reason: 'not-a-two-fighter-battle' };

    const actor = norm(args.actorName);
    if (actor !== p1 && actor !== p2) return { ok: false, reason: 'not-a-participant' };

    // The fight must straddle this war: one fighter from each warring village.
    const villages = args.warVillages.map(norm).filter(Boolean);
    const v1 = norm(args.p1Village);
    const v2 = norm(args.p2Village);
    const straddles =
        villages.length === 2 &&
        v1 !== v2 &&
        villages.includes(v1) &&
        villages.includes(v2);
    if (!straddles) return { ok: false, reason: 'not-a-cross-village-battle' };

    // Only the winning side deals damage, and only the winner's own village may
    // bank it — so a loser can't self-report damage against the victor.
    const winnerName = winnerSide === 'p1' ? p1 : p2;
    const loserName = winnerSide === 'p1' ? p2 : p1;
    const winnerVillage = winnerSide === 'p1' ? v1 : v2;
    if (norm(args.actorVillage) !== winnerVillage) return { ok: false, reason: 'loser-cannot-deal-damage' };

    // A battle fought before the war opened (or during a previous war between the
    // same villages) can't be recycled into this one.
    const createdAt = Number(battle.createdAt);
    if (Number.isFinite(createdAt) && createdAt > 0 && createdAt < args.warStartedAt) {
        return { ok: false, reason: 'battle-predates-war' };
    }

    const spent = Math.max(0, Math.floor(Number(args.budgetSpent) || 0));
    const budgetRemaining = WAR_BATTLE_DAMAGE_BUDGET - spent;
    if (budgetRemaining <= 0) return { ok: false, reason: 'battle-budget-spent' };

    return { ok: true, winnerName, loserName, budgetRemaining };
}

// ── War-mission tokens ────────────────────────────────────────────────────────
// The daily war mission is the one damage source with neither a PvP battle nor a
// breached war ground behind it: /api/village/war-mission validates the raid count
// against STORED state and pays the character half itself. Rather than duplicate
// war-HP mutation in that endpoint, it MINTS a single-use token sealing the damage
// it authorized; the world-state write spends it. Same mint-token shape the pet
// expedition / raid reward paths use.

export const WAR_MISSION_TOKEN_TTL_SEC = 15 * 60;

export function warMissionTokenKey(tokenId: string): string {
    return `war:mission-token:${tokenId}`;
}

export interface WarMissionToken {
    /** Who the token was minted for (only they may spend it). */
    playerName: string;
    /** The minting player's village at mint time. */
    village: string;
    /** Damage sealed in at mint time — the write may not exceed it. */
    damage: number;
    expiresAt: number;
}

export function normalizeWarMissionToken(raw: Partial<WarMissionToken> | null | undefined): WarMissionToken | null {
    if (!raw) return null;
    const playerName = norm(raw.playerName);
    const village = String(raw.village ?? '').trim();
    const damage = Math.max(0, Math.floor(Number(raw.damage) || 0));
    const expiresAt = Math.floor(Number(raw.expiresAt) || 0);
    if (!playerName || !village || damage <= 0) return null;
    return { playerName, village, damage, expiresAt };
}

/** Whether a war-mission token authorizes this actor for this much damage. */
export function warMissionTokenAuthorizes(
    token: WarMissionToken | null,
    args: { actorName: string; actorVillage: string; claimedDamage: number; now: number },
): boolean {
    if (!token) return false;
    if (token.expiresAt > 0 && args.now > token.expiresAt) return false;
    if (norm(token.playerName) !== norm(args.actorName)) return false;
    if (norm(token.village) !== norm(args.actorVillage)) return false;
    return args.claimedDamage > 0 && args.claimedDamage <= token.damage;
}

/** Player-facing message for a declined war-damage write. */
export function warBattleDeclineMessage(reason: WarBattleDecline): string {
    switch (reason) {
        case 'missing-battle-id':
            return 'War damage must reference the battle that produced it.';
        case 'battle-not-found':
            return 'That battle session was not found or has expired — the damage was not applied.';
        case 'battle-unfinished':
            return 'That battle has not finished yet.';
        case 'battle-drawn':
            return 'That battle ended without a decisive winner, so it deals no war damage.';
        case 'not-a-two-fighter-battle':
            return 'That battle is not a two-fighter PvP session.';
        case 'not-a-participant':
            return 'Only a fighter in that battle may report its war damage.';
        case 'not-a-cross-village-battle':
            return 'That battle was not fought between the two villages at war.';
        case 'loser-cannot-deal-damage':
            return 'Only the winning side deals war damage.';
        case 'battle-predates-war':
            return 'That battle was fought before this war began.';
        case 'battle-budget-spent':
            return 'That battle has already been credited for its war damage.';
        default:
            return 'War damage could not be verified.';
    }
}
