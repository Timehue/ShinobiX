"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.storyKeyFor = void 0;
exports.emptyStoryRecord = emptyStoryRecord;
exports.bumpLanes = bumpLanes;
const storyKeyFor = (player) => `story:${player}`;
exports.storyKeyFor = storyKeyFor;
const laneNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
function emptyStoryRecord(village) {
    return { village, interludes: {}, roadEvents: {}, lanes: { good: 0, neutral: 0, bad: 0 } };
}
/** Fresh lane tally with `lane` incremented (tolerates missing/partial lanes). */
function bumpLanes(lanes, lane) {
    const next = { good: laneNum(lanes?.good), neutral: laneNum(lanes?.neutral), bad: laneNum(lanes?.bad) };
    next[lane] += 1;
    return next;
}
