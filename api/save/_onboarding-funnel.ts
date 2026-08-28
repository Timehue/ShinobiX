import type { BetaFunnelEvent } from '../_beta-funnel.js';

/*
 * Observes onboarding funnel crossings by comparing the previous save to the
 * one being committed.
 *
 * WHY HERE. There is no dedicated endpoint for "equipped a jutsu" or "entered a
 * sector" — those reach the server through the ordinary save write, so the save
 * boundary is the only place the transition is observable at all. Two of the
 * three inputs are nonetheless server-owned: api/save/_state-ownership.ts marks
 * `equipment` and `equippedJutsuIds` as server-clamped (ownership and loadout
 * cap enforced on every save). `currentSector` and `onboardingStep` are
 * client-state, so their counts are an onboarding SHAPE signal rather than an
 * anti-cheat-grade fact — which is the right bar for aggregate beta analytics,
 * and worth remembering before anyone reuses these counts for anything else.
 *
 * This function is pure: it decides WHAT crossed, never records anything. The
 * once-per-player nx gate in api/_beta-funnel.ts is what makes each crossing
 * count once, so a replayed autosave carrying the same transition is harmless.
 */

/**
 * The canonical Academy Path, mirrored from
 * shinobij.client/src/lib/onboarding-step.ts. A test pins this list against
 * that file, so the mirror cannot drift silently.
 */
export const ACADEMY_PATH_STEPS = [
    'academyIntro', 'starter', 'companionIntro', 'training', 'jutsu', 'jutsuLoadout',
    'inventory', 'academySpar', 'cafeteria', 'firstMission', 'logbook', 'sectorReturn', 'done',
] as const;

export type AcademyPathStep = typeof ACADEMY_PATH_STEPS[number];

export interface OnboardingFunnelObservation {
    event: BetaFunnelEvent;
    step?: string;
    level?: number;
    source?: string;
}

export interface OnboardingFunnelInput {
    beforeCharacter: Record<string, unknown> | null | undefined;
    afterCharacter: Record<string, unknown> | null | undefined;
    beforeTopLevel?: Record<string, unknown> | null;
    afterTopLevel?: Record<string, unknown> | null;
}

function canonicalStep(value: unknown): AcademyPathStep | null {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    // Legacy aliases, matching the client's normalizer.
    const alias: Record<string, AcademyPathStep> = {
        spar: 'academySpar',
        tour: 'training',
        storyUnlocked: 'sectorReturn',
    };
    const step = alias[raw] ?? raw;
    return (ACADEMY_PATH_STEPS as readonly string[]).includes(step) ? step as AcademyPathStep : null;
}

function hasEquippedJutsu(character: Record<string, unknown> | null | undefined): boolean {
    const ids = character?.equippedJutsuIds;
    return Array.isArray(ids) && ids.some((id) => typeof id === 'string' && id.trim().length > 0);
}

function hasEquippedItem(character: Record<string, unknown> | null | undefined): boolean {
    const equipment = character?.equipment;
    if (!equipment || typeof equipment !== 'object' || Array.isArray(equipment)) return false;
    return Object.values(equipment as Record<string, unknown>)
        .some((slot) => typeof slot === 'string' ? slot.trim().length > 0 : !!slot);
}

function sectorOf(top: Record<string, unknown> | null | undefined): string | null {
    const value = String(top?.currentSector ?? '').trim();
    return value.length > 0 && value.length <= 64 ? value : null;
}

export function observeOnboardingFunnel(input: OnboardingFunnelInput): OnboardingFunnelObservation[] {
    const { beforeCharacter, afterCharacter } = input;
    if (!afterCharacter) return [];
    const out: OnboardingFunnelObservation[] = [];
    const level = Number(afterCharacter.level);
    const withLevel = Number.isFinite(level) ? { level } : {};

    const before = canonicalStep(beforeCharacter?.onboardingStep);
    const after = canonicalStep(afterCharacter.onboardingStep);

    // An ABSENT step means a pre-onboarding veteran, not a fresh recruit — the
    // client normalizer maps undefined to 'done'. Requiring a real `after` and a
    // change keeps veterans out of the funnel entirely.
    if (after && after !== before) {
        if (after === ACADEMY_PATH_STEPS[0]) out.push({ event: 'academy.started', ...withLevel });
        // Every crossing is a step, including the first and the last, so the
        // step histogram stays complete on its own.
        out.push({ event: 'academy.step.reached', step: after, ...withLevel });
        // Completion only counts for someone who was demonstrably still walking
        // the path; a veteran whose step was never stored cannot reach here.
        if (after === 'done' && before) out.push({ event: 'academy.completed', ...withLevel });
    }

    if (!hasEquippedJutsu(beforeCharacter) && hasEquippedJutsu(afterCharacter)) {
        out.push({ event: 'loadout.first_jutsu_equipped', ...withLevel });
    }
    if (!hasEquippedItem(beforeCharacter) && hasEquippedItem(afterCharacter)) {
        out.push({ event: 'loadout.first_item_equipped', ...withLevel });
    }

    const beforeSector = sectorOf(input.beforeTopLevel);
    const afterSector = sectorOf(input.afterTopLevel);
    if (!beforeSector && afterSector) out.push({ event: 'sector.first_entered', ...withLevel });

    return out;
}
