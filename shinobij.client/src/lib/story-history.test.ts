import { test } from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import type { CreatorEvent } from "../types/vn";
import {
    clearStoryScene,
    nextNarrativeDelivery,
    pendingStoryEpilogue,
    prepareStorySettlement,
    preserveNarrativeState,
    recordPendingStoryEpilogue,
    sanitizeStoryScene,
} from "./story-history";
import {
    acknowledgeStoryReport,
    markStoryEpilogueSeen,
    nextPendingStoryReport,
    queueStoryReport,
    recordStoryChoice,
    recordStoryReportConflict,
    recordStoryScene,
} from "./story-history-mutations";
import { makeStoryChoiceReceipt } from "./story-choice-history";
import { applyStoryChoiceReceipt } from "./story-choice-mutations";

const event: CreatorEvent = {
    id: "story-stormveil-village-4-0", name: "A Storm Without Thunder", biome: "coast", icon: "x",
    levelReq: 4, xpReward: 0, ryoReward: 0, staminaReward: 0, dialogue: [],
    vnPages: [{
        id: "reason", title: "Reason", scene: "", speaker: "Clerk", dialogue: ["Choose"], choices: [
            { id: "shield", text: "Protect", nextPage: 2, trait: "guardian" },
            { id: "ladder", text: "Climb", nextPage: 3, trait: "ambitious" },
        ],
    }],
};

const character = (name = "Tester"): Character => ({
    name, village: "Stormveil Village", storyVillage: "Stormveil Village", storyProgress: 0, storyTraits: [],
} as unknown as Character);

test("story decisions are immutable per event page and include non-trait branch identity", () => {
    const ladder = makeStoryChoiceReceipt(event, 0, 1, event.vnPages![0].choices![1]);
    const shield = makeStoryChoiceReceipt(event, 0, 0, event.vnPages![0].choices![0]);
    const first = recordStoryChoice(character(), ladder);
    const attemptedRewrite = recordStoryChoice(first, shield);
    assert.deepEqual(attemptedRewrite.storyChoices, [ladder]);
    assert.equal(attemptedRewrite.storyChoices![0].battle, undefined);
    const projected = applyStoryChoiceReceipt(applyStoryChoiceReceipt(character(), ladder), shield);
    assert.ok(projected.storyTraits?.includes("ambitious"));
    assert.ok(!projected.storyTraits?.includes("guardian"));
    const altered = applyStoryChoiceReceipt(first, { ...ladder, trait: "guardian" });
    assert.ok(altered.storyTraits?.includes("ambitious"));
    assert.ok(!altered.storyTraits?.includes("guardian"));
});

test("reusable finale hub records proof, testimony, then terminal lane in order", () => {
    const hub: CreatorEvent = {
        ...event,
        id: "story-stormveil-village-100-8",
        vnPages: [{ title: "Final", scene: "", speaker: "Kage", dialogue: ["Answer"], choices: [
            { text: "Present proof", nextPage: 1, trait: "sv100-proof-presented-carried" },
            { text: "Hear testimony", nextPage: 2, trait: "sv100-vanta-testified" },
            { text: "Break the board", nextPage: 0, trait: "honorable", battle: { bossName: "Kage" } },
        ] }],
    };
    const receipts = hub.vnPages![0].choices!.map((choice, index) => makeStoryChoiceReceipt(hub, 0, index, choice));
    assert.ok(receipts.every((receipt) => receipt.revisitable));
    const recorded = receipts.reduce((current, receipt) => recordStoryChoice(current, receipt), character());
    assert.deepEqual(recorded.storyChoices?.map((receipt) => receipt.trait), [
        "sv100-proof-presented-carried", "sv100-vanta-testified", "honorable",
    ]);
    const opposing = makeStoryChoiceReceipt(hub, 0, 3, { text: "Take it", nextPage: 0, trait: "ambitious", battle: { bossName: "Kage" } });
    assert.deepEqual(recordStoryChoice(recorded, opposing).storyChoices, recorded.storyChoices);
});

test("pending interlude report survives close/reload state and clears only on matching ack", () => {
    const queued = queueStoryReport(character(), { kind: "interlude", eventId: "story-interlude-stormveil-village-20", trait: "sv20-asked-the-price" });
    assert.equal(queued.pendingStoryReports?.length, 1);
    const wrong = acknowledgeStoryReport(queued, { kind: "interlude", eventId: "story-interlude-stormveil-village-20", trait: "other" });
    assert.equal(wrong.pendingStoryReports?.length, 1);
    const done = acknowledgeStoryReport(queued, queued.pendingStoryReports![0]);
    assert.deepEqual(done.pendingStoryReports, []);
});

test("a contradictory report remains explicit while the next independent report can drain", () => {
    const first = { kind: "interlude" as const, eventId: "story-interlude-stormveil-village-20", trait: "sv20-asked-the-price" };
    const second = { kind: "road" as const, eventId: "story-road-34", trait: "rd34-listened" };
    const queued = queueStoryReport(queueStoryReport(character(), first), second);
    const conflicted = recordStoryReportConflict(queued, queued.pendingStoryReports![0], "sv20-refused-the-price");
    assert.deepEqual(conflicted.pendingStoryReports?.[0], { version: 1, ...first, status: "conflict", recordedTrait: "sv20-refused-the-price" });
    assert.equal(nextPendingStoryReport(conflicted)?.eventId, second.eventId);
    const drained = acknowledgeStoryReport(conflicted, conflicted.pendingStoryReports![1]);
    assert.equal(drained.pendingStoryReports?.length, 1);
    assert.equal(drained.pendingStoryReports?.[0].status, "conflict");
});

test("authoritative responses preserve same-account narrative receipts but never cross accounts", () => {
    const receipt = makeStoryChoiceReceipt(event, 0, 1, event.vnPages![0].choices![1]);
    const local = recordStoryChoice(character("Same"), receipt);
    const merged = preserveNarrativeState(character("same"), local);
    assert.deepEqual(merged.storyChoices, [receipt]);
    assert.ok(merged.storyTraits?.includes("ambitious"));
    const pending = queueStoryReport(local, { kind: "road", eventId: "story-road-34", trait: "rd34-listened" });
    assert.equal(preserveNarrativeState(character("same"), pending).pendingStoryReports?.length, 1);
    assert.deepEqual(preserveNarrativeState({ ...character("same"), pendingStoryReports: pending.pendingStoryReports }, { ...local, pendingStoryReports: [] }).pendingStoryReports, []);
    const serverWithCursor = recordStoryScene(character("same"), event.id, { pageIndex: 3, lineIndex: 1 }, [{ pageIndex: 0, lineIndex: 0 }]);
    const cleared = clearStoryScene({ ...local, storyScene: serverWithCursor.storyScene }, event.id);
    assert.equal(cleared.storyScene, null);
    assert.equal(preserveNarrativeState(serverWithCursor, cleared).storyScene, null);
    const foreign = preserveNarrativeState(character("Other"), local);
    assert.equal(foreign.storyChoices, undefined);
});

test("authoritative snapshots preserve same-account Echoes scene history monotonically", () => {
    const authoritative = {
        ...character("same"),
        echoesStorySeen: {
            "echoes-1-tovin": { pre: true },
            "echoes-2-vetta": { post: true },
        },
    };
    const local = {
        ...character("Same"),
        echoesStorySeen: {
            "echoes-1-tovin": { post: true },
            "echoes-2-vetta": { post: false },
            "era:echoes-age-1": { pre: true },
        },
    };

    assert.deepEqual(preserveNarrativeState(authoritative, local).echoesStorySeen, {
        "echoes-1-tovin": { pre: true, post: true },
        "echoes-2-vetta": { post: true },
        "era:echoes-age-1": { pre: true },
    });

    const foreign = preserveNarrativeState(
        { ...character("Other"), echoesStorySeen: { "echoes-3-aya": { pre: true } } },
        local,
    );
    assert.deepEqual(foreign.echoesStorySeen, { "echoes-3-aya": { pre: true } });
});

test("a stale authoritative response cannot replace an accepted local decision or ending branch", () => {
    const ladder = makeStoryChoiceReceipt(event, 0, 1, event.vnPages![0].choices![1]);
    const shield = makeStoryChoiceReceipt(event, 0, 0, event.vnPages![0].choices![0]);
    const authoritative = {
        ...character("same"), storyChoices: [shield], storyEpilogues: [{
            version: 1 as const, chapterEventId: "story-stormveil-village-100-8", lane: "honorable",
            status: "pending" as const, presentationTraits: ["sv100-proof-presented-carried"],
        }],
    };
    const local = {
        ...character("Same"), storyChoices: [ladder], storyEpilogues: [{
            version: 1 as const, chapterEventId: "story-stormveil-village-100-8", lane: "ambitious",
            status: "seen" as const, presentationTraits: ["sv100-vanta-testified"],
        }],
    };
    const merged = preserveNarrativeState(authoritative, local);
    assert.deepEqual(merged.storyChoices, [ladder]);
    assert.deepEqual(merged.storyEpilogues, [{ ...authoritative.storyEpilogues[0], status: "seen" }]);
});

test("a stale authoritative response cannot restore returned Moonshadow custody", () => {
    const authoritative = {
        ...character("same"),
        storyTraits: ["ms65-saved-the-file", "ms88-player-still-holds-nyx-file"],
    };
    const local = {
        ...character("Same"),
        storyTraits: ["ms65-saved-the-file", "ms88-nyx-proof-deferred", "ms100-proof-presented-deferred"],
    };
    const merged = preserveNarrativeState(authoritative, local);
    assert.ok(merged.storyTraits?.includes("ms88-nyx-proof-deferred"));
    assert.ok(merged.storyTraits?.includes("ms100-proof-presented-deferred"));
    assert.ok(!merged.storyTraits?.includes("ms88-player-still-holds-nyx-file"));
});

test("finale aftermath snapshot is pending once and seen atomically", () => {
    const c = { ...character(), storyTraits: [...Array.from({ length: 120 }, (_, index) => `old-${index}`), "sv100-proof-presented-carried", "sv100-vanta-testified", "honorable"] };
    const pending = recordPendingStoryEpilogue(c, "story-stormveil-village-100-8", "honorable");
    assert.equal(pendingStoryEpilogue(pending)?.status, "pending");
    assert.deepEqual(pendingStoryEpilogue(pending)?.presentationTraits, ["sv100-proof-presented-carried", "sv100-vanta-testified"]);
    const duplicate = recordPendingStoryEpilogue({ ...pending, storyTraits: ["later"] }, "story-stormveil-village-100-8", "ambitious");
    assert.equal(duplicate.storyEpilogues?.[0].lane, "honorable");
    const seen = markStoryEpilogueSeen(duplicate, "story-stormveil-village-100-8");
    assert.equal(pendingStoryEpilogue(seen), undefined);
});

test("pending finale wins priority over rift aftermath and both precede ordinary story", () => {
    const finale = recordPendingStoryEpilogue({ ...character(), storyProgress: 9, riftFirstClears: { "rift-legacy-echo": { at: 20 }, "rift-hollow-stalker": { at: 10 } } }, "story-stormveil-village-100-8", "honorable");
    assert.equal(nextNarrativeDelivery(finale, [])?.kind, "epilogue");
    const seen = markStoryEpilogueSeen(finale, "story-stormveil-village-100-8");
    assert.deepEqual(nextNarrativeDelivery(seen, []), { kind: "rift", riftId: "rift-hollow-stalker" });
    assert.deepEqual(nextNarrativeDelivery(seen, ["rift-first-clear-hollow-stalker"]), { kind: "rift", riftId: "rift-legacy-echo" });
    const stale = recordPendingStoryEpilogue(character(), "story-stormveil-village-100-8", "honorable");
    assert.equal(nextNarrativeDelivery(stale, []), undefined);
});

test("settled finale uses the immutable terminal receipt and does not invent a lane", () => {
    const finale: CreatorEvent = { ...event, id: "story-stormveil-village-100-8", vnPages: [{ title: "Last", scene: "", speaker: "Kage", dialogue: ["Choose"], choices: [
        { text: "Break", nextPage: 0, trait: "honorable", battle: { bossName: "Kage" } },
    ] }] };
    const receipt = makeStoryChoiceReceipt(finale, 0, 0, finale.vnPages![0].choices![0]);
    const local = recordStoryChoice({ ...character(), storyProgress: 8, storyTraits: ["honorable"] }, receipt);
    const settled = prepareStorySettlement({ ...character(), storyProgress: 9 }, local, true, false, "ambitious");
    assert.equal(pendingStoryEpilogue(settled)?.lane, "honorable");
    const recoveredReplay = prepareStorySettlement({ ...character(), storyProgress: 9 }, local, true, true, null);
    assert.equal(pendingStoryEpilogue(recoveredReplay)?.lane, "honorable");
    assert.equal(pendingStoryEpilogue(prepareStorySettlement({ ...character(), storyProgress: 9 }, null, true, false, null)), undefined);
});

test("resume history is bounded and malformed cursors are normalized", () => {
    const scene = sanitizeStoryScene({ eventId: event.id, pageIndex: -2, lineIndex: "3", history: Array.from({ length: 300 }, (_, i) => ({ pageIndex: i, lineIndex: i })) });
    assert.equal(scene?.pageIndex, 0);
    assert.equal(scene?.lineIndex, 3);
    assert.equal(scene?.history.length, 256);
});
