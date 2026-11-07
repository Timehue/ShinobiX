import { kv as realKv } from './_storage.js';
import { betaDateKey, recordBetaMetric, type BetaMetricInput } from './_beta-metrics.js';
import { withoutKvLeaseContext } from './_kv-lock-context.js';

/*
 * Once-per-PLAYER onboarding funnel steps.
 *
 * api/solo-pve/_telemetry.ts gates per session, which is right for a combat
 * lifecycle. A funnel step is different: "first training" must count once for a
 * player and never again, across sessions, devices and reconnects. Same nx-gate
 * idea, keyed on the player instead.
 *
 * Deliberately NOT a save field. Marking firsts in the save would change save
 * shape for an analytics concern, and a sanitizer or a rollback could silently
 * resurrect a "first" that already happened. A KV gate keeps the analytics
 * concern out of player data entirely.
 *
 * As everywhere else in beta metrics, only the aggregate is kept: the player
 * name is used to build the gate key and is never passed to recordBetaMetric.
 */

/** A first is a first. Long enough that a returning beta player cannot re-count. */
export const BETA_FUNNEL_TTL_SECONDS = 365 * 24 * 60 * 60;

export type BetaFunnelEvent =
    | 'academy.started'
    | 'academy.step.reached'
    | 'academy.completed'
    | 'training.first_started'
    | 'loadout.first_jutsu_equipped'
    | 'loadout.first_item_equipped'
    | 'combat.first_completed'
    | 'sector.first_entered';

type FunnelKv = Pick<typeof realKv, 'get' | 'set'>;
type MetricRecorder = (input: BetaMetricInput) => void;

export type BetaFunnelDeps = {
    kv?: FunnelKv;
    record?: MetricRecorder;
    /** Distinguishes repeatable steps, e.g. one academy step from the next. */
    step?: string;
    /** Level band only — the raw level is never stored. */
    level?: number;
    source?: string;
    /** Event timestamp, mainly for deterministic cohort recording in tests. */
    ts?: number;
};

/**
 * Lowercased and restricted to characters that cannot break the key.
 *
 * An over-long name is REJECTED rather than truncated: slicing to a bound would
 * map two distinct long names onto one gate, so the second player's first would
 * be silently swallowed as a duplicate of the first player's.
 */
export const BETA_FUNNEL_SLUG_MAX = 64;

export function betaFunnelSlug(playerName: unknown): string | null {
    const slug = String(playerName ?? '').trim().toLowerCase();
    if (slug.length > BETA_FUNNEL_SLUG_MAX) return null;
    return /^[a-z0-9._-]+$/.test(slug) ? slug : null;
}

function stepSuffix(step: string | undefined): string {
    const clean = String(step ?? '').trim().toLowerCase().slice(0, 32);
    return /^[a-z0-9._-]{1,32}$/.test(clean) ? `:${clean}` : '';
}

/**
 * Record a funnel step at most once per player (per step, where one is given).
 * Returns false when already counted, when the name is unusable, or when
 * telemetry storage is unavailable — never throws.
 *
 * Runs OUTSIDE the caller's storage lock (see recordSoloPveLifecycle). The
 * combat call site fires this without awaiting as the last step of a locked
 * session write, so inside the lock context its gate write ran after the lock
 * was released, failed the lease check, and could poison an enclosing lock.
 * Production on 2026-11-06 had the gate for only 37 of the 74 players with a
 * PvE kill.
 */
export function recordBetaFunnelStep(
    event: BetaFunnelEvent,
    playerName: unknown,
    deps: BetaFunnelDeps = {},
): Promise<boolean> {
    return withoutKvLeaseContext(() => recordBetaFunnelStepDetached(event, playerName, deps));
}

async function recordBetaFunnelStepDetached(
    event: BetaFunnelEvent,
    playerName: unknown,
    deps: BetaFunnelDeps,
): Promise<boolean> {
    try {
        const slug = betaFunnelSlug(playerName);
        if (!slug) return false;
        const store = deps.kv ?? realKv;
        const ts = deps.ts ?? Date.now();
        const academyCohortDate = event === 'academy.started'
            ? betaDateKey(ts)
            : event === 'academy.step.reached'
                ? await store.get<string>(`beta:funnel:academy.started:${slug}`).catch(() => null)
                : null;
        const gate = await store.set(
            `beta:funnel:${event}${stepSuffix(deps.step)}:${slug}`,
            event === 'academy.started' ? betaDateKey(ts) : '1',
            { nx: true, ex: BETA_FUNNEL_TTL_SECONDS },
        );
        if (gate !== 'OK') return false;
        const input: BetaMetricInput = {
            event,
            ...(event === 'academy.step.reached' && deps.step ? { academyStep: deps.step } : {}),
            ...(event === 'academy.started' ? { academyCohortDate: betaDateKey(ts) } : {}),
            ...(event === 'academy.step.reached' && academyCohortDate ? { academyCohortDate } : {}),
            ...(Number.isFinite(Number(deps.level)) ? { level: Number(deps.level) } : {}),
            ...(deps.source ? { source: deps.source } : {}),
            ...(deps.ts === undefined ? {} : { ts }),
        };
        // Best-effort; the recorder catches its own storage failures.
        (deps.record ?? ((value) => { void recordBetaMetric(value); }))(input);
        return true;
    } catch {
        return false;
    }
}
