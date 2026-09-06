import type { Dispatch, SetStateAction } from "react";
import type { Character } from "../types/character";
import type { CreatorEvent } from "../types/vn";
import { applyStoryChoiceReceipt } from "../lib/character-progress";
import { clearStoryScene, markStoryEpilogueSeen, pendingStoryEpilogue, queueStoryReport, recordStoryScene } from "../lib/story-history";
import { TriggeredVisualNovel } from "./TriggeredVisualNovel";

export function ActiveStoryVisualNovel({
    event, character, pageIndex, lineIndex, setPageIndex, setLineIndex,
    setCharacter, onCancel, onComplete, onBattle, onFinaleLane, onEpilogueExit, sharedImages,
}: {
    event: CreatorEvent;
    character: Character;
    pageIndex: number;
    lineIndex: number;
    setPageIndex: Dispatch<SetStateAction<number>>;
    setLineIndex: Dispatch<SetStateAction<number>>;
    setCharacter: Dispatch<SetStateAction<Character | null>>;
    onCancel: () => void;
    onComplete: () => void;
    onBattle: (event: CreatorEvent, battle?: NonNullable<NonNullable<CreatorEvent["vnPages"]>[number]["choices"]>[number]["battle"]) => void;
    onFinaleLane: (lane: string) => void;
    onEpilogueExit: () => void;
    sharedImages: Record<string, string>;
}) {
    return <TriggeredVisualNovel
        event={event} character={character} pageIndex={pageIndex} lineIndex={lineIndex}
        setPageIndex={setPageIndex} setLineIndex={setLineIndex}
        onCancel={() => {
            if (event.id.startsWith("rift-first-clear-")) {
                setCharacter((current) => current ? clearStoryScene(current, event.id) : current);
                return onCancel();
            }
            if (!event.id.startsWith("story-epilogue-")) return onCancel();
            const pending = pendingStoryEpilogue(character);
            if (pending) setCharacter((current) => current ? markStoryEpilogueSeen(clearStoryScene(current, event.id), pending.chapterEventId) : current);
            onEpilogueExit();
        }}
        onComplete={() => {
            if (!event.id.startsWith("story-epilogue-")) {
                setCharacter((current) => current ? clearStoryScene(current, event.id) : current);
                return onComplete();
            }
            const pending = pendingStoryEpilogue(character);
            if (pending) setCharacter((current) => current ? markStoryEpilogueSeen(clearStoryScene(current, event.id), pending.chapterEventId) : current);
            onEpilogueExit();
        }} onBattle={onBattle}
        onChoice={(choice, receipt) => {
            setCharacter((current) => {
                if (!current) return current;
                let next = applyStoryChoiceReceipt(current, receipt);
                if (receipt.trait && event.id.startsWith("story-interlude-")
                    && receipt.pageIndex === Math.max(0, (event.vnPages?.length ?? 1) - 1)) {
                    next = queueStoryReport(next, { kind: "interlude", eventId: event.id, trait: receipt.trait });
                }
                return next;
            });
            if (receipt.trait && choice.battle && event.kageFinale) onFinaleLane(receipt.trait);
        }}
        onProgress={(cursor, history) => setCharacter((current) => current
            ? recordStoryScene(current, event.id, cursor, history)
            : current)}
        sharedImages={sharedImages}
    />;
}
