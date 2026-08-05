export const ACTIVITY_HORIZONS = ['now', 'today', 'this-week', 'long-term'] as const;
export type ActivityHorizon = typeof ACTIVITY_HORIZONS[number];
export type ActivityEligibility = 'eligible' | 'blocked' | 'complete';

export type ActivitySpineItem = {
    id: string;
    horizon: ActivityHorizon;
    title: string;
    why: string;
    commitment: string;
    screen: string;
    cta: string;
    eligibility: ActivityEligibility;
    blocker?: string;
    reward?: string;
    context?: 'clan-boss' | 'onboarding' | 'recovery' | 'progression' | 'economy';
};

export type ActivitySpine = {
    generatedAt: number;
    returningPlayer: boolean;
    horizons: Record<ActivityHorizon, ActivitySpineItem[]>;
};

