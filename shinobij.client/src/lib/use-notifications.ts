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
