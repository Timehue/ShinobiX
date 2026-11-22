/*
 * Plays a coast quest scene (lib/coast-quest-scene) in the story scene reader,
 * above whatever opened it: a quest card in a sector, the Sage's dialog, or
 * the journal.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Character } from "../types/character";
import type { CreatorEvent } from "../types/vn";
import { TriggeredVisualNovel } from "./TriggeredVisualNovel";

export function CoastQuestScene({ event, character, sharedImages, onChoice, onDone, onClose }: {
    event: CreatorEvent; character: Character; sharedImages?: Record<string, string>;
    /** A choice or answer picked inside the scene. */
    onChoice: (optionKey: string) => void;
    /** The last line was read. */
    onDone: () => void;
    /** The scene was skipped. */
    onClose: () => void;
}) {
    const [page, setPage] = useState(0), [line, setLine] = useState(0);
    // Escape skips the scene and goes no further. A scene opened from the
    // Wandering Sage's dialog sits inside that dialog's own Escape handling
    // (ModalDialogScrim, a window listener bound before this one), which would
    // close the dialog and unmount the scene before what it led to could run.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.stopImmediatePropagation();
            onClose();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [onClose]);
    return createPortal(
        <div className="coast-quest-scene">
            <TriggeredVisualNovel event={event} character={character} pageIndex={page} lineIndex={line} setPageIndex={setPage} setLineIndex={setLine}
                sharedImages={sharedImages} onCancel={onClose} onComplete={onDone} onBattle={() => {}}
                onChoice={choice => { if (choice.id) onChoice(choice.id); }} />
        </div>,
        document.body,
    );
}
