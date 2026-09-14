/** Bounded, server-recorded routes for the four personal recovery quests.
 * Authored dialogue stays in the client's lazy story module. These are the
 * places and actions the server can actually accept, with no reward values. */
export type StoryFieldVisit = { pointId: string; choiceId: string };
export type StoryFieldProgress = { version: 1; visits: StoryFieldVisit[] };
export type StoryFieldRecords = Record<string, StoryFieldProgress>;
export type StoryFieldChoice = { nextPointId: string | null; trait?: string };
export type StoryFieldPoint = { sector: number; tile: number; choices: Record<string, StoryFieldChoice> };
export type StoryFieldJourney = { village: string; startPointId: string; points: Record<string, StoryFieldPoint> };

function stop(sector: number, tile: number, choiceId: string, nextPointId: string | null): StoryFieldPoint {
    return { sector, tile, choices: { [choiceId]: { nextPointId } } };
}

export const STORY_FIELD_JOURNEYS: Readonly<Record<string, StoryFieldJourney>> = {
    'story-reckoning-mira-marker': {
        village: 'Stormveil Village', startPointId: 'sv-ridge-gate',
        points: {
            'sv-ridge-gate': { sector: 1, tile: 44, choices: {
                'sv-take-high-line': { nextPointId: 'sv-broken-cable-span', trait: 'sf-sv-high-line' },
                'sv-follow-picker-road': { nextPointId: 'sv-flower-pickers-shelter', trait: 'sf-sv-picker-road' },
            } },
            'sv-broken-cable-span': stop(2, 54, 'sv-broken-cable-span-continue', 'sv-signal-cairn'),
            'sv-signal-cairn': stop(4, 43, 'sv-signal-cairn-recover', null),
            'sv-flower-pickers-shelter': stop(3, 88, 'sv-flower-pickers-shelter-continue', 'sv-rain-split-cairn'),
            'sv-rain-split-cairn': stop(5, 53, 'sv-rain-split-cairn-recover', null),
        },
    },
    'story-reckoning-toma-cinders': {
        village: 'Ashen Leaf Village', startPointId: 'al-ash-line',
        points: {
            'al-ash-line': { sector: 9, tile: 43, choices: {
                'al-repair-first': { nextPointId: 'al-collapsed-footbridge', trait: 'sf-al-repaired-first' },
                'al-follow-cart-first': { nextPointId: 'al-charcoal-yard', trait: 'sf-al-followed-cart' },
            } },
            'al-collapsed-footbridge': stop(10, 54, 'al-collapsed-footbridge-continue', 'al-east-channel-catch'),
            'al-east-channel-catch': stop(12, 88, 'al-east-channel-catch-recover', null),
            'al-charcoal-yard': stop(11, 43, 'al-charcoal-yard-continue', 'al-silted-sluice'),
            'al-silted-sluice': stop(13, 54, 'al-silted-sluice-continue', 'al-bridge-after-dark'),
            'al-bridge-after-dark': stop(10, 54, 'al-bridge-after-dark-finish', null),
        },
    },
    'story-reckoning-sova-true-roll': {
        village: 'Frostfang Village', startPointId: 'ff-gate-stones',
        points: {
            'ff-gate-stones': { sector: 26, tile: 43, choices: {
                'ff-split-lantern-oil': { nextPointId: 'ff-south-watch-post', trait: 'sf-ff-split-lanterns' },
                'ff-keep-lower-stove': { nextPointId: 'ff-lower-road-kitchen', trait: 'sf-ff-kept-stove' },
            } },
            'ff-south-watch-post': stop(27, 54, 'ff-south-watch-post-continue', 'ff-blue-ice-gully'),
            'ff-blue-ice-gully': stop(29, 43, 'ff-blue-ice-gully-recover', null),
            'ff-lower-road-kitchen': stop(28, 88, 'ff-lower-road-kitchen-continue', 'ff-sunlit-drift'),
            'ff-sunlit-drift': stop(30, 54, 'ff-sunlit-drift-recover', null),
        },
    },
    'story-reckoning-nyx-ledger': {
        village: 'Moonshadow Village', startPointId: 'ms-canal-gate',
        points: {
            'ms-canal-gate': { sector: 17, tile: 44, choices: {
                'ms-shield-booth-clerk': { nextPointId: 'ms-dyers-footbridge', trait: 'sf-ms-source-shielded' },
                'ms-post-open-call': { nextPointId: 'ms-night-ferry-landing', trait: 'sf-ms-open-witnesses' },
            } },
            'ms-dyers-footbridge': stop(18, 54, 'ms-dyers-footbridge-continue', 'ms-shuttered-boathouse'),
            'ms-shuttered-boathouse': stop(20, 43, 'ms-shuttered-boathouse-recover', null),
            'ms-night-ferry-landing': stop(19, 88, 'ms-night-ferry-landing-continue', 'ms-old-toll-booth'),
            'ms-old-toll-booth': stop(21, 54, 'ms-old-toll-booth-recover', null),
        },
    },
};

export function storyFieldJourney(questId: string): StoryFieldJourney | null {
    return Object.prototype.hasOwnProperty.call(STORY_FIELD_JOURNEYS, questId) ? STORY_FIELD_JOURNEYS[questId] : null;
}

export function newStoryFieldProgress(): StoryFieldProgress { return { version: 1, visits: [] }; }

/** Validate the complete chain, not just IDs in isolation. An invalid or
 * truncated branch cannot be interpreted as a finished recovery. */
export function parseStoryFieldProgress(questId: string, raw: unknown): StoryFieldProgress | null {
    const journey = storyFieldJourney(questId);
    if (!journey || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    if (value.version !== 1 || !Array.isArray(value.visits) || value.visits.length > 8) return null;
    let nextPointId: string | null = journey.startPointId;
    const visits: StoryFieldVisit[] = [];
    for (const entry of value.visits) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) || nextPointId === null) return null;
        const { pointId, choiceId } = entry as Record<string, unknown>;
        if (pointId !== nextPointId || typeof choiceId !== 'string') return null;
        const point: StoryFieldPoint = journey.points[nextPointId];
        if (!point || !Object.prototype.hasOwnProperty.call(point.choices, choiceId)) return null;
        visits.push({ pointId: nextPointId, choiceId });
        nextPointId = point.choices[choiceId].nextPointId;
    }
    return { version: 1, visits };
}

export function storyFieldPointId(questId: string, progress: StoryFieldProgress): string | null {
    const journey = storyFieldJourney(questId);
    if (!journey) return null;
    const last = progress.visits.at(-1);
    return last ? journey.points[last.pointId].choices[last.choiceId].nextPointId : journey.startPointId;
}

export function parseStoryFieldRecords(raw: unknown): StoryFieldRecords {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const records: StoryFieldRecords = {};
    for (const questId of Object.keys(STORY_FIELD_JOURNEYS)) {
        const progress = parseStoryFieldProgress(questId, (raw as Record<string, unknown>)[questId]);
        if (progress) records[questId] = progress;
    }
    return records;
}

export function storyFieldTraits(raw: unknown): string[] {
    const traits: string[] = [];
    for (const [questId, progress] of Object.entries(parseStoryFieldRecords(raw))) {
        if (storyFieldPointId(questId, progress) !== null) continue;
        const journey = STORY_FIELD_JOURNEYS[questId];
        for (const visit of progress.visits) {
            const trait = journey.points[visit.pointId].choices[visit.choiceId].trait;
            if (trait) traits.push(trait);
        }
    }
    return traits;
}

export type StoryFieldAdvance = { ok: true; progress: StoryFieldProgress; replayed: boolean }
    | { ok: false; reason: 'invalid' | 'choice-locked' | 'out-of-order' | 'wrong-place' | 'traveling' | 'in-battle' };

export function advanceStoryField(
    questId: string, raw: unknown, pointId: string, choiceId: string,
    presence: { sector: number; travelingUntil?: number; inBattle?: boolean } | null,
    now: number,
): StoryFieldAdvance {
    const journey = storyFieldJourney(questId), progress = parseStoryFieldProgress(questId, raw);
    if (!journey || !progress) return { ok: false, reason: 'invalid' };
    const prior = progress.visits.find((visit) => visit.pointId === pointId);
    if (prior) return prior.choiceId === choiceId
        ? { ok: true, progress, replayed: true }
        : { ok: false, reason: 'choice-locked' };
    if (storyFieldPointId(questId, progress) !== pointId) return { ok: false, reason: 'out-of-order' };
    const point = journey.points[pointId];
    if (!Object.prototype.hasOwnProperty.call(point.choices, choiceId)) return { ok: false, reason: 'invalid' };
    if (!presence || presence.sector !== point.sector) return { ok: false, reason: 'wrong-place' };
    if ((presence.travelingUntil ?? 0) > now) return { ok: false, reason: 'traveling' };
    if (presence.inBattle) return { ok: false, reason: 'in-battle' };
    return { ok: true, progress: { version: 1, visits: [...progress.visits, { pointId, choiceId }] }, replayed: false };
}
