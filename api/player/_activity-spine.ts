import type { ActivityHorizon, ActivitySpine, ActivitySpineItem } from '../../shared/activity-spine.js';

export type ActivitySpineInput = {
    now: number;
    level: number;
    hospitalized: boolean;
    onboardingStep: string;
    unspentStats: number;
    trainingIdle: boolean;
    jutsuTrainingIdle: boolean;
    hasJutsu: boolean;
    hasProfession: boolean;
    profession: string;
    clanName: string;
    lastLoginRewardDate: string;
    clanBoss?: {
        active: boolean;
        killed: boolean;
        attemptsLeft: number;
        partyStatus?: string;
        pressure?: number;
        sectorName?: string;
    };
};

function item(horizon: ActivityHorizon, value: Omit<ActivitySpineItem, 'horizon'>): ActivitySpineItem {
    return { horizon, ...value };
}

function daysSinceDate(date: string, now: number): number {
    const parsed = Date.parse(`${date}T00:00:00.000Z`);
    return Number.isFinite(parsed) ? Math.floor((now - parsed) / 86_400_000) : 0;
}

export function buildActivitySpine(input: ActivitySpineInput): ActivitySpine {
    const returningPlayer = daysSinceDate(input.lastLoginRewardDate, input.now) >= 7;
    const now: ActivitySpineItem[] = [];
    const today: ActivitySpineItem[] = [];
    const week: ActivitySpineItem[] = [];
    const longTerm: ActivitySpineItem[] = [];

    if (input.hospitalized) {
        now.push(item('now', {
            id: 'recover-hospital', title: 'Recover before deploying',
            why: 'Hospitalization blocks combat activities, so clear it before committing to a squad.',
            commitment: '1–2 min', screen: 'hospital', cta: 'Open Hospital', eligibility: 'eligible', context: 'recovery',
        }));
    } else if (input.onboardingStep && input.onboardingStep !== 'done') {
        now.push(item('now', {
            id: 'continue-academy', title: 'Continue your Academy path',
            why: 'This unlocks the core training, mission, loadout, and world loops in a safe order.',
            commitment: '5–10 min', screen: 'logbook', cta: 'Open Logbook', eligibility: 'eligible', context: 'onboarding',
        }));
    } else if (input.clanBoss?.partyStatus === 'active' || input.clanBoss?.partyStatus === 'starting') {
        now.push(item('now', {
            id: 'resume-clan-operation', title: 'Rejoin your Clan Boss operation',
            why: 'Your accepted squad has an operation in progress; your place is preserved across refreshes.',
            commitment: '10–20 min', screen: 'clan', cta: 'Rejoin Operation', eligibility: 'eligible', context: 'clan-boss',
        }));
    } else if (returningPlayer) {
        now.push(item('now', {
            id: 'returner-check-in', title: 'Take a two-minute shinobi check-in',
            why: 'Review your loadout, unspent growth, and current weekly threat before choosing a longer activity.',
            commitment: '2 min', screen: 'profile', cta: 'Review Profile', eligibility: 'eligible', context: 'recovery',
        }));
    } else if (input.unspentStats > 0) {
        now.push(item('now', {
            id: 'spend-growth', title: `Spend ${input.unspentStats} growth point${input.unspentStats === 1 ? '' : 's'}`,
            why: 'Banked growth only helps after it is assigned to your build.',
            commitment: '2 min', screen: 'profile', cta: 'Tune Build', eligibility: 'eligible', context: 'progression',
        }));
    } else {
        now.push(item('now', {
            id: 'mission-now', title: 'Run a level-appropriate mission',
            why: 'Missions are the reliable short-session source of growth, ryo, and hunt materials.',
            commitment: '5–10 min', screen: 'missions', cta: 'Open Missions', eligibility: 'eligible', context: 'progression',
        }));
    }

    today.push(item('today', {
        id: 'daily-training', title: input.trainingIdle ? 'Start stat training' : 'Keep training in motion',
        why: input.trainingIdle ? 'Idle training time is lost long-term growth.' : 'Your current session is already advancing your build.',
        commitment: input.trainingIdle ? '1 min setup' : 'Already running', screen: 'training', cta: 'Open Training',
        eligibility: input.trainingIdle ? 'eligible' : 'complete', reward: 'Stat growth', context: 'progression',
    }));
    today.push(item('today', {
        id: 'daily-jutsu', title: input.hasJutsu ? (input.jutsuTrainingIdle ? 'Train a jutsu' : 'Jutsu training underway') : 'Learn your first jutsu',
        why: 'A reliable technique loadout gives every combat activity more tactical options.',
        commitment: input.jutsuTrainingIdle ? '1 min setup' : 'Already running', screen: 'jutsuTraining', cta: 'Open Jutsu Training',
        eligibility: input.jutsuTrainingIdle || !input.hasJutsu ? 'eligible' : 'complete', reward: 'Technique mastery', context: 'progression',
    }));
    today.push(item('today', {
        id: 'prepare-supplies', title: 'Turn hunt materials into field supplies',
        why: 'The Crafter converts existing hunt drops into pills, smoke bombs, and potions consumed authoritatively in operations.',
        commitment: '3–5 min', screen: 'centralHub', cta: 'Visit the Crafter', eligibility: input.level >= 5 ? 'eligible' : 'blocked',
        blocker: input.level >= 5 ? undefined : 'Reach level 5 to make preparation worthwhile.', reward: 'Operation supplies', context: 'economy',
    }));

    if (input.clanBoss?.active) {
        const blocked = !input.clanName || input.hospitalized || input.clanBoss.attemptsLeft <= 0 || input.clanBoss.killed;
        week.push(item('this-week', {
            id: 'weekly-clan-operation',
            title: input.clanBoss.killed ? 'Clan Boss threat contained' : `Push back the threat at ${input.clanBoss.sectorName ?? 'the operation sector'}`,
            why: `A real 1–4 player clan squad chips the weekly boss and reduces shared sector pressure${typeof input.clanBoss.pressure === 'number' ? `, now ${input.clanBoss.pressure}%` : ''}.`,
            commitment: '10–20 min', screen: 'clan', cta: input.clanBoss.partyStatus ? 'Open Party' : 'Form Operation Party',
            eligibility: input.clanBoss.killed ? 'complete' : blocked ? 'blocked' : 'eligible',
            blocker: !input.clanName ? 'Join a clan first.' : input.hospitalized ? 'Recover before deploying.' : input.clanBoss.attemptsLeft <= 0 ? 'Weekly assaults used.' : undefined,
            reward: 'Clan progress, contribution rewards, profession XP', context: 'clan-boss',
        }));
    } else {
        week.push(item('this-week', {
            id: 'weekly-world', title: 'Choose a weekly world objective',
            why: 'Tower, ranked, clan, and world activities provide longer-session goals after daily progress is secured.',
            commitment: '20–40 min', screen: input.level >= 30 ? 'centralHub' : 'worldMap', cta: 'Review Activities', eligibility: 'eligible', context: 'progression',
        }));
    }
    week.push(item('this-week', {
        id: 'weekly-ranked', title: 'Set a ranked season target',
        why: 'Ranked uses the existing PvP rules and turns combat skill into seasonal standing and durable battle history.',
        commitment: '10â€“20 min', screen: 'battleArena', cta: 'Open Ranked PvP',
        eligibility: input.level >= 15 ? 'eligible' : 'blocked',
        blocker: input.level >= 15 ? undefined : 'Reach level 15 and finish your Academy foundation first.',
        reward: 'Season standing and competitive record', context: 'progression',
    }));
    week.push(item('this-week', {
        id: 'weekly-profession',
        title: input.hasProfession ? `Advance your ${input.profession} practice` : 'Choose a profession path',
        why: 'Healer, Vanguard, and Pet Tamer progress turns combat and support play into a distinct long-term identity.',
        commitment: '10â€“25 min', screen: input.hasProfession ? 'professions' : 'professionPicker',
        cta: input.hasProfession ? 'Review Profession' : 'Choose Profession',
        eligibility: input.hasProfession || input.level >= 13 ? 'eligible' : 'blocked',
        blocker: input.hasProfession || input.level >= 13 ? undefined : 'Professions unlock at level 13.',
        reward: 'Profession XP and role capability', context: 'economy',
    }));
    week.push(item('this-week', {
        id: 'weekly-solo',
        title: input.level >= 30 ? 'Climb a Tower on your own schedule' : 'Build strength through missions and hunts',
        why: input.level >= 30
            ? 'Tower progression remains a meaningful low-population alternative when a live party is unavailable.'
            : 'Missions and hunts grow your character and supply the preparation economy without requiring a queue.',
        commitment: '15â€“30 min', screen: input.level >= 30 ? 'battleTowers' : 'missions',
        cta: input.level >= 30 ? 'Review Towers' : 'Open Missions', eligibility: 'eligible',
        reward: input.level >= 30 ? 'Tower progress and build mastery' : 'Growth, ryo, and hunt materials', context: 'progression',
    }));

    longTerm.push(item('long-term', {
        id: 'long-level-band',
        title: input.level >= 100 ? 'Refine an endgame mastery path' : input.level < 15 ? 'Graduate from the Academy' : input.level < 30 ? 'Build a complete combat identity' : input.level < 50 ? 'Establish your clan and profession role' : input.level < 80 ? 'Master high-rank operations' : 'Prepare for the level cap',
        why: input.level >= 100 ? 'At cap, mastery comes from execution, collection, professions, social goals, and seasonal records.' : 'This is the next durable milestone for your current level band.',
        commitment: 'Multi-session', screen: input.level < 15 ? 'logbook' : input.hasProfession ? 'professions' : 'professionPicker',
        cta: input.level < 15 ? 'Open Logbook' : input.hasProfession ? 'Review Mastery' : 'Choose Profession',
        eligibility: input.level >= 13 || input.level < 15 ? 'eligible' : 'blocked',
        blocker: input.level >= 13 || input.level < 15 ? undefined : 'Reach level 13 to choose a profession.', context: 'progression',
    }));
    longTerm.push(item('long-term', {
        id: 'long-spire', title: 'Build toward the Endless Spire',
        why: 'The Spire tests complete builds and tactical consistency without changing ranked PvP balance.',
        commitment: 'Multi-session', screen: 'battleTowers', cta: 'Review Towers',
        eligibility: input.level >= 30 ? 'eligible' : 'blocked', blocker: input.level >= 30 ? undefined : 'Reach level 30 and keep developing your loadout.',
        context: 'progression',
    }));

    return { generatedAt: input.now, returningPlayer, horizons: { now, today, 'this-week': week, 'long-term': longTerm } };
}
