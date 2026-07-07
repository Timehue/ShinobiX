import { kv, type KvLike } from './_storage.js';

export type BetaMetricEvent =
    | 'account.registered'
    | 'academy.trial.claimed'
    | 'academy.checklist.claimed'
    | 'mission.claimed'
    | 'hunt.claimed'
    | 'pvp.settled'
    | 'bank.interest.claimed';

export type BetaRewardTotals = Record<string, number>;

export interface BetaMetricDay {
    date: string;
    updatedAt: number;
    events: Record<string, number>;
    levelBands: Record<string, number>;
    sources: Record<string, number>;
    rewardTotals: BetaRewardTotals;
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

function emptyDay(date: string, updatedAt = 0): BetaMetricDay {
    return {
        date,
        updatedAt,
        events: {},
        levelBands: {},
        sources: {},
        rewardTotals: {},
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
    const store = opts.kv ?? kv;
    try {
        const ts = input.ts ?? Date.now();
        const key = betaMetricKey(betaDateKey(ts));
        const current = await store.get<BetaMetricDay>(key);
        const next = applyBetaMetric(current, { ...input, ts });
        await store.set(key, next, { ex: BETA_METRICS_RETENTION_SECONDS });
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
    };
    for (const day of daily) {
        mergeCounts(totals.events, day.events);
        mergeCounts(totals.levelBands, day.levelBands);
        mergeCounts(totals.sources, day.sources);
        mergeCounts(totals.rewardTotals, day.rewardTotals);
    }
    return { generatedAt: now, days: dates.length, daily, totals };
}
