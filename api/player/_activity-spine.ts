import {
    normalizeMasteryFocus,
    type ActivityHorizon,
    type ActivitySpine,
    type ActivitySpineItem,
    type MasteryFocus,
} from '../../shared/activity-spine.js';
import type { PublicCapabilities } from '../../shared/public-capabilities.js';
import {
    runtimeModeCapabilityAvailability,
    type RuntimeModeCapabilityRequirement,
} from '../../shared/runtime-mode-capabilities.js';
import { ATTACKABLE_MIN_LEVEL } from '../_realtime/presence-gating.js';

type Focus = Exclude<MasteryFocus, 'auto'>;
type FocusFacts = {
    story: { completed: number; total: number; nextLevel: number | null; nextEligible: boolean };
    ranked: { rating: number; wins: number };
    towers: { bestFloor: number; bestWave: number; spireTier: number; activeRun: boolean };
    companions: { count: number; activeName: string; activeLevel: number; expeditionActive: boolean; ladderRating: number };
    chronicle: { deckCards: number; collectionCards: number; wins: number };
    legacy: { accepted: boolean; stage: number };
    profession: { selected: boolean; label: string; rank: number; xp: number };
    prestige: { level: number; specialJoninPassed: boolean; pvpKills: number };
};

export type ActivitySpineInput = {
    capabilities: PublicCapabilities;
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
    focus?: unknown;
    progressionHold?: { exam: string; level: number } | null;
    resume?: { title: string; screen: string; runtimeModeId: string; context?: 'clan-boss' | 'towers' } | null;
    facts?: Partial<FocusFacts>;
    clanBoss?: {
        active: boolean;
        killed: boolean;
        attemptsLeft: number;
        partyStatus?: string;
        pressure?: number;
        sectorName?: string;
    };
};

const DEFAULT_FACTS: FocusFacts = {
    story: { completed: 0, total: 9, nextLevel: 4, nextEligible: true },
    ranked: { rating: 1000, wins: 0 },
    towers: { bestFloor: 0, bestWave: 0, spireTier: 0, activeRun: false },
    companions: { count: 0, activeName: '', activeLevel: 0, expeditionActive: false, ladderRating: 1000 },
    chronicle: { deckCards: 0, collectionCards: 0, wins: 0 },
    legacy: { accepted: false, stage: 0 },
    profession: { selected: false, label: '', rank: 0, xp: 0 },
    prestige: { level: 1, specialJoninPassed: false, pvpKills: 0 },
};

function item(horizon: ActivityHorizon, value: Omit<ActivitySpineItem, 'horizon'>): ActivitySpineItem {
    return { horizon, ...value };
}

function serviceAvailability(input: ActivitySpineInput, requirement: RuntimeModeCapabilityRequirement) {
    return runtimeModeCapabilityAvailability(input.capabilities, requirement);
}

function activityServiceAvailable(input: ActivitySpineInput, activity: ActivitySpineItem): boolean {
    return serviceAvailability(input, activity).available;
}

function availabilityBlocker(
    availability: ReturnType<typeof runtimeModeCapabilityAvailability>,
): string | undefined {
    if (availability.available) return undefined;
    if (availability.reason === 'maintenance') return 'This activity is temporarily unavailable during maintenance.';
    if (availability.reason === 'operations-paused') return 'New activity actions are temporarily paused.';
    if (availability.reason === 'configuration-unavailable') return 'This activity is not available in the current server configuration.';
    return 'This activity is temporarily unavailable.';
}

function serviceBlocker(input: ActivitySpineInput, requirement: RuntimeModeCapabilityRequirement): string | undefined {
    return availabilityBlocker(serviceAvailability(input, requirement));
}

function applyServiceGate(input: ActivitySpineInput, activity: ActivitySpineItem): ActivitySpineItem {
    const availability = serviceAvailability(input, activity);
    const requiredCapabilityIds = availability.capabilityIds;
    const blocker = availabilityBlocker(availability);
    if (!blocker) return { ...activity, requiredCapabilityIds };
    return {
        ...activity,
        requiredCapabilityIds,
        eligibility: 'blocked',
        blocker,
    };
}

function daysSinceDate(date: string, now: number): number {
    const parsed = Date.parse(`${date}T00:00:00.000Z`);
    return Number.isFinite(parsed) ? Math.floor((now - parsed) / 86_400_000) : 0;
}

function focusFacts(input: ActivitySpineInput): FocusFacts {
    return {
        story: { ...DEFAULT_FACTS.story, ...input.facts?.story },
        ranked: { ...DEFAULT_FACTS.ranked, ...input.facts?.ranked },
        towers: { ...DEFAULT_FACTS.towers, ...input.facts?.towers },
        companions: { ...DEFAULT_FACTS.companions, ...input.facts?.companions },
        chronicle: { ...DEFAULT_FACTS.chronicle, ...input.facts?.chronicle },
        legacy: { ...DEFAULT_FACTS.legacy, ...input.facts?.legacy },
        profession: { ...DEFAULT_FACTS.profession, ...input.facts?.profession },
        prestige: { ...DEFAULT_FACTS.prestige, ...input.facts?.prestige },
    };
}

function autoFocus(input: ActivitySpineInput, facts: FocusFacts): Focus {
    const clanBossAvailable = serviceAvailability(input, { runtimeModeId: 'clan-boss' }).available;
    const legacyAvailable = serviceAvailability(input, { capabilityId: 'legacy' }).available;
    if (clanBossAvailable && input.clanName && input.clanBoss?.active && !input.clanBoss.killed && input.clanBoss.attemptsLeft > 0) return 'clan-war';
    if (facts.story.completed < facts.story.total) return 'village-chronicle';
    if (input.level >= 30 && (facts.towers.bestFloor < 25 || facts.towers.spireTier < 5)) return 'towers-spire';
    if (facts.companions.count > 0 && facts.companions.activeLevel < 100) return 'companions';
    if (facts.chronicle.deckCards >= 40 && facts.chronicle.wins < 25) return 'chronicle-showdown';
    if (legacyAvailable && input.level >= 50 && (!facts.legacy.accepted || facts.legacy.stage < 5)) return 'legacy';
    if (input.level >= 80 && !facts.prestige.specialJoninPassed) return 'ranked-pvp';
    if (facts.profession.selected) return 'profession';
    return input.level >= 15 ? 'ranked-pvp' : 'profession';
}

function optionalPrestigeLongTerm(facts: FocusFacts): ActivitySpineItem | null {
    if (facts.prestige.level < 80 || facts.prestige.specialJoninPassed) return null;
    return item('long-term', {
        id: 'focus-special-jonin-prestige',
        title: 'Pursue the Special Jonin distinction',
        why: 'This optional PvP and leadership ceremony recognizes prestige; it does not block leveling, stats, jutsu, or content.',
        commitment: 'Multi-session', progress: `${Math.min(100, facts.prestige.pvpKills)}/100 PvP kills; Kage or Elder standing is verified at ceremony`,
        screen: 'logbook', cta: 'Review Optional Prestige', eligibility: 'eligible', context: 'pvp',
    });
}

function focusRecommendations(input: ActivitySpineInput, focus: Focus, facts: FocusFacts): [ActivitySpineItem, ActivitySpineItem] {
    if (focus === 'village-chronicle') {
        const complete = facts.story.completed >= facts.story.total;
        const blocked = !complete && !facts.story.nextEligible;
        const blocker = blocked && facts.story.nextLevel ? `Reach level ${facts.story.nextLevel} for the next Chronicle milestone.` : undefined;
        return [
            item('this-week', {
                id: 'focus-story-week', title: complete ? 'Revisit your Village Chronicle' : 'Advance your Village Chronicle',
                why: complete ? 'Your village arc is complete, and the Story Hall keeps its chapters and choices available.' : 'Your next eligible chapter advances your personal village story without revealing what waits ahead.',
                commitment: complete ? '5 min' : '15–25 min', progress: `${Math.min(facts.story.completed, facts.story.total)} of ${facts.story.total} chapters complete`,
                screen: 'storyHall', cta: complete ? 'Review Chronicle' : 'Open Story Hall', eligibility: complete ? 'complete' : blocked ? 'blocked' : 'eligible', blocker, context: 'story',
                ...(complete ? {} : { runtimeModeId: 'story-battles' }),
            }),
            item('long-term', {
                id: 'focus-story-long', title: complete ? 'Carry your Chronicle choices forward' : 'Complete your Village Chronicle',
                why: complete ? 'Completed chapters remain part of your identity and can be reviewed without changing their outcome.' : 'The full nine-chapter arc is a durable personal milestone, not a mandatory content gate.',
                commitment: 'Multi-session', progress: `${Math.min(facts.story.completed, facts.story.total)}/${facts.story.total} chapters`,
                screen: 'storyHall', cta: 'View Chronicle Progress', eligibility: complete ? 'complete' : blocked ? 'blocked' : 'eligible', blocker, context: 'story',
            }),
        ];
    }

    if (focus === 'ranked-pvp') {
        // The ranked queue admits at the attackable floor (api/pvp/ranked-queue.ts
        // gates on isBelowAttackableFloor, level 10). This used to say 15 — the
        // Academy threshold that governs guard duty and being CHALLENGED — so
        // levels 10–14 were told Ranked was blocked while the queue would have
        // taken them. The eligibility fact AND the blocker text come from the
        // shared constant, so guidance can never again name a threshold the
        // queue does not enforce (the queue's own refusal uses the same number).
        const blocked = input.level < ATTACKABLE_MIN_LEVEL;
        const blocker = blocked ? `Reach level ${ATTACKABLE_MIN_LEVEL} before entering ranked battles.` : undefined;
        const nextRating = Math.max(1200, Math.ceil((facts.ranked.rating + 1) / 200) * 200);
        const prestige = optionalPrestigeLongTerm(facts);
        return [
            item('this-week', {
                id: 'focus-ranked-week', title: 'Play a focused Ranked PvP set',
                why: 'A short set turns ordinary PvP execution into season standing and a durable competitive record.',
                commitment: '10–20 min', progress: `${facts.ranked.rating} rating • ${facts.ranked.wins} ranked wins`,
                screen: 'battleArena', cta: 'Open Ranked PvP', eligibility: blocked ? 'blocked' : 'eligible', blocker, context: 'pvp', runtimeModeId: 'ranked-shinobi-pvp',
            }),
            prestige ?? item('long-term', {
                id: 'focus-ranked-long', title: `Climb toward ${nextRating} rating`,
                why: 'A nearby rating milestone gives your season a clear target without making Ranked mandatory.',
                commitment: 'Multi-session', progress: `${facts.ranked.rating}/${nextRating} rating`,
                screen: 'battleArena', cta: 'Review Ranked Standing', eligibility: blocked ? 'blocked' : 'eligible', blocker, context: 'pvp', runtimeModeId: 'ranked-shinobi-pvp',
            }),
        ];
    }

    if (focus === 'clan-war') {
        const noClan = !input.clanName;
        const boss = input.clanBoss;
        const killed = Boolean(boss?.killed);
        const weeklyBlocked = noClan || !boss?.active || killed || (boss?.attemptsLeft ?? 0) <= 0;
        const weeklyBlocker = noClan ? 'Join or found a clan first.' : !boss?.active ? 'No Clan Boss operation is active this week.' : killed ? undefined : (boss?.attemptsLeft ?? 0) <= 0 ? 'Weekly assaults used.' : undefined;
        const prestige = optionalPrestigeLongTerm(facts);
        const genericLong = item('long-term', {
            id: 'focus-clan-long', title: noClan ? 'Find your clan role' : 'Build a lasting clan and war record',
            why: noClan ? 'Founding or joining a clan opens cooperative goals without changing solo progression.' : 'Contribution, leadership, and war records provide a social endgame alongside solo mastery.',
            commitment: 'Multi-session', progress: noClan ? 'No clan selected' : 'Clan membership active',
            screen: 'clan', cta: noClan ? 'Visit Clan Hall' : 'Review Clan Goals', eligibility: noClan ? 'blocked' : 'eligible', blocker: noClan ? 'Join or found a clan first.' : undefined, context: 'clan-war',
        });
        if (!serviceAvailability(input, { runtimeModeId: 'clan-boss' }).available) {
            return [
                item('this-week', {
                    id: 'focus-clan-generic-week',
                    title: noClan ? 'Choose a clan path' : 'Coordinate your clan’s next goal',
                    why: 'Clan membership, chat, leadership, and ordinary clan wars remain available independently of Clan Boss operations.',
                    commitment: '5–15 min', progress: noClan ? 'No clan selected' : 'Clan membership active',
                    screen: 'clan', cta: noClan ? 'Visit Clan Hall' : 'Open Clan Hall', eligibility: noClan ? 'blocked' : 'eligible',
                    blocker: noClan ? 'Join or found a clan first.' : undefined, context: 'clan-war',
                }),
                prestige ?? genericLong,
            ];
        }
        return [
            item('this-week', {
                id: 'focus-clan-week', title: killed ? 'Clan Boss threat contained' : 'Support your clan operation',
                why: 'Clan operations connect squad play, profession contribution, and shared weekly progress.',
                commitment: '10–20 min', progress: killed ? 'Weekly threat cleared' : boss?.active ? `${boss.attemptsLeft} assault${boss.attemptsLeft === 1 ? '' : 's'} available${typeof boss.pressure === 'number' ? ` • ${boss.pressure}% sector pressure` : ''}` : 'Waiting for the next operation',
                screen: 'clan', cta: killed ? 'Review Clan Result' : 'Open Clan Operations', eligibility: killed ? 'complete' : weeklyBlocked ? 'blocked' : 'eligible', blocker: weeklyBlocker, context: 'clan-boss', runtimeModeId: 'clan-boss',
            }),
            prestige ?? genericLong,
        ];
    }

    if (focus === 'towers-spire') {
        const blocked = input.level < 30;
        const blocker = blocked ? 'Reach level 30 and keep developing your loadout.' : undefined;
        return [
            item('this-week', {
                id: 'focus-towers-week', title: facts.towers.activeRun ? 'Resume your Tower run' : `Challenge Battle Tower floor ${facts.towers.bestFloor + 1}`,
                why: 'Tower floors test squad construction and tactical consistency on your own schedule.',
                commitment: '15–30 min', progress: `Best floor ${facts.towers.bestFloor} • Endless wave ${facts.towers.bestWave}`,
                screen: 'battleTowers', cta: facts.towers.activeRun ? 'Resume Run' : 'Review Towers', eligibility: blocked ? 'blocked' : 'eligible', blocker, context: 'towers', runtimeModeId: 'battle-towers',
            }),
            item('long-term', {
                id: 'focus-towers-long', title: `Climb toward Spire tier ${facts.towers.spireTier + 1}`,
                why: 'The Endless Spire is a durable mastery track for complete builds and repeatable tactical goals.',
                commitment: 'Multi-session', progress: `Highest Spire tier ${facts.towers.spireTier}`,
                screen: 'battleTowers', cta: 'Open Towers and Spire', eligibility: blocked ? 'blocked' : 'eligible', blocker, context: 'towers', runtimeModeId: 'endless-spire',
            }),
        ];
    }

    if (focus === 'companions') {
        const noCompanion = facts.companions.count === 0;
        // Showdown fields the roster that is actually home. A lone companion out
        // on an expedition leaves nothing to enter with; a second one covers for
        // it, so the gate is roster size against the one known absence rather
        // than the expedition flag alone.
        const onlyOneAway = facts.companions.count === 1 && facts.companions.expeditionActive;
        const showdownBlocked = noCompanion || onlyOneAway;
        const blocker = noCompanion
            ? 'Choose a companion at the Pet Yard first.'
            : onlyOneAway ? `${facts.companions.activeName || 'Your companion'} is away on an expedition.` : undefined;
        const active = facts.companions.activeName || 'Active companion';
        return [
            item('this-week', {
                id: 'focus-companion-week', title: noCompanion ? 'Choose your first companion' : 'Fight a Pet Showdown',
                why: 'Showdown is the companion battle in full: elements, stamina, and one signature per pet decide a turn-based duel your roster wins on its own merits.',
                commitment: '10–20 min', progress: noCompanion ? 'No companion active' : `${active} • level ${facts.companions.activeLevel} • ${facts.companions.count} companion${facts.companions.count === 1 ? '' : 's'} on the roster${facts.companions.expeditionActive ? ' • one away on expedition' : ''}`,
                // The Showdown remains blocked without a home roster, but the
                // recommendation's CTA is the exact prerequisite-remediation
                // destination. Keep that navigation eligible and do not label it
                // as a Showdown runtime admission until a roster is actually ready.
                screen: showdownBlocked ? 'pets' : 'petShowdown', cta: showdownBlocked ? 'Visit Pet Yard' : 'Enter the Showdown',
                eligibility: 'eligible', blocker, context: 'companions',
                ...(showdownBlocked ? {} : { runtimeModeId: 'pet-showdown-practice' }),
            }),
            item('long-term', {
                id: 'focus-companion-long', title: 'Grow your companion arena record',
                why: 'Pet Ladder and Gauntlet progress offer an ongoing companion goal without replacing your shinobi path.',
                commitment: 'Multi-session', progress: `${facts.companions.count} companion${facts.companions.count === 1 ? '' : 's'} • ${facts.companions.ladderRating} ladder rating`,
                screen: 'petLadder', cta: 'Review Pet Ladder', eligibility: showdownBlocked ? 'blocked' : 'eligible', blocker, context: 'companions', runtimeModeId: 'pet-ladder-showdown',
            }),
        ];
    }

    if (focus === 'chronicle-showdown') {
        const blocked = facts.chronicle.deckCards < 40;
        const blocker = blocked ? `Build a valid 40-card Chronicle deck (${facts.chronicle.deckCards}/40 selected).` : undefined;
        return [
            item('this-week', {
                id: 'focus-chronicle-week', title: blocked ? 'Complete your Chronicle deck' : 'Play a Chronicle Showdown set',
                why: 'Deck construction and duel decisions form their own strategy game with a durable collection record.',
                commitment: '10–20 min', progress: `${facts.chronicle.deckCards}/40 deck cards • ${facts.chronicle.wins} duel wins`,
                screen: 'shinobiTiles', cta: blocked ? 'Open Card Hall' : 'Open Chronicle Showdown', eligibility: blocked ? 'blocked' : 'eligible', blocker, context: 'chronicle',
                ...(blocked ? {} : { runtimeModeId: 'card-clash-freeplay' }),
            }),
            item('long-term', {
                id: 'focus-chronicle-long', title: 'Deepen your Chronicle collection',
                why: 'A broader collection creates more legal deck choices without changing ordinary combat power.',
                commitment: 'Multi-session', progress: `${facts.chronicle.collectionCards} cards collected • ${facts.chronicle.wins} wins`,
                screen: 'shinobiTiles', cta: 'Review Collection', eligibility: 'eligible', context: 'chronicle',
            }),
        ];
    }

    if (focus === 'legacy') {
        const levelBlocked = input.level < 50;
        const complete = facts.legacy.stage >= 5;
        const blocker = levelBlocked ? 'Reach level 50 before seeking a Legacy.' : undefined;
        return [
            item('this-week', {
                id: 'focus-legacy-week', title: complete ? 'Review your completed Legacy' : facts.legacy.accepted ? 'Advance your active Legacy trial' : 'Seek a Legacy path',
                why: complete ? 'Your completed path remains part of the Hall of Legends record.' : 'Legacy trials turn existing play into a long-term identity path without replacing normal progression.',
                commitment: complete ? '5 min' : '15–30 min', progress: facts.legacy.accepted ? `Legacy stage ${facts.legacy.stage}/5` : 'No Legacy accepted',
                screen: 'hallOfLegends', cta: complete ? 'Review Legacy' : 'Open Hall of Legends', eligibility: complete ? 'complete' : levelBlocked ? 'blocked' : 'eligible', blocker, context: 'legacy', capabilityId: 'legacy',
            }),
            item('long-term', {
                id: 'focus-legacy-long', title: complete ? 'Carry your Legacy title' : 'Complete all five Legacy stages',
                why: complete ? 'Your summit is permanent history; the Hall remains available for reflection and records.' : 'Each server-verified trial advances the same accepted path toward its final distinction.',
                commitment: 'Multi-session', progress: `${facts.legacy.stage}/5 stages complete`,
                screen: 'hallOfLegends', cta: 'Review Legacy Journey', eligibility: complete ? 'complete' : levelBlocked ? 'blocked' : 'eligible', blocker, context: 'legacy', capabilityId: 'legacy',
            }),
        ];
    }

    const blocked = input.level < 13;
    const blocker = blocked ? 'Professions unlock at level 13.' : undefined;
    const selected = facts.profession.selected || input.hasProfession;
    const label = facts.profession.label || input.profession || 'profession';
    return [
        item('this-week', {
            id: 'focus-profession-week', title: selected ? `Advance your ${label} practice` : 'Choose a profession path',
            why: 'Profession activity turns support and combat play into a distinct long-term role without changing basic combat rules.',
            commitment: '10–25 min', progress: selected ? `Rank ${facts.profession.rank} • ${facts.profession.xp} profession XP` : 'No profession selected',
            screen: selected ? 'professions' : 'professionPicker', cta: selected ? 'Review Profession' : 'Choose Profession', eligibility: blocked ? 'blocked' : 'eligible', blocker, context: 'profession',
        }),
        item('long-term', {
            id: 'focus-profession-long', title: selected ? `Refine ${label} mastery` : 'Build a durable role identity',
            why: 'Rank and mastery investments make your chosen role a multi-session identity goal.',
            commitment: 'Multi-session', progress: selected ? `Profession rank ${facts.profession.rank}` : 'Profession choice pending',
            screen: selected ? 'professions' : 'professionPicker', cta: selected ? 'Open Mastery' : 'Compare Professions', eligibility: blocked ? 'blocked' : 'eligible', blocker, context: 'profession',
        }),
    ];
}

const FOCUS_FALLBACK_ORDER: readonly Focus[] = [
    'village-chronicle',
    'towers-spire',
    'companions',
    'chronicle-showdown',
    'clan-war',
    'ranked-pvp',
    'profession',
    'legacy',
];

function resolveFocusRecommendations(
    input: ActivitySpineInput,
    selectedFocus: MasteryFocus,
    facts: FocusFacts,
): { resolvedFocus: Focus; recommendations: [ActivitySpineItem, ActivitySpineItem] } {
    const automatic = autoFocus(input, facts);
    const candidates = selectedFocus === 'auto'
        ? [automatic, ...FOCUS_FALLBACK_ORDER]
        : [selectedFocus, automatic, ...FOCUS_FALLBACK_ORDER];
    for (const focus of [...new Set(candidates)] as Focus[]) {
        const recommendations = focusRecommendations(input, focus, facts);
        if (recommendations.every((activity) => activityServiceAvailable(input, activity))) {
            return { resolvedFocus: focus, recommendations };
        }
    }
    // Do not recommend an unavailable activity. During an unsafe-HTTP action
    // pause the loaded character record and logbook remain useful read-only
    // destinations, so the deterministic fallback contains no admission CTA.
    return {
        resolvedFocus: automatic,
        recommendations: [
            item('this-week', {
                id: 'focus-service-review-week',
                title: 'Review your current shinobi path',
                why: 'New activity actions are paused, but your saved build and completed milestones remain available to review.',
                commitment: '5 min', screen: 'profile', cta: 'Review Profile', eligibility: 'eligible',
                context: 'recovery', requiresMutation: false,
            }),
            item('long-term', {
                id: 'focus-service-review-long',
                title: 'Review your lasting record',
                why: 'Your completed chapters, ranks, and long-term goals remain visible while new activity admissions are paused.',
                commitment: 'Review only', screen: 'logbook', cta: 'Review Logbook', eligibility: 'eligible',
                context: 'progression', requiresMutation: false,
            }),
        ],
    };
}

export function buildActivitySpine(input: ActivitySpineInput): ActivitySpine {
    const returningPlayer = daysSinceDate(input.lastLoginRewardDate, input.now) >= 7;
    const selectedFocus = normalizeMasteryFocus(input.focus);
    const facts = focusFacts(input);
    const { resolvedFocus, recommendations: [week, longTerm] } = resolveFocusRecommendations(input, selectedFocus, facts);
    const now: ActivitySpineItem[] = [];
    const today: ActivitySpineItem[] = [];

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
        const requirement = { runtimeModeId: 'clan-boss', capabilityId: 'clanBossParties' } as const;
        const blocker = serviceBlocker(input, requirement);
        now.push(item('now', {
            id: 'resume-clan-operation', title: blocker ? 'Clan Boss operation preserved for recovery' : 'Rejoin your Clan Boss operation',
            why: blocker
                ? 'Your accepted squad record remains visible, but no new operation actions are admitted until service availability returns.'
                : 'Your accepted squad has an operation in progress; your place is preserved across refreshes.',
            commitment: blocker ? 'Recovery only' : '10–20 min', screen: 'clan', cta: blocker ? 'Await Service Recovery' : 'Rejoin Operation',
            eligibility: blocker ? 'blocked' : 'eligible', blocker, recoveryOnly: !!blocker, context: 'clan-boss', ...requirement,
        }));
    } else if (input.resume) {
        const requirement = { runtimeModeId: input.resume.runtimeModeId } as const;
        const blocker = serviceBlocker(input, requirement);
        now.push(item('now', {
            id: 'resume-active-run', title: blocker ? `${input.resume.title} — recovery preserved` : input.resume.title,
            why: blocker
                ? 'The run remains recorded for recovery, but no new actions are admitted until service availability returns.'
                : 'A resumable run is already in progress, so return to it before starting another long activity.',
            commitment: blocker ? 'Recovery only' : 'Resume now', screen: input.resume.screen,
            cta: blocker ? 'Await Service Recovery' : 'Resume Run', eligibility: blocker ? 'blocked' : 'eligible', blocker,
            recoveryOnly: !!blocker, context: input.resume.context ?? 'towers', ...requirement,
        }));
    } else if (input.unspentStats > 0) {
        now.push(item('now', {
            id: 'spend-growth', title: `Spend ${input.unspentStats} growth point${input.unspentStats === 1 ? '' : 's'}`,
            why: 'Banked growth only helps after it is assigned to your build.',
            commitment: '2 min', screen: 'profile', cta: 'Tune Build', eligibility: 'eligible', context: 'progression',
        }));
    } else if (input.progressionHold) {
        const label = input.progressionHold.exam === 'genin'
            ? 'Genin Advancement Exam'
            : 'Chunin Advancement Exam';
        now.push(item('now', {
            id: `progression-hold-${input.progressionHold.exam}`, title: `Clear the ${label} level hold`,
            why: `This is a real level-${input.progressionHold.level} progression hold; other rank distinctions remain optional.`,
            commitment: 'Multi-step', screen: 'logbook', cta: 'Review Rank Exam', eligibility: 'eligible', context: 'progression',
        }));
    } else if (returningPlayer) {
        now.push(item('now', {
            id: 'returner-check-in', title: 'Take a two-minute shinobi check-in',
            why: 'Review your loadout, unspent growth, and current weekly threat before choosing a longer activity.',
            commitment: '2 min', screen: 'profile', cta: 'Review Profile', eligibility: 'eligible', context: 'recovery',
        }));
    } else {
        const mission = item('now', {
            id: 'mission-now', title: 'Run a level-appropriate mission',
            why: 'Missions are the reliable short-session source of growth, ryo, and hunt materials.',
            commitment: '5–10 min', screen: 'missions', cta: 'Open Missions', eligibility: 'eligible', context: 'progression',
            runtimeModeId: input.level < 15 ? 'combat-missions-ed' : 'combat-missions-cbas',
        });
        now.push(activityServiceAvailable(input, mission) ? mission : item('now', {
            id: 'service-review-now', title: 'Review your current shinobi plan',
            why: 'New gameplay actions are paused, but your saved build and progress remain available to review.',
            commitment: '2 min', screen: 'profile', cta: 'Review Profile', eligibility: 'eligible', context: 'recovery',
            requiresMutation: false,
        }));
    }

    const todayCandidates = [item('today', {
        id: 'daily-training', title: input.trainingIdle ? 'Start stat training' : 'Keep training in motion',
        why: input.trainingIdle ? 'Idle training time is lost long-term growth.' : 'Your current session is already advancing your build.',
        commitment: input.trainingIdle ? '1 min setup' : 'Already running', screen: 'training', cta: 'Open Training',
        eligibility: input.trainingIdle ? 'eligible' : 'complete', reward: 'Stat growth', context: 'progression', capabilityId: 'gameplayMutations',
    }), item('today', {
        id: 'daily-jutsu', title: input.hasJutsu ? (input.jutsuTrainingIdle ? 'Train a jutsu' : 'Jutsu training underway') : 'Learn your first jutsu',
        why: 'A reliable technique loadout gives every combat activity more tactical options.',
        commitment: input.jutsuTrainingIdle ? '1 min setup' : 'Already running', screen: 'jutsuTraining', cta: 'Open Jutsu Training',
        eligibility: input.jutsuTrainingIdle || !input.hasJutsu ? 'eligible' : 'complete', reward: 'Technique mastery', context: 'progression', capabilityId: 'gameplayMutations',
    }), item('today', {
        id: 'prepare-supplies', title: 'Turn hunt materials into field supplies',
        why: 'The Crafter converts existing hunt drops into pills, smoke bombs, and potions consumed authoritatively in operations.',
        commitment: '3–5 min', screen: 'centralHub', cta: 'Visit the Crafter', eligibility: input.level >= 5 ? 'eligible' : 'blocked',
        blocker: input.level >= 5 ? undefined : 'Reach level 5 to make preparation worthwhile.', reward: 'Operation supplies', context: 'economy', capabilityId: 'gameplayMutations',
    })];
    today.push(...todayCandidates.filter((activity) => activityServiceAvailable(input, activity)));
    if (today.length === 0) {
        today.push(item('today', {
            id: 'service-review-today', title: 'Keep today’s plan read-only',
            why: 'New progression and economy actions are paused; no saved training or inventory progress has been removed.',
            commitment: 'Review only', screen: 'profile', cta: 'Review Character', eligibility: 'eligible', context: 'recovery',
            requiresMutation: false,
        }));
    }

    return {
        generatedAt: input.now,
        returningPlayer,
        selectedFocus,
        resolvedFocus,
        horizons: {
            now: now.map((activity) => applyServiceGate(input, activity)),
            today: today.map((activity) => applyServiceGate(input, activity)),
            'this-week': [applyServiceGate(input, week)],
            'long-term': [applyServiceGate(input, longTerm)],
        },
    };
}
