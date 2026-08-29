import { kv, type KvLike } from './_storage.js';
import { withTelemetryLock } from './_telemetry-lock.js';
import { captureProductEventFromBetaMetric } from './_product-analytics.js';

export type BetaMetricEvent =
    | 'account.registered'
    | 'character.created'
    | 'academy.started'
    | 'academy.step.reached'
    | 'academy.completed'
    | 'academy.trial.claimed'
    | 'academy.checklist.claimed'
    | 'training.first_started'
    | 'loadout.first_jutsu_equipped'
    | 'loadout.first_item_equipped'
    | 'combat.first_completed'
    | 'mission.claimed'
    | 'hunt.claimed'
    | 'sector.first_entered'
    | 'session.ended'
    | 'reward.duplicate_rejected'
    | 'reward.claim_failed'
    | 'combat.session_created'
    | 'combat.session_completed'
    | 'combat.session_settled'
    | 'combat.session_unresolved'
    | 'hollow_gate.run_started'
    | 'hollow_gate.run_start_replayed'
    | 'hollow_gate.floor_descended'
    | 'hollow_gate.combat_started'
    | 'hollow_gate.combat_resumed'
    | 'hollow_gate.combat_settled'
    | 'hollow_gate.combat_settle_replayed'
    | 'hollow_gate.run_completed'
    | 'hollow_gate.run_extracted'
    | 'hollow_gate.run_forfeited'
    | 'hollow_gate.run_settle_replayed'
    | 'clan_boss.assault_settled'
    | 'tower.run_started'
    | 'tower.run_settled'
    | 'pvp.settled'
    | 'bank.interest.claimed'
    | 'card.pack_opened'
    | 'pet.acquired';

export type BetaRewardTotals = Record<string, number>;

export interface BetaMetricDay {
    date: string;
    updatedAt: number;
    events: Record<string, number>;
    levelBands: Record<string, number>;
    sources: Record<string, number>;
    rewardTotals: BetaRewardTotals;
    /** `domain:rarity` -> count, scarce tiers only. See betaRareGrantKey. */
    rareGrants: Record<string, number>;
}

export interface BetaMetricInput {
    event: BetaMetricEvent;
    playerName?: string;
    level?: number;
    source?: string;
    xp?: number;
    ryo?: number;
    stamina?: number;
    territoryScrolls?: number;
    itemCount?: number;
    currencies?: Record<string, unknown>;
    /** Pre-normalized by betaRareGrantTally; ordinary tiers are already dropped. */
    rareGrants?: Record<string, number>;
    ts?: number;
}

export interface BetaMetricsSnapshot {
    generatedAt: number;
    days: number;
    daily: BetaMetricDay[];
    totals: Omit<BetaMetricDay, 'date' | 'updatedAt'>;
}

const BETA_METRICS_RETENTION_SECONDS = 120 * 24 * 60 * 60;
const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;

type BetaKv = Pick<KvLike, 'get' | 'set'>;

export function betaDateKey(ts = Date.now()): string {
    return new Date(ts).toISOString().slice(0, 10);
}

export function betaMetricKey(date: string): string {
    return `beta:metrics:${date}`;
}

export function betaLevelBand(level: unknown): string {
    const lv = Math.floor(Number(level));
    if (!Number.isFinite(lv) || lv <= 0) return 'unknown';
    if (lv < 10) return 'L1-9';
    if (lv < 15) return 'L10-14';
    if (lv < 20) return 'L15-19';
    if (lv < 30) return 'L20-29';
    if (lv < 40) return 'L30-39';
    if (lv < 50) return 'L40-49';
    if (lv < 80) return 'L50-79';
    return 'L80-100';
}

/*
 * Rare-grant normalization.
 *
 * The repo has four rarity vocabularies that do not agree: ItemRarity is
 * common|uncommon|rare|epic|legendary|mythic|named, PetRarity is
 * standard|rare|legendary|mythic, MarketplaceCardRarity drops mythic, and
 * Chronicle has its own. What an operator actually wants is one question across
 * all of them — how much SCARCE stuff is being handed out today — so the tiers
 * every vocabulary treats as ordinary are dropped and the rest are counted under
 * a `domain:rarity` key.
 */
export type BetaGrantDomain = 'pet' | 'card' | 'item' | 'jutsu' | 'bloodline';

/** The ordinary tiers, across every vocabulary. Anything else is scarce. */
const ORDINARY_RARITIES = new Set(['standard', 'common', 'uncommon', 'basic', 'normal', '']);

const GRANT_DOMAINS = new Set<string>(['pet', 'card', 'item', 'jutsu', 'bloodline']);

/**
 * `pet:mythic`, `card:legendary`, ... or null when the rarity is an ordinary
 * tier, unreadable, or the domain is not one we track. Null means "do not
 * count", never "count as unknown" — a junk rarity must not inflate scarcity.
 */
export function betaRareGrantKey(domain: string, rarity: unknown): string | null {
    if (!GRANT_DOMAINS.has(domain)) return null;
    const tier = String(rarity ?? '').trim().toLowerCase();
    if (!/^[a-z][a-z-]{0,23}$/.test(tier)) return null;
    if (ORDINARY_RARITIES.has(tier)) return null;
    return `${domain}:${tier}`;
}

/** Tally a batch of grants (a pack open, a clutch) into a rareGrants map. */
export function betaRareGrantTally(domain: string, rarities: readonly unknown[]): Record<string, number> {
    const tally: Record<string, number> = {};
    for (const rarity of rarities ?? []) {
        const key = betaRareGrantKey(domain, rarity);
        if (key) tally[key] = (tally[key] ?? 0) + 1;
    }
    return tally;
}

function emptyDay(date: string, updatedAt = 0): BetaMetricDay {
    return {
        date,
        updatedAt,
        events: {},
        levelBands: {},
        sources: {},
        rewardTotals: {},
        rareGrants: {},
    };
}

function inc(map: Record<string, number>, key: string, amount: unknown): void {
    if (amount === undefined || amount === null) return;
    const n = Number(amount);
    if (!key || !Number.isFinite(n) || n === 0) return;
    map[key] = Math.round((map[key] ?? 0) + n);
}

function safeSource(source: string | undefined): string | null {
    const clean = String(source ?? '').trim().slice(0, 64);
    return clean || null;
}

export function applyBetaMetric(day: BetaMetricDay | null | undefined, input: BetaMetricInput): BetaMetricDay {
    const ts = input.ts ?? Date.now();
    const date = betaDateKey(ts);
    const next: BetaMetricDay = {
        ...emptyDay(date, ts),
        ...(day ?? {}),
        date,
        updatedAt: ts,
        events: { ...(day?.events ?? {}) },
        levelBands: { ...(day?.levelBands ?? {}) },
        sources: { ...(day?.sources ?? {}) },
        rewardTotals: { ...(day?.rewardTotals ?? {}) },
        rareGrants: { ...(day?.rareGrants ?? {}) },
    };

    inc(next.events, input.event, 1);
    inc(next.levelBands, betaLevelBand(input.level), 1);
    const source = safeSource(input.source);
    if (source) inc(next.sources, source, 1);

    inc(next.rewardTotals, 'xp', input.xp);
    inc(next.rewardTotals, 'ryo', input.ryo);
    inc(next.rewardTotals, 'stamina', input.stamina);
    inc(next.rewardTotals, 'territoryScrolls', input.territoryScrolls);
    inc(next.rewardTotals, 'items', input.itemCount);
    for (const [currency, amount] of Object.entries(input.currencies ?? {})) {
        inc(next.rewardTotals, currency, Number(amount));
    }
    for (const [grant, count] of Object.entries(input.rareGrants ?? {})) {
        // Re-validated on the way in: an emitter cannot smuggle an ordinary tier
        // or a junk key into the scarcity tally by hand-building the map.
        const [domain, ...rest] = grant.split(':');
        const key = betaRareGrantKey(domain, rest.join(':'));
        if (key) inc(next.rareGrants, key, Number(count));
    }

    return next;
}

export function recentBetaDates(days: number, now = Date.now()): string[] {
    const count = Math.max(1, Math.min(Math.floor(Number(days) || DEFAULT_DAYS), MAX_DAYS));
    const dates: string[] = [];
    for (let i = 0; i < count; i++) {
        dates.push(betaDateKey(now - i * 24 * 60 * 60 * 1000));
    }
    return dates;
}

export async function recordBetaMetric(input: BetaMetricInput, opts: { kv?: BetaKv } = {}): Promise<void> {
    captureProductEventFromBetaMetric(input);
    const store = opts.kv ?? kv;
    try {
        const ts = input.ts ?? Date.now();
        const key = betaMetricKey(betaDateKey(ts));
        await withTelemetryLock(key, store, async () => {
            const current = await store.get<BetaMetricDay>(key);
            const next = applyBetaMetric(current, { ...input, ts });
            await store.set(key, next, { ex: BETA_METRICS_RETENTION_SECONDS });
        });
    } catch (e) {
        console.error('[beta-metrics] record failed:', e);
    }
}

function mergeCounts(into: Record<string, number>, from: Record<string, number>): void {
    for (const [key, value] of Object.entries(from)) inc(into, key, value);
}

export async function readBetaMetricsSnapshot(days = DEFAULT_DAYS, opts: { kv?: BetaKv; now?: number } = {}): Promise<BetaMetricsSnapshot> {
    const store = opts.kv ?? kv;
    const now = opts.now ?? Date.now();
    const dates = recentBetaDates(days, now);
    const daily: BetaMetricDay[] = [];
    for (const date of dates) {
        const stored = await store.get<BetaMetricDay>(betaMetricKey(date)).catch(() => null);
        daily.push(stored ? { ...emptyDay(date), ...stored, date } : emptyDay(date));
    }
    const totals: Omit<BetaMetricDay, 'date' | 'updatedAt'> = {
        events: {},
        levelBands: {},
        sources: {},
        rewardTotals: {},
        rareGrants: {},
    };
    for (const day of daily) {
        mergeCounts(totals.events, day.events);
        mergeCounts(totals.levelBands, day.levelBands);
        mergeCounts(totals.sources, day.sources);
        mergeCounts(totals.rewardTotals, day.rewardTotals);
        mergeCounts(totals.rareGrants, day.rareGrants);
    }
    return { generatedAt: now, days: dates.length, daily, totals };
}
