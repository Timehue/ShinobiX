/*
 * The session-only skip list for auto-triggered story scenes, drained verbatim
 * out of App.tsx's TriggeredVisualNovel `onCancel`.
 *
 * Story beats are never consumed by being READ: a chapter milestone is consumed
 * only by a sealed boss win, an interlude only by a recorded choice. Without a
 * skip list, closing one would simply re-offer it on the very next render. The
 * list is deliberately in-memory (App holds it in a ref, and passes it to
 * lib/story-trigger as `dismissed`), so a refresh re-offers a skipped beat
 * instead of losing it — and its reckoning gate — forever.
 *
 * Only the two auto-triggered story families belong on it: interludes
 * ("story-interlude-…") and chapter milestones ("story-<village>-<level>-<index>").
 * Everything else the reader can show either consumes itself on close or is owned
 * by the screen that opened it.
 */
import { AURA_SPHERE_VN_ID } from "../constants/game";

const DISMISSABLE_STORY_SCENE = /^story-(?:interlude-|[^-].*-\d+-\d+$)/;

// The Ninth Rank Aura Sphere scene carries an item that only its claim grants.
// It used to be marked seen when it OPENED, so Skip forfeited the item forever.
// Now only owning the sphere retires it; Skip just defers it to the next session.
const DEFERRABLE_REWARD_SCENES = new Set([AURA_SPHERE_VN_ID]);

export function isSessionDismissableStoryScene(eventId: string): boolean {
    return DISMISSABLE_STORY_SCENE.test(eventId) || DEFERRABLE_REWARD_SCENES.has(eventId);
}

/** Record a closed scene so its auto-trigger stops re-offering it this session. */
export function dismissStorySceneForSession(eventId: string, dismissed: Set<string>): void {
    if (isSessionDismissableStoryScene(eventId)) dismissed.add(eventId);
}
