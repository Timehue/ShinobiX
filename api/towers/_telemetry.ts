import { kv as realKv } from '../_storage.js';
import { recordBetaMetric, type BetaMetricInput } from '../_beta-metrics.js';
import type { TowerSession } from './_tower-session.js';

export const TOWER_TELEMETRY_TTL = 30 * 24 * 60 * 60;

type TelemetryKv = Pick<typeof realKv, 'set'>;
type MetricRecorder = (input: BetaMetricInput) => void;

export type TowerTelemetryDeps = {
    kv?: TelemetryKv;
    record?: MetricRecorder;
};

function mode(session: TowerSession): 'story' | 'spire' {
    return session.floorProvenance?.kind === 'spire-generated'
        || (session.floorProvenance === undefined && session.towerId === 'endless-spire' && session.ascensionTier !== undefined)
        ? 'spire'
        : 'story';
}

function contentBucket(session: TowerSession): string {
    const value = Math.max(1, Math.floor(Number(session.ascensionTier ?? session.floor) || 1));
    // Thirty total canonical values is still low-cardinality and lets live
    // balance audits identify one broken AI/mechanic floor instead of hiding it
    // inside a broad band.
    return mode(session) === 'story'
        ? `floor-${Math.min(10, value)}`
        : `tier-${Math.min(20, value)}`;
}

function partyBucket(session: TowerSession): string {
    const value = Math.max(1, Math.min(4, Math.floor(Number(session.partySize) || 1)));
    return `party-${value}`;
}

function roundsBucket(round: unknown): string {
    const value = Math.max(1, Math.floor(Number(round) || 1));
    if (value <= 5) return 'rounds-1-5';
    if (value <= 10) return 'rounds-6-10';
    if (value <= 15) return 'rounds-11-15';
    if (value <= 20) return 'rounds-16-20';
    return 'rounds-21-plus';
}

function resultBucket(session: TowerSession): 'win' | 'wipe' | 'timeout' {
    if (session.winner === 'squad') return 'win';
    const timedOut = session.winner === 'draw' || session.log.some(line =>
        line.includes('Round limit reached') || line.includes('resolution stalled'));
    return timedOut ? 'timeout' : 'wipe';
}

export function towerTelemetrySource(session: TowerSession, event: 'started' | 'settled'): string {
    const common = `${mode(session)}:${contentBucket(session)}:${partyBucket(session)}`;
    return event === 'started'
        ? common
        : `${common}:${resultBucket(session)}:${roundsBucket(session.round)}`;
}

async function recordOnce(
    event: 'tower.run_started' | 'tower.run_settled',
    session: TowerSession,
    deps: TowerTelemetryDeps,
): Promise<boolean> {
    const store = deps.kv ?? realKv;
    const suffix = event === 'tower.run_started' ? 'started' : 'settled';
    try {
        const gate = await store.set(`tower:telemetry:${suffix}:${session.runId}`, '1', { nx: true, ex: TOWER_TELEMETRY_TTL });
        if (gate !== 'OK') return false;
        const input: BetaMetricInput = {
            event,
            source: towerTelemetrySource(session, suffix),
        };
        // Aggregate-only and best-effort. The recorder itself catches storage
        // failures; never await telemetry behind a gameplay response.
        (deps.record ?? ((value) => { void recordBetaMetric(value); }))(input);
        return true;
    } catch {
        return false;
    }
}

export function recordTowerRunStarted(session: TowerSession, deps: TowerTelemetryDeps = {}): Promise<boolean> {
    return recordOnce('tower.run_started', session, deps);
}

export function recordTowerRunSettled(session: TowerSession, deps: TowerTelemetryDeps = {}): Promise<boolean> {
    return recordOnce('tower.run_settled', session, deps);
}
