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

const DISMISSABLE_STORY_SCENE = /^story-(?:interlude-|[^-].*-\d+-\d+$)/;

export function isSessionDismissableStoryScene(eventId: string): boolean {
    return DISMISSABLE_STORY_SCENE.test(eventId);
}

/** Record a closed scene so its auto-trigger stops re-offering it this session. */
export function dismissStorySceneForSession(eventId: string, dismissed: Set<string>): void {
    if (isSessionDismissableStoryScene(eventId)) dismissed.add(eventId);
}
