export type WeeklyBossFightToken = {
    playerName: string;
    weekKey: string;
    aiId: string;
    bossStartedAt: number;
    maxDamage: number;
    perHitCap?: number;
    maxHits?: number;
    mintedAt: number;
};

export type WeeklyBossDamageEvent = {
    turn: number;
    amount: number;
    source?: string;
};

const WEEKLY_BOSS_GUARD_CYCLE = 4;
const WEEKLY_BOSS_GUARDED_DAMAGE_MULT = 0.30;
const WEEKLY_BOSS_OPEN_DAMAGE_MULT = 2.0;
const WEEKLY_BOSS_MAX_PROOF_TURNS = 200;
const WEEKLY_BOSS_MAX_EVENTS_PER_TURN = 12;

export function weeklyBossFightTokenKey(playerName: string, weekKey: string, token: string): string {
    return `weekly-boss-fight:${weekKey}:${playerName}:${token}`;
}

export function cleanWeeklyBossFightToken(raw: unknown): string {
    const token = typeof raw === 'string' ? raw.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9]+$/.test(token) ? token : '';
}

function weeklyBossDamageMultiplierForTurn(turn: number): number {
    const t = Math.max(1, Math.floor(turn || 1));
    return (t - 1) % WEEKLY_BOSS_GUARD_CYCLE === 0
        ? WEEKLY_BOSS_OPEN_DAMAGE_MULT
        : WEEKLY_BOSS_GUARDED_DAMAGE_MULT;
}

export function cleanWeeklyBossDamageEvents(raw: unknown): WeeklyBossDamageEvent[] {
    if (!Array.isArray(raw)) return [];
    const events: WeeklyBossDamageEvent[] = [];
    for (const item of raw.slice(0, 250)) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const turn = Math.max(1, Math.min(WEEKLY_BOSS_MAX_PROOF_TURNS, Math.floor(Number(rec.turn ?? 1) || 1)));
        const amount = Math.max(0, Math.floor(Number(rec.amount ?? 0) || 0));
        if (amount <= 0) continue;
        const sourceRaw = typeof rec.source === 'string' ? rec.source.trim().slice(0, 32) : '';
        const source = /^[A-Za-z0-9:_-]+$/.test(sourceRaw) ? sourceRaw : undefined;
        events.push({ turn, amount, ...(source ? { source } : {}) });
    }
    return events;
}

function validateDamageEvents(
    token: WeeklyBossFightToken,
    events: WeeklyBossDamageEvent[],
): { ok: true; damage: number } | { ok: false; reason: string } {
    if (!events.length) return { ok: false, reason: 'missing-weekly-boss-damage-proof' };
    const maxHits = Math.max(1, Math.floor(Number(token.maxHits ?? 0) || 0));
    if (events.length > maxHits) return { ok: false, reason: 'weekly-boss-too-many-proof-events' };

    const perHitBase = Math.max(1, Math.floor(Number(token.perHitCap ?? 0) || 0));
    if (!Number.isFinite(perHitBase) || perHitBase <= 0) return { ok: false, reason: 'invalid-weekly-boss-proof-cap' };

    let damage = 0;
    const eventsByTurn = new Map<number, number>();
    for (const event of events) {
        const turn = Math.max(1, Math.min(WEEKLY_BOSS_MAX_PROOF_TURNS, Math.floor(Number(event.turn ?? 1) || 1)));
        const count = (eventsByTurn.get(turn) ?? 0) + 1;
        if (count > WEEKLY_BOSS_MAX_EVENTS_PER_TURN) return { ok: false, reason: 'weekly-boss-too-many-proof-events-per-turn' };
        eventsByTurn.set(turn, count);

        const amount = Math.max(0, Math.floor(Number(event.amount ?? 0) || 0));
        if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: 'invalid-weekly-boss-damage-proof' };
        const turnCap = Math.max(1, Math.floor(perHitBase * weeklyBossDamageMultiplierForTurn(turn)));
        if (amount > turnCap) return { ok: false, reason: 'weekly-boss-proof-hit-exceeds-cap' };
        damage += amount;
        if (damage > Math.max(0, Math.floor(Number(token.maxDamage) || 0))) {
            return { ok: false, reason: 'weekly-boss-damage-exceeds-token' };
        }
    }
    return { ok: true, damage };
}

export function validateWeeklyBossFightClaim(
    token: WeeklyBossFightToken | null | undefined,
    expected: { playerName: string; weekKey: string; aiId: string; bossStartedAt: number },
    amount: unknown,
    damageEvents?: WeeklyBossDamageEvent[],
): { ok: true; damage: number } | { ok: false; reason: string } {
    if (!token) return { ok: false, reason: 'invalid-or-spent-weekly-boss-token' };
    if ((token.playerName ?? '').toLowerCase() !== expected.playerName.toLowerCase()) return { ok: false, reason: 'wrong-player-weekly-boss-token' };
    if (token.weekKey !== expected.weekKey || token.aiId !== expected.aiId || Number(token.bossStartedAt) !== Number(expected.bossStartedAt)) {
        return { ok: false, reason: 'stale-weekly-boss-token' };
    }
    if (damageEvents && damageEvents.length > 0) {
        return validateDamageEvents(token, damageEvents);
    }
    const requested = Math.floor(Number(amount ?? 0));
    if (!Number.isFinite(requested) || requested < 0) return { ok: false, reason: 'invalid-damage' };
    const maxDamage = Math.max(0, Math.floor(Number(token.maxDamage) || 0));
    if (requested > maxDamage) return { ok: false, reason: 'weekly-boss-damage-exceeds-token' };
    return { ok: true, damage: requested };
}
