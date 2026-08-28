import { kv as realKv } from './_storage.js';
import { recordBetaMetric, type BetaMetricInput } from './_beta-metrics.js';

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

type FunnelKv = Pick<typeof realKv, 'set'>;
type MetricRecorder = (input: BetaMetricInput) => void;

export type BetaFunnelDeps = {
    kv?: FunnelKv;
    record?: MetricRecorder;
    /** Distinguishes repeatable steps, e.g. one academy step from the next. */
    step?: string;
    /** Level band only — the raw level is never stored. */
    level?: number;
    source?: string;
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
 */
export async function recordBetaFunnelStep(
    event: BetaFunnelEvent,
    playerName: unknown,
    deps: BetaFunnelDeps = {},
): Promise<boolean> {
    try {
        const slug = betaFunnelSlug(playerName);
        if (!slug) return false;
        const store = deps.kv ?? realKv;
        const gate = await store.set(
            `beta:funnel:${event}${stepSuffix(deps.step)}:${slug}`,
            '1',
            { nx: true, ex: BETA_FUNNEL_TTL_SECONDS },
        );
        if (gate !== 'OK') return false;
        const input: BetaMetricInput = {
            event,
            ...(Number.isFinite(Number(deps.level)) ? { level: Number(deps.level) } : {}),
            ...(deps.source ? { source: deps.source } : {}),
        };
        // Best-effort; the recorder catches its own storage failures.
        (deps.record ?? ((value) => { void recordBetaMetric(value); }))(input);
        return true;
    } catch {
        return false;
    }
}
