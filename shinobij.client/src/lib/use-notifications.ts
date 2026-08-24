/*
 * Live notification list shared by the desktop right-rail bar and the mobile
 * bar. Re-derives from the already-polled world/clan-war caches (see
 * ./notifications) on a short interval and whenever screen/clan/village change,
 * re-rendering the consumer only when the resulting list actually changes.
 */
import { useEffect, useRef, useState } from "react";
import type { Screen } from "../types/core";
import { computeNotifications, type GameNotification } from "./notifications";

const REFRESH_MS = 5000;
export const CLAN_VIEW_REQUEST_EVENT = "shinobij:clan-view-request";

function listKey(notes: GameNotification[]): string {
    return notes.map((n) => `${n.id}:${n.label}`).join("|");
}

export function useNotifications(screen: Screen, clan: string, village: string): GameNotification[] {
    const [notes, setNotes] = useState<GameNotification[]>(() =>
        computeNotifications({ screen, clan, village }),
    );
    const lastKey = useRef(listKey(notes));

    useEffect(() => {
        function refresh() {
            const next = computeNotifications({ screen, clan, village });
            const key = listKey(next);
            if (key !== lastKey.current) {
                lastKey.current = key;
                setNotes(next);
            }
        }
        refresh(); // re-derive immediately when screen/clan/village change
        const id = setInterval(refresh, REFRESH_MS);
        return () => clearInterval(id);
    }, [screen, clan, village]);

    return notes;
}

export function activateGameNotification(
    note: GameNotification,
    navigate: (screen: Screen) => void,
): void {
    if (!note.screen) return;
    let repeatClanViewRequest = false;
    if (note.targetView === "territory") {
        try { sessionStorage.setItem("clan.initialView", "territory"); } catch { /* navigation still works */ }
        // A notification can be clicked while Clan Hall is already mounted. In
        // that case navigation does not remount it, so the session hand-off
        // alone cannot change tabs. The event handles the live instance while
        // the stored value remains the fallback for a newly mounted hall.
        try {
            window.dispatchEvent(new CustomEvent(CLAN_VIEW_REQUEST_EVENT, {
                detail: { view: "territory" },
            }));
            repeatClanViewRequest = true;
        } catch { /* session hand-off still covers a fresh mount */ }
    }
    navigate(note.screen);
    if (repeatClanViewRequest) {
        // Navigation/restore can replace Clan Hall in the same React frame.
        // Repeat once after that commit so the replacement receives the same
        // intent; a fresh mount also consumes the session fallback above.
        window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent(CLAN_VIEW_REQUEST_EVENT, {
                detail: { view: "territory" },
            }));
        }, 0);
    }
}
