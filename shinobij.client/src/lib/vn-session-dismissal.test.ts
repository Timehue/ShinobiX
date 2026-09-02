import { strict as assert } from "node:assert";
import test from "node:test";
import { dismissStorySceneForSession, isSessionDismissableStoryScene } from "./vn-session-dismissal";
import { storylines } from "../data/storylines";
import { storyToCreatorEvent } from "./story-trigger";

/*
 * The skip list behind "Skip" on an auto-triggered story scene. Neither family it
 * covers is consumed by being read — a chapter milestone waits on a sealed boss
 * win, an interlude on a recorded choice — so a scene that closes without landing
 * here is re-offered by the auto-trigger on the very next render.
 */

test("the two auto-triggered story families are dismissable", () => {
    assert.equal(isSessionDismissableStoryScene("story-interlude-stormveil-2"), true);
    // Real chapter ids, straight from the live story data (story-<slug>-<level>-<index>).
    for (const [village, steps] of Object.entries(storylines)) {
        const id = storyToCreatorEvent(steps[0], village, 0).id;
        assert.equal(isSessionDismissableStoryScene(id), true, `${id} must be dismissable`);
    }
});

test("scenes owned by the screen that opened them are not on the list", () => {
    for (const id of ["chronicle-scribe", "sys-pet-encounter", "sys-ancient-chest", "legacy-sage-offer", "rift-giver-ember"]) {
        assert.equal(isSessionDismissableStoryScene(id), false, `${id} must not be dismissable`);
    }
});

test("dismissing records only what the auto-trigger would otherwise re-offer", () => {
    const dismissed = new Set<string>();
    dismissStorySceneForSession("story-interlude-stormveil-2", dismissed);
    dismissStorySceneForSession("chronicle-scribe", dismissed);
    assert.deepEqual([...dismissed], ["story-interlude-stormveil-2"]);
});
