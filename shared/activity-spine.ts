export const ACTIVITY_HORIZONS = ['now', 'today', 'this-week', 'long-term'] as const;
export type ActivityHorizon = typeof ACTIVITY_HORIZONS[number];
export type ActivityEligibility = 'eligible' | 'blocked' | 'complete';

export const MASTERY_FOCUS_OPTIONS = [
    { id: 'auto', label: 'Auto' },
    { id: 'village-chronicle', label: 'Village Chronicle' },
    { id: 'ranked-pvp', label: 'Ranked PvP' },
    { id: 'clan-war', label: 'Clan and War' },
    { id: 'towers-spire', label: 'Towers and Spire' },
    { id: 'companions', label: 'Companions' },
    { id: 'chronicle-showdown', label: 'Chronicle Showdown' },
    { id: 'legacy', label: 'Legacy' },
    { id: 'profession', label: 'Profession' },
] as const;

export type MasteryFocus = typeof MASTERY_FOCUS_OPTIONS[number]['id'];
const MASTERY_FOCUS_IDS = new Set<string>(MASTERY_FOCUS_OPTIONS.map((option) => option.id));

export function normalizeMasteryFocus(value: unknown): MasteryFocus {
    return typeof value === 'string' && MASTERY_FOCUS_IDS.has(value)
        ? value as MasteryFocus
        : 'auto';
}

export type ActivitySpineItem = {
    id: string;
    horizon: ActivityHorizon;
    title: string;
    why: string;
    commitment: string;
    screen: string;
    cta: string;
    /** Eligibility of this CTA, not necessarily of the eventual goal it prepares. */
    eligibility: ActivityEligibility;
    /** Prerequisite guidance may accompany an eligible remediation CTA. */
    blocker?: string;
    reward?: string;
    progress?: string;
    /** Exact executable combat mode when the recommendation enters one. */
    runtimeModeId?: string;
    /** Standalone or narrower public gate in addition to the mode registry gate. */
    capabilityId?: import('./public-capabilities.js').PublicCapabilityId;
    /** False only for navigation that cannot admit a progress-changing action. */
    requiresMutation?: boolean;
    /**
     * Exact server-projected admission gates for this response item. The client
     * treats a missing or empty projection as unavailable instead of importing
     * the complete runtime registry into the browser.
     */
    requiredCapabilityIds?: readonly import('./public-capabilities.js').PublicCapabilityId[];
    /** Existing state remains visible for recovery, but cannot admit new actions. */
    recoveryOnly?: boolean;
    context?: 'clan-boss' | 'onboarding' | 'recovery' | 'progression' | 'economy'
        | 'story' | 'pvp' | 'clan-war' | 'towers' | 'companions' | 'chronicle' | 'legacy' | 'profession';
};

export type ActivitySpine = {
    generatedAt: number;
    returningPlayer: boolean;
    selectedFocus: MasteryFocus;
    resolvedFocus: Exclude<MasteryFocus, 'auto'>;
    horizons: Record<ActivityHorizon, ActivitySpineItem[]>;
};
