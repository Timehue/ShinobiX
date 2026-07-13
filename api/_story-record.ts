/*
 * _story-record — the shared shape of the server-owned story record at
 * KV `story:<player>` (docs/fable-5-story-rebuild.md §10). Written by
 * api/story/interlude.ts and api/story/road-event.ts, both under
 * withKvLock(storyKey). Permanent (no TTL) — this is character history.
 *
 * `lanes` is the running good/neutral/bad tally across BOTH interludes and
 * road events; it later gates path titles, finale dialogue variants, and
 * path Legacies. Writers must spread the existing record so the other
 * endpoint's entries survive (`{ ...record, ... }`).
 */

export type StoryLane = 'good' | 'neutral' | 'bad';

export type StoryRecordEntry = { trait: string; lane: StoryLane; at: number };

export type StoryRecord = {
    village: string;
    interludes: Record<string, StoryRecordEntry>;
    roadEvents?: Record<string, StoryRecordEntry>;
    lanes: { good: number; neutral: number; bad: number };
};

export const storyKeyFor = (player: string) => `story:${player}`;

const laneNum = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function emptyStoryRecord(village: string): StoryRecord {
    return { village, interludes: {}, roadEvents: {}, lanes: { good: 0, neutral: 0, bad: 0 } };
}

/** Fresh lane tally with `lane` incremented (tolerates missing/partial lanes). */
export function bumpLanes(lanes: StoryRecord['lanes'] | undefined, lane: StoryLane): StoryRecord['lanes'] {
    const next = { good: laneNum(lanes?.good), neutral: laneNum(lanes?.neutral), bad: laneNum(lanes?.bad) };
    next[lane] += 1;
    return next;
}
