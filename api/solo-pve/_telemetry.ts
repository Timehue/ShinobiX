import { kv as realKv } from '../_storage.js';
import { recordBetaMetric, type BetaMetricInput } from '../_beta-metrics.js';
import { withoutKvLeaseContext } from '../_kv-lock-context.js';
import type { SoloPveSession } from './_session.js';

/*
 * Aggregate-only lifecycle telemetry for Solo PvE combat sessions.
 *
 * The four combat.session_* events were declared in api/_beta-metrics.ts but
 * emitted from nowhere, so the daily report's "N unresolved combat session(s)"
 * alert read a counter nothing could ever increment — it looked like coverage
 * and was inert. This is the emitting half.
 *
 * Modelled directly on api/towers/_telemetry.ts, and deliberately so:
 *   - ONCE-ONLY is enforced by an `nx` KV gate per (session, event), not by
 *     hoping each call site fires once. Retries, reconnects, and the settlement
 *     reconciler running again on a replayed request all collapse to one count.
 *   - NO player identifier is ever passed. applyBetaMetric would not persist
 *     `playerName` anyway, but omitting it keeps the no-identifier property true
 *     at the call site instead of depending on a downstream reader.
 *   - Sources are BUCKETED (encounter kind, level band, outcome) and never carry
 *     encounter.id / sourceId / bindingId, which are free-form and could echo
 *     authored content back into an aggregate.
 *   - Best-effort: a telemetry failure must never surface in a combat response.
 */

export const SOLO_PVE_TELEMETRY_TTL = 30 * 24 * 60 * 60;

type TelemetryKv = Pick<typeof realKv, 'set'>;
type MetricRecorder = (input: BetaMetricInput) => void;

export type SoloPveTelemetryDeps = { kv?: TelemetryKv; record?: MetricRecorder };

export type SoloPveLifecycleEvent =
    | 'combat.session_created'
    | 'combat.session_completed'
    | 'combat.session_settled'
    | 'combat.session_unresolved';

const GATE_SUFFIX: Record<SoloPveLifecycleEvent, string> = {
    'combat.session_created': 'created',
    'combat.session_completed': 'completed',
    'combat.session_settled': 'settled',
    'combat.session_unresolved': 'unresolved',
};

function encounterBucket(session: SoloPveSession): string {
    const kind = String(session.encounter?.kind ?? '').trim().toLowerCase();
    return /^[a-z0-9-]{1,32}$/.test(kind) ? kind : 'unknown';
}

/** Encounter difficulty as a band, so the source stays low-cardinality. */
function levelBucket(session: SoloPveSession): string {
    const level = Number(session.encounter?.level);
    if (!Number.isFinite(level) || level <= 0) return 'lvl-unknown';
    if (level <= 15) return 'lvl-1-15';
    if (level <= 29) return 'lvl-16-29';
    if (level <= 49) return 'lvl-30-49';
    if (level <= 79) return 'lvl-50-79';
    return 'lvl-80-plus';
}

function outcomeBucket(session: SoloPveSession): string {
    const outcome = String(session.outcome ?? '').trim().toLowerCase();
    return /^[a-z0-9-]{1,24}$/.test(outcome) ? outcome : 'outcome-unknown';
}

export function soloPveTelemetrySource(session: SoloPveSession, event: SoloPveLifecycleEvent): string {
    const common = `${encounterBucket(session)}:${levelBucket(session)}`;
    return event === 'combat.session_created' ? common : `${common}:${outcomeBucket(session)}`;
}

/**
 * Record one lifecycle transition at most once per session, ever.
 * Returns false when the gate was already taken, when the session is unusable,
 * or when telemetry storage is unavailable — never throws.
 *
 * Runs OUTSIDE the caller's storage lock, like every other telemetry writer
 * (recordBetaMetric, recordCombatUsage). Call sites fire it without awaiting
 * from inside locked combat writes, so its gate write can land after that lock
 * is released. Inside the lock context that late write failed the lease check
 * and poisoned the request's shared lock state: on 2026-11-06 it made
 * ai-fight-start's next write and its cleanup throw, leaving a live fight with
 * no resume pointer that held the player in "fighting" for 30 minutes.
 */
export function recordSoloPveLifecycle(
    event: SoloPveLifecycleEvent,
    session: SoloPveSession,
    deps: SoloPveTelemetryDeps = {},
): Promise<boolean> {
    return withoutKvLeaseContext(() => recordSoloPveLifecycleDetached(event, session, deps));
}

async function recordSoloPveLifecycleDetached(
    event: SoloPveLifecycleEvent,
    session: SoloPveSession,
    deps: SoloPveTelemetryDeps,
): Promise<boolean> {
    try {
        const sessionId = String(session?.sessionId ?? '').trim();
        if (!sessionId) return false;
        const store = deps.kv ?? realKv;
        const gate = await store.set(
            `solo-pve:telemetry:${GATE_SUFFIX[event]}:${sessionId}`,
            '1',
            { nx: true, ex: SOLO_PVE_TELEMETRY_TTL },
        );
        if (gate !== 'OK') return false;
        const input: BetaMetricInput = { event, source: soloPveTelemetrySource(session, event) };
        // The recorder catches its own storage failures; never await telemetry
        // behind a gameplay response.
        (deps.record ?? ((value) => { void recordBetaMetric(value); }))(input);
        return true;
    } catch {
        return false;
    }
}
