/*
 * Timed boost events — an admin switches on "2× training for 6 hours" and every
 * player gets it until it ends on its own.
 *
 * Shared by the server (api/_boost-event.ts reads it where gains are sealed)
 * and the client (the event banner and the Training preview). Keep this module
 * dependency-free so both sides can import it.
 *
 * What each target multiplies, server-side only:
 *   training — the stat gain SEALED when a training session starts. A session
 *              started during the event keeps its boost even if it finishes
 *              after the event ends; one started before does not gain it.
 *   growth   — stat points from the daily mission checklist and from casual
 *              PvP wins, as its own factor after the aggregate bonus cap.
 *   jutsu    — jutsu lesson SPEED: lesson time is divided by the multiplier
 *              (still floored by the lesson engine's own minimum).
 */

export const BOOST_TARGETS = ['training', 'growth', 'jutsu'] as const;
export type BoostTarget = typeof BOOST_TARGETS[number];

export const BOOST_TARGET_INFO: Record<BoostTarget, { label: string; detail: string }> = {
    training: { label: 'Training gains', detail: 'Stat gain from training sessions started during the event.' },
    growth: { label: 'Battle & mission growth', detail: 'Stat points from the daily mission checklist and casual PvP wins.' },
    jutsu: { label: 'Jutsu lesson speed', detail: 'Jutsu lessons started during the event finish faster.' },
};

/** The multipliers an admin can pick. Capped at 2×: a 3× training seal on top
 *  of the largest existing bonuses would exceed the sealed-gain sanity ceiling
 *  (api/training/_session.ts MAX_SEALED_STAT_GAIN). */
export const BOOST_MULTIPLIER_OPTIONS = [1.25, 1.5, 2] as const;
export const BOOST_MAX_MULTIPLIER = 2;
export const BOOST_MIN_HOURS = 1;
export const BOOST_MAX_HOURS = 72;
const HOUR_MS = 60 * 60 * 1000;
const MAX_TITLE_LENGTH = 60;

export interface BoostEvent {
    id: string;
    title: string;
    multiplier: number;
    targets: BoostTarget[];
    startsAt: number;
    endsAt: number;
    startedBy?: string;
}

function isTarget(value: unknown): value is BoostTarget {
    return typeof value === 'string' && (BOOST_TARGETS as readonly string[]).includes(value);
}

/** Parse a stored/transported event; anything malformed becomes null, so a
 *  bad row can never boost anything. */
export function sanitizeBoostEvent(raw: unknown): BoostEvent | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    const multiplier = Number(r.multiplier);
    const startsAt = Number(r.startsAt);
    const endsAt = Number(r.endsAt);
    const targets = Array.isArray(r.targets) ? [...new Set(r.targets.filter(isTarget))] : [];
    if (!Number.isFinite(multiplier) || multiplier <= 1 || multiplier > BOOST_MAX_MULTIPLIER) return null;
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) return null;
    if (!targets.length) return null;
    const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 80) : `boost-${startsAt}`;
    const title = typeof r.title === 'string' ? r.title.trim().slice(0, MAX_TITLE_LENGTH) : '';
    return {
        id,
        title: title || defaultBoostTitle(multiplier, targets),
        multiplier,
        targets,
        startsAt,
        endsAt,
        ...(typeof r.startedBy === 'string' && r.startedBy ? { startedBy: r.startedBy.slice(0, 40) } : {}),
    };
}

export function isBoostEventActive(event: BoostEvent | null | undefined, nowMs: number): event is BoostEvent {
    return !!event && Number.isFinite(nowMs) && nowMs >= event.startsAt && nowMs < event.endsAt;
}

/** The multiplier `target` gets at `nowMs`: the event's, or 1 when there is no
 *  active event covering that target. */
export function boostMultiplierAt(event: BoostEvent | null | undefined, target: BoostTarget, nowMs: number): number {
    if (!isBoostEventActive(event, nowMs) || !event.targets.includes(target)) return 1;
    return Math.min(BOOST_MAX_MULTIPLIER, Math.max(1, event.multiplier));
}

export function formatBoostMultiplier(multiplier: number): string {
    return `${Number(multiplier.toFixed(2))}×`;
}

export function defaultBoostTitle(multiplier: number, targets: readonly BoostTarget[]): string {
    const what = targets.map((t) => BOOST_TARGET_INFO[t].label).join(' + ');
    return `${formatBoostMultiplier(multiplier)} ${what}`;
}

/** Validate an admin's start request into a stored event. Returns an error
 *  string for anything out of range instead of silently clamping it. */
export function buildBoostEvent(input: {
    multiplier: unknown;
    targets: unknown;
    hours: unknown;
    title?: unknown;
    startedBy?: string;
    nowMs: number;
}): { ok: true; event: BoostEvent } | { ok: false; error: string } {
    const multiplier = Number(input.multiplier);
    if (!(BOOST_MULTIPLIER_OPTIONS as readonly number[]).includes(multiplier)) {
        return { ok: false, error: `Multiplier must be one of ${BOOST_MULTIPLIER_OPTIONS.join(', ')}.` };
    }
    const hours = Number(input.hours);
    if (!Number.isFinite(hours) || hours < BOOST_MIN_HOURS || hours > BOOST_MAX_HOURS) {
        return { ok: false, error: `Duration must be between ${BOOST_MIN_HOURS} and ${BOOST_MAX_HOURS} hours.` };
    }
    const rawTargets = Array.isArray(input.targets) ? input.targets : [];
    if (!rawTargets.length || !rawTargets.every(isTarget)) {
        return { ok: false, error: `Pick at least one of: ${BOOST_TARGETS.join(', ')}.` };
    }
    const event = sanitizeBoostEvent({
        id: `boost-${input.nowMs}`,
        title: input.title,
        multiplier,
        targets: rawTargets,
        startsAt: input.nowMs,
        endsAt: input.nowMs + Math.round(hours * HOUR_MS),
        startedBy: input.startedBy,
    });
    return event ? { ok: true, event } : { ok: false, error: 'Invalid boost event.' };
}

/** "5h 12m left" style countdown for the banner and admin panel. */
export function formatBoostTimeLeft(endsAt: number, nowMs: number): string {
    const minutes = Math.max(0, Math.ceil((endsAt - nowMs) / 60_000));
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h <= 0) return `${m}m left`;
    return m ? `${h}h ${m}m left` : `${h}h left`;
}
