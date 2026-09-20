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
import { STORY_TOWER_MIN_LEVEL } from '../towers/_story-eligibility.js';
import { LEGACY_MIN_LEVEL } from '../_legacy-defs.js';
import { PROFESSION_CHANGE_LEVEL as PROFESSION_UNLOCK_LEVEL } from '../../shared/profession-change.js';
import { STARTER_CARDS_MIN_LEVEL } from '../card-clash/_starter-cards.js';
import { MAIN_DECK_SIZE } from '../../shared/chronicle-duel.js';

type Focus = Exclude<MasteryFocus, 'auto'>;
export type FocusFacts = {
    story: { completed: number; total: number; nextLevel: number | null; nextEligible: boolean; known?: boolean };
    ranked: { rating: number; wins: number; ready?: boolean; blocker?: string };
    towers: { bestFloor: number; bestWave: number; spireTier: number; nextFloor?: number; complete?: boolean; entryAffordable?: boolean; entryCost?: number; available?: boolean };
    companions: { count: number; activeName: string; activeLevel: number; expeditionActive: boolean; ladderRating: number; usableCount?: number; available?: boolean; familiar?: boolean; showdownLessonCompleted?: boolean; dailyArenaWins?: number; arenaCapReached?: boolean };
    chronicle: { deckCards: number; collectionCards: number; wins: number; deckValid?: boolean; unlocked?: boolean };
    legacy: { accepted: boolean; stage: number; trialReady?: boolean; objective?: { stat: string; progress: number; target: number } };
    profession: { selected: boolean; label: string; rank: number; xp: number };
    prestige: { level: number; specialJoninPassed: boolean; pvpKills: number };
    supplies?: { craftable: boolean };
};

export type ActivitySpineInput = {
    capabilities: PublicCapabilities;
    now: number;
    level: number;
    hospitalized: boolean;
    onboardingStep: string;
    unspentStats: number;
    trainingIdle: boolean;
    statTrainingReady?: boolean;
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
    story: { completed: 0, total: 0, nextLevel: null, nextEligible: false, known: false },
    ranked: { rating: 1000, wins: 0 },
    towers: { bestFloor: 0, bestWave: 0, spireTier: 0 },
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
        supplies: input.facts?.supplies,
    };
}

export function autoFocus(input: ActivitySpineInput, facts: FocusFacts): Focus {
    const clanBossAvailable = serviceAvailability(input, { runtimeModeId: 'clan-boss' }).available;
    const legacyAvailable = serviceAvailability(input, { capabilityId: 'legacy' }).available;
    if (clanBossAvailable && input.clanName && input.clanBoss?.active && !input.clanBoss.killed && input.clanBoss.attemptsLeft > 0) return 'clan-war';
    if (facts.story.known !== false && facts.story.completed < facts.story.total) return 'village-chronicle';
    if (input.level >= STORY_TOWER_MIN_LEVEL && facts.towers.available && facts.towers.nextFloor && facts.towers.entryAffordable) return 'towers-spire';
    if (facts.companions.available && (facts.companions.usableCount ?? 0) > 0) return 'companions';
    if (facts.chronicle.unlocked && facts.chronicle.deckValid) return 'chronicle-showdown';
    if (legacyAvailable && facts.legacy.accepted && facts.legacy.stage < 5) return 'legacy';
    return 'profession';
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

/** One deterministic next step. Readiness belongs to the eventual action;
 * preparation remains usable, and never performs that action on navigation. */
function focusNow(input: ActivitySpineInput, focus: Focus, facts: FocusFacts): ActivitySpineItem {
    const review = (id: string, title: string, why: string, screen: string, cta: string,
        extra: Partial<ActivitySpineItem> = {}) => item('now', {
        id, title, why, screen, cta, commitment: '2–5 min', eligibility: 'eligible', ...extra,
    });
    const progressToward = (goal: string, level: number, context: ActivitySpineItem['context']) => review(
        `prepare-${focus}`, input.trainingIdle ? `Train toward ${goal}` : `Review growth toward ${goal}`,
        input.trainingIdle ? `Stat training develops the stat pool that determines your level, bringing ${goal} closer.`
            : `Your stat session is already running. Review the remaining requirement for ${goal}.`,
        input.trainingIdle ? 'training' : 'logbook', input.trainingIdle ? 'Open Training' : 'Review Progress',
        { context, blocker: `Reach level ${level}.`, progress: `Level ${input.level}/${level}`, capabilityId: 'gameplayMutations', readiness: input.trainingIdle ? 'preparable' : 'waiting' });

    switch (focus) {
        case 'village-chronicle': {
            const story = facts.story;
            const progress = story.known === false ? 'Chapter readiness has not been verified' : `${story.completed}/${story.total} chapters complete`;
            if (story.known !== false && story.total > 0 && story.completed >= story.total) return review('story-complete-now', 'Review your completed Village Chronicle',
                'Your published village arc is complete. Revisit its recorded chapters and choices.', 'storyHall', 'Review Chronicle', { context: 'story', progress });
            if (story.known !== false && story.nextEligible) return review('story-now', 'Open your next Village Chronicle chapter',
                'The next chapter is available at your level and advances your village story.', 'storyHall', 'Open Story Hall',
                { context: 'story', progress, runtimeModeId: 'story-battles', readiness: 'ready' });
            if (story.known !== false && story.nextLevel) return progressToward('the next Chronicle chapter', story.nextLevel, 'story');
            return review('story-review-now', 'Check your Village Chronicle progress', 'Review your recorded progress before choosing another chapter.', 'logbook', 'Open Logbook', { context: 'story', progress, readiness: 'unknown' });
        }
        case 'ranked-pvp':
            if (input.level < ATTACKABLE_MIN_LEVEL) return progressToward('Ranked PvP entry', ATTACKABLE_MIN_LEVEL, 'pvp');
            return review('ranked-now', facts.ranked.ready ? 'Visit the Ranked PvP queue' : 'Review Ranked PvP availability',
                facts.ranked.ready ? 'The season is accepting entries. The queue will recheck your current state; a match depends on available opponents.'
                    : 'Check the live season and queue status before planning a ranked set. Loadout tuning is optional.',
                'arenaDistrict', facts.ranked.ready ? 'Open Ranked PvP' : 'Review Ranked Queue',
                { context: 'pvp', blocker: facts.ranked.ready ? undefined : facts.ranked.blocker ?? 'Queue readiness has not been verified.',
                    progress: `${facts.ranked.rating} rating • ${facts.ranked.wins} wins`, runtimeModeId: 'ranked-shinobi-pvp' });
        case 'clan-war': {
            const boss = input.clanBoss;
            if (!input.clanName) return review('clan-join-now', 'Explore a clan for cooperative goals',
                'The Clan Hall lets you review clans before deciding whether to join. Solo play remains available.', 'clan', 'Visit Clan Hall',
                { context: 'clan-war', blocker: 'Clan operations require membership.' });
            const ready = boss?.active && !boss.killed && boss.attemptsLeft > 0
                && serviceAvailability(input, { runtimeModeId: 'clan-boss', capabilityId: 'clanBossParties' }).available;
            return ready ? review('clan-operation-now', boss.partyStatus ? 'Return to your clan ready room' : 'Prepare an available clan assault',
                'Review your squad and the current operation before committing an assault.', 'clan', 'Open Clan Operations',
                { context: 'clan-boss', section: 'clan-boss', runtimeModeId: 'clan-boss', capabilityId: 'clanBossParties', progress: `${boss.attemptsLeft} assaults remaining` })
                // The goal it promises is the clan's own objective board, so it
                // opens there instead of wherever the Clan Hall was left.
                : review('clan-review-now', 'Review your clan’s next goal',
                    'Coordinate in the Clan Hall while a new assault is unavailable.', 'clan', 'Open Clan Hall', { context: 'clan-war', section: 'clan-goals',
                        blocker: boss?.killed ? 'This week’s threat is complete.' : boss?.active && boss.attemptsLeft <= 0 ? 'Your weekly assaults are used.' : 'No available clan assault is verified.' });
        }
        case 'towers-spire':
            if (input.level < STORY_TOWER_MIN_LEVEL) return progressToward('Battle Towers', STORY_TOWER_MIN_LEVEL, 'towers');
            return review('towers-now', facts.towers.complete ? 'Review cleared Towers and Spire options' : facts.towers.nextFloor && facts.towers.entryAffordable && facts.towers.available ? 'Prepare your next unlocked Tower floor' : 'Review Tower entry requirements',
                facts.towers.complete ? 'The published Tower floors are cleared. The lobby shows replay and distinct Spire options.'
                    : 'The Tower lobby verifies floor access, entry costs, squad readiness, and daily starts before you begin.',
                'battleTowers', 'Review Tower Lobby', { context: 'towers', runtimeModeId: 'battle-towers',
                    progress: `Best floor ${facts.towers.bestFloor} • Spire tier ${facts.towers.spireTier}`,
                    blocker: facts.towers.available === false ? 'Tower admissions are temporarily unavailable.' : facts.towers.entryAffordable === false ? `The next new floor requires ${facts.towers.entryCost} ryo; cleared floors can be replayed free.` : undefined,
                    readiness: facts.towers.complete ? 'complete' : facts.towers.available === false ? 'unavailable' : facts.towers.entryAffordable === false ? 'preparable' : 'unknown' });
        case 'companions': {
            const rosterReady = facts.companions.available && (facts.companions.usableCount ?? 0) > 0;
            const familiar = facts.companions.familiar === true;
            const arenaCapped = familiar && facts.companions.arenaCapReached === true;
            const ready = rosterReady && !arenaCapped;
            return review('companions-now', rosterReady ? familiar ? arenaCapped ? 'Wait for the companion Coliseum reset' : 'Enter a companion Coliseum bout' : 'Practice with a ready companion' : 'Prepare your carried companion roster',
                rosterReady ? familiar
                    ? arenaCapped
                        ? 'Your carried roster is ready, but the server-recorded daily arena win cap is complete. The Coliseum resets at midnight UTC.'
                        : 'Your recorded companion-battle participation shows you know the basics. The Coliseum rechecks the roster before entry; rewards remain subject to its existing daily rules.'
                    : `${facts.companions.showdownLessonCompleted ? 'You have reviewed the Showdown lesson. ' : ''}Practice lets you try the commands with no XP, ranked progress, or items.`
                    : 'Use the Pet Yard to review carried pets, acquisition, and any training, expedition, or breeding commitments.',
                rosterReady ? familiar ? 'petColiseum' : 'petShowdown' : 'pets', rosterReady ? familiar ? 'Open Pet Coliseum' : 'Open Practice Showdown' : 'Manage Companions',
                { context: 'companions', progress: `${facts.companions.usableCount ?? 'Unverified'} usable carried companions`,
                    blocker: arenaCapped ? 'Daily companion arena wins are complete until midnight UTC.' : rosterReady ? undefined : facts.companions.available === false ? 'Practice Showdown is temporarily unavailable.' : 'A ready carried companion is needed for practice.',
                    readiness: ready ? 'ready' : arenaCapped ? 'waiting' : facts.companions.available === false ? 'unavailable' : 'preparable',
                    ...(ready ? { runtimeModeId: familiar ? 'pet-coliseum' : 'pet-showdown-practice' } : {}) });
        }
        case 'chronicle-showdown': {
            if (facts.chronicle.unlocked === undefined) return review('chronicle-review-now', 'Review Chronicle access and your deck',
                'Card Hall will show your current codex access and saved collection. Duel readiness has not been verified.', 'shinobiTiles', 'Review Card Hall', { context: 'chronicle' });
            if (!facts.chronicle.unlocked) return input.level < STARTER_CARDS_MIN_LEVEL
                ? progressToward('the Chronicle Scribe encounter', STARTER_CARDS_MIN_LEVEL, 'chronicle')
                : review('chronicle-unlock-now', 'Look for the Chronicle Scribe', 'The existing road encounter introduces the codex that opens Chronicle duels.', 'worldMap', 'Explore the World Map', { context: 'chronicle', blocker: 'The traveler’s codex has not been claimed.' });
            return review('chronicle-now', facts.chronicle.deckValid ? 'Prepare a Chronicle Showdown duel' : 'Repair your Chronicle deck',
                facts.chronicle.deckValid ? 'Your saved deck satisfies the current card and owned-copy rules. Choose a duel in the Card Hall.'
                    : 'Review the deck validator and your owned collection before selecting a duel.', 'shinobiTiles', facts.chronicle.deckValid ? 'Choose a Duel' : 'Edit Deck',
                { context: 'chronicle', section: facts.chronicle.deckValid ? 'card-play' : 'card-deck', progress: `${facts.chronicle.deckCards} cards selected`,
                    blocker: facts.chronicle.deckValid ? undefined : 'The saved deck has not passed the current size, card, and owned-copy rules.',
                    readiness: facts.chronicle.deckValid ? 'ready' : 'preparable',
                    ...(facts.chronicle.deckValid ? { runtimeModeId: 'card-clash-freeplay' } : {}) });
        }
        case 'legacy': {
            if (!facts.legacy.accepted && input.level < LEGACY_MIN_LEVEL) return progressToward('Legacy eligibility', LEGACY_MIN_LEVEL, 'legacy');
            const complete = facts.legacy.stage >= 5;
            const objective = facts.legacy.objective;
            // A revealed mission-count objective is directly actionable. Other
            // objectives keep their actual trial UI, without guessing a source.
            if (objective?.stat === 'missionCompletions') return review('legacy-mission-now', 'Run a mission for your active Legacy trial',
                'This accepted trial counts new mission completions from its sealed starting point.', 'missions', 'Open Missions',
                { context: 'legacy', capabilityId: 'legacy', progress: `${objective.progress}/${objective.target} mission completions`, runtimeModeId: input.level < 15 ? 'combat-missions-ed' : 'combat-missions-cbas' });
            return review('legacy-now', complete ? 'Review your completed Legacy' : facts.legacy.trialReady ? 'Review your finished Legacy trial' : facts.legacy.accepted ? 'Review your active Legacy trial' : 'Review Legacy eligibility and offers',
                complete ? 'Your accepted path has reached its final stage.' : facts.legacy.accepted ? 'The Legacy panel shows the revealed objective and its verified progress for your accepted path.' : 'Review the requirements and any revealed offer before making a permanent choice.',
                'profile', 'Open Legacy', { context: 'legacy', section: 'legacy', capabilityId: 'legacy', progress: facts.legacy.accepted ? `Stage ${facts.legacy.stage}/5` : 'No Legacy accepted' });
        }
        case 'profession':
            if (input.level < PROFESSION_UNLOCK_LEVEL) return progressToward('profession selection', PROFESSION_UNLOCK_LEVEL, 'profession');
            return review('profession-now', facts.profession.selected ? `Review your ${facts.profession.label} opportunities` : 'Compare profession paths',
                facts.profession.selected ? 'Your profession hub lists current role actions, rank and mastery. Check resource costs and cooldowns there before choosing an action.' : 'Compare the existing roles and their activities before choosing one.',
                facts.profession.selected ? 'professions' : 'professionPicker', facts.profession.selected ? 'Open Profession Hub' : 'Compare Professions',
                { context: 'profession', progress: facts.profession.selected ? `Rank ${facts.profession.rank} • ${facts.profession.xp} profession XP` : 'No profession selected' });
    }
}

function focusRecommendations(input: ActivitySpineInput, focus: Focus, facts: FocusFacts): [ActivitySpineItem, ActivitySpineItem] {
    if (focus === 'village-chronicle') {
        if (facts.story.known === false) return [
            item('this-week', { id: 'focus-story-week', title: 'Review Village Chronicle availability', why: 'The saved chapter or village could not be verified. Review your recorded progress before planning a chapter.', commitment: 'Review', screen: 'logbook', cta: 'Review Story Guidance', eligibility: 'eligible', context: 'story', progress: 'Chapter readiness unverified' }),
            item('long-term', { id: 'focus-story-long', title: 'Review your recorded story milestones', why: 'Your Logbook explains the Chronicle path without assuming an unrevealed chapter is available.', commitment: 'Review', screen: 'logbook', cta: 'Open Logbook', eligibility: 'eligible', context: 'story', progress: 'Chapter readiness unverified' }),
        ];
        const complete = facts.story.total > 0 && facts.story.completed >= facts.story.total;
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
                why: complete ? 'Completed chapters remain part of your identity and can be reviewed without changing their outcome.' : 'Completing the published arc is a personal milestone; other activities remain optional.',
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
        const blocker = blocked ? `Reach level ${ATTACKABLE_MIN_LEVEL} before entering ranked battles.` : facts.ranked.ready ? undefined : facts.ranked.blocker ?? 'Check live queue availability first.';
        const nextRating = Math.max(1200, Math.ceil((facts.ranked.rating + 1) / 200) * 200);
        const prestige = optionalPrestigeLongTerm(facts);
        return [
            item('this-week', {
                id: 'focus-ranked-week', title: facts.ranked.ready ? 'Plan a Ranked PvP set' : 'Review the Ranked PvP season',
                why: 'A short set turns ordinary PvP execution into season standing and a durable competitive record.',
                commitment: '10–20 min', progress: `${facts.ranked.rating} rating • ${facts.ranked.wins} ranked wins`,
                screen: 'arenaDistrict', cta: 'Open Ranked PvP', eligibility: 'eligible', blocker, context: 'pvp', runtimeModeId: 'ranked-shinobi-pvp',
            }),
            prestige ?? item('long-term', {
                id: 'focus-ranked-long', title: `Climb toward ${nextRating} rating`,
                why: 'A nearby rating milestone gives your season a clear target without making Ranked mandatory.',
                commitment: 'Multi-session', progress: `${facts.ranked.rating}/${nextRating} rating`,
                screen: 'arenaDistrict', cta: 'Review Ranked Standing', eligibility: 'eligible', blocker, context: 'pvp', runtimeModeId: 'ranked-shinobi-pvp',
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
            screen: 'clan', cta: noClan ? 'Visit Clan Hall' : 'Review Clan Goals', eligibility: 'eligible', blocker: noClan ? 'Clan operations require membership.' : undefined, context: 'clan-war',
            // Without a clan the Hall's own entry view is the one that lists
            // clans to join; a member asked to review goals gets the goals.
            ...(noClan ? {} : { section: 'clan-goals' as const }),
        });
        if (noClan || weeklyBlocked || !serviceAvailability(input, { runtimeModeId: 'clan-boss', capabilityId: 'clanBossParties' }).available) {
            return [
                item('this-week', {
                    id: 'focus-clan-generic-week',
                    title: noClan ? 'Choose a clan path' : 'Coordinate your clan’s next goal',
                    why: 'Clan membership, chat, leadership, and ordinary clan wars remain available independently of Clan Boss operations.',
                    commitment: '5–15 min', progress: noClan ? 'No clan selected' : 'Clan membership active',
                    screen: 'clan', cta: noClan ? 'Visit Clan Hall' : 'Open Clan Hall', eligibility: 'eligible',
                    blocker: noClan ? 'Clan operations require membership.' : killed ? 'Weekly threat cleared.' : weeklyBlocker, context: 'clan-war',
                    ...(noClan ? {} : { section: 'clan-goals' as const }),
                }),
                prestige ?? genericLong,
            ];
        }
        return [
            item('this-week', {
                id: 'focus-clan-week', title: killed ? 'Clan Boss threat contained' : 'Support your clan operation',
                why: 'Clan operations connect squad play, profession contribution, and shared weekly progress.',
                commitment: '10–20 min', progress: killed ? 'Weekly threat cleared' : boss?.active ? `${boss.attemptsLeft} assault${boss.attemptsLeft === 1 ? '' : 's'} available${typeof boss.pressure === 'number' ? ` • ${boss.pressure}% sector pressure` : ''}` : 'Waiting for the next operation',
                screen: 'clan', cta: killed ? 'Review Clan Result' : 'Open Clan Operations', eligibility: killed ? 'complete' : weeklyBlocked ? 'blocked' : 'eligible', blocker: weeklyBlocker, context: 'clan-boss', runtimeModeId: 'clan-boss', capabilityId: 'clanBossParties',
            }),
            prestige ?? genericLong,
        ];
    }

    if (focus === 'towers-spire') {
        const blocked = input.level < STORY_TOWER_MIN_LEVEL;
        const blocker = blocked ? `Reach level ${STORY_TOWER_MIN_LEVEL} and keep developing your loadout.` : undefined;
        return [
            item('this-week', {
                id: 'focus-towers-week', title: facts.towers.complete ? 'Review cleared Battle Towers' : 'Plan an unlocked Battle Tower challenge',
                why: 'Tower floors test squad construction and tactical consistency on your own schedule.',
                commitment: '15–30 min', progress: `Best floor ${facts.towers.bestFloor} • Endless wave ${facts.towers.bestWave}`,
                screen: 'battleTowers', cta: 'Review Towers', eligibility: blocked ? 'blocked' : 'eligible', blocker, context: 'towers', runtimeModeId: 'battle-towers',
            }),
            item('long-term', {
                id: 'focus-towers-long', title: 'Review your Spire progression',
                why: 'The Endless Spire is a durable mastery track for complete builds and repeatable tactical goals.',
                commitment: 'Multi-session', progress: `Highest Spire tier ${facts.towers.spireTier}`,
                screen: 'battleTowers', cta: 'Open Towers and Spire', eligibility: blocked ? 'blocked' : 'eligible', blocker, context: 'towers', runtimeModeId: 'endless-spire',
            }),
        ];
    }

    if (focus === 'companions') {
        const noCompanion = facts.companions.count === 0;
        // The authoritative carried roster and mode-specific busy predicate
        // establish readiness; total ownership never proves availability.
        const showdownBlocked = !facts.companions.available || !(facts.companions.usableCount && facts.companions.usableCount > 0);
        const blocker = noCompanion
            ? 'Choose a companion at the Pet Yard first.'
            : showdownBlocked ? 'Review your carried roster and outstanding companion commitments.' : undefined;
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
        const blocked = !facts.chronicle.deckValid || !facts.chronicle.unlocked;
        const blocker = blocked ? 'Review codex access and a legal deck from your owned collection.' : undefined;
        return [
            item('this-week', {
                id: 'focus-chronicle-week', title: blocked ? 'Complete your Chronicle deck' : 'Play a Chronicle Showdown set',
                why: 'Deck construction and duel decisions form their own strategy game with a durable collection record.',
                commitment: '10–20 min', progress: `${facts.chronicle.deckCards}/${MAIN_DECK_SIZE} deck cards • ${facts.chronicle.wins} duel wins`,
                screen: 'shinobiTiles', section: blocked ? 'card-deck' : 'card-play', cta: blocked ? 'Review Card Hall' : 'Open Chronicle Showdown', eligibility: 'eligible', blocker, context: 'chronicle',
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
        const levelBlocked = input.level < LEGACY_MIN_LEVEL;
        const complete = facts.legacy.stage >= 5;
        const blocker = levelBlocked ? `Reach level ${LEGACY_MIN_LEVEL} before seeking a Legacy.` : undefined;
        return [
            item('this-week', {
                id: 'focus-legacy-week', title: complete ? 'Review your completed Legacy' : facts.legacy.accepted ? 'Advance your active Legacy trial' : 'Seek a Legacy path',
                why: complete ? 'Your completed path remains part of the Hall of Legends record.' : 'Legacy trials turn existing play into a long-term identity path without replacing normal progression.',
                commitment: complete ? '5 min' : '15–30 min', progress: facts.legacy.accepted ? `Legacy stage ${facts.legacy.stage}/5` : 'No Legacy accepted',
                screen: 'profile', section: 'legacy', cta: complete ? 'Review Legacy' : 'Open Legacy', eligibility: complete ? 'complete' : 'eligible', blocker, context: 'legacy', capabilityId: 'legacy',
            }),
            item('long-term', {
                id: 'focus-legacy-long', title: complete ? 'Carry your Legacy title' : facts.legacy.accepted ? 'Complete your accepted Legacy path' : 'Explore a Legacy path',
                why: complete ? 'Your summit is permanent history; your Legacy remains available for reflection and records.' : facts.legacy.accepted ? 'Each server-verified trial advances the same accepted path toward its final distinction.' : 'The Legacy panel explains eligibility and revealed offers before you choose a path.',
                commitment: 'Multi-session', progress: facts.legacy.accepted ? `Legacy stage ${facts.legacy.stage}/5` : 'No Legacy accepted',
                screen: 'profile', section: 'legacy', cta: 'Review Legacy Journey', eligibility: complete ? 'complete' : 'eligible', blocker, context: 'legacy', capabilityId: 'legacy',
            }),
        ];
    }

    const blocked = input.level < PROFESSION_UNLOCK_LEVEL;
    const blocker = blocked ? `Professions unlock at level ${PROFESSION_UNLOCK_LEVEL}.` : undefined;
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
            screen: selected ? 'professions' : 'professionPicker', cta: selected ? 'Review Profession Hub' : 'Compare Professions', eligibility: blocked ? 'blocked' : 'eligible', blocker, context: 'profession',
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
    if (selectedFocus !== 'auto') {
        // A service pause or blocked prerequisite must not silently replace a
        // focus the player deliberately saved. Its CTAs are gated below; only
        // the immediate card may offer an explicitly optional alternative.
        return { resolvedFocus: selectedFocus, recommendations: focusRecommendations(input, selectedFocus, facts) };
    }
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

/** Save-projected, deterministic alternatives only. Ranked, clan queues and
 * other domains that need extra IO are deliberately absent: unknown readiness
 * is never promoted to a promise. Evaluation is bounded to three candidates. */
function immediateForFocus(input: ActivitySpineInput, focus: Focus, facts: FocusFacts): ActivitySpineItem {
    const preferred = focusNow(input, focus, facts);
    if (preferred.readiness !== 'waiting') return preferred;
    for (const alternativeFocus of ['towers-spire', 'companions', 'chronicle-showdown'] as const) {
        if (alternativeFocus === focus) continue;
        const candidate = focusNow(input, alternativeFocus, facts);
        if (candidate.readiness !== 'ready' || !activityServiceAvailable(input, candidate)) continue;
        return {
            ...candidate,
            id: `optional-${focus}-${candidate.id}`,
            title: `Meanwhile: ${candidate.title}`,
            why: `${preferred.why} This is an optional available activity while that requirement progresses.`,
            optionalAlternative: true,
        };
    }
    return preferred;
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
    } else if (input.statTrainingReady) {
        now.push(item('now', {
            id: 'claim-stat-training', title: 'Stat training is ready to claim',
            why: 'Collect the finished session before starting another.',
            commitment: '1 min', screen: 'training', cta: 'Collect Training', eligibility: 'eligible',
            context: 'progression', capabilityId: 'gameplayMutations',
        }));
    } else if (input.unspentStats > 0) {
        now.push(item('now', {
            id: 'spend-growth', title: `Spend ${input.unspentStats} growth point${input.unspentStats === 1 ? '' : 's'}`,
            why: 'Banked growth only helps after it is assigned to your build.',
            commitment: '2 min', screen: 'profile', section: 'stats', cta: 'Tune Build', eligibility: 'eligible', context: 'progression',
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
        const immediate = immediateForFocus(input, resolvedFocus, facts);
        now.push(activityServiceAvailable(input, immediate) ? immediate : item('now', {
            id: 'service-review-now', title: 'Review your current shinobi plan',
            why: 'New gameplay actions are paused, but your saved build and progress remain available to review.',
            commitment: '2 min', screen: 'profile', cta: 'Review Profile', eligibility: 'eligible', context: 'recovery',
            requiresMutation: false,
        }));
    }

    const todayCandidates = [item('today', {
        id: 'daily-training', title: input.statTrainingReady ? 'Stat training is ready to claim' : input.trainingIdle ? 'Start stat training' : 'Keep training in motion',
        why: input.statTrainingReady ? 'Collect the finished session before starting another.' : input.trainingIdle ? 'An optional training session develops your stats toward future requirements.' : 'Your current session is already advancing your build.',
        commitment: input.statTrainingReady ? '1 min' : input.trainingIdle ? '1 min setup' : 'Already running', screen: 'training',
        cta: input.statTrainingReady ? 'Collect Training' : 'Open Training',
        eligibility: input.statTrainingReady || input.trainingIdle ? 'eligible' : 'complete', reward: 'Stat growth', context: 'progression', capabilityId: 'gameplayMutations',
    }), item('today', {
        id: 'daily-jutsu', title: input.hasJutsu ? (input.jutsuTrainingIdle ? 'Train a jutsu' : 'Jutsu training underway') : 'Learn your first jutsu',
        why: 'A reliable technique loadout gives every combat activity more tactical options.',
        commitment: input.jutsuTrainingIdle ? '1 min setup' : 'Already running', screen: 'jutsuTraining', cta: 'Open Jutsu Training',
        eligibility: input.jutsuTrainingIdle || !input.hasJutsu ? 'eligible' : 'complete', reward: 'Technique mastery', context: 'progression', capabilityId: 'gameplayMutations',
    }), item('today', {
        id: 'prepare-supplies', title: facts.supplies?.craftable ? 'Prepare an optional smoke bomb' : 'Review field supply recipes',
        why: facts.supplies?.craftable ? 'Your owned materials cover one smoke bomb recipe. Review what the Crafter will consume before deciding to craft.' : 'Browse the Crafter’s real recipes and material costs before planning supplies.',
        commitment: '3–5 min', screen: 'centralHub', section: 'crafter', cta: 'Review Recipes', eligibility: 'eligible',
        context: 'economy', capabilityId: 'gameplayMutations',
    })];
    today.push(...todayCandidates.filter((activity) =>
        !(now[0]?.screen === activity.screen && now[0]?.section === activity.section) && activityServiceAvailable(input, activity)));

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
