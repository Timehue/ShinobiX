import { useCallback, useEffect, useRef, useState } from 'react';
import { isSectorChatSector, type SectorChatMessage } from '../../../shared/sector-chat';
import { fetchSectorChat, sendSectorChat, sectorChatUnavailable, type SectorChatRefusal } from './sector-chat-api';
import { mergeSectorChat, sectorChatCursor } from './sector-chat';
import { isRealtimeConnected, onSectorChat, onStatus } from './presence-socket';
import { visiblePoll } from './poll';

/** With the socket up, the poll only reconciles; each new line arrives as a push hint. */
const LIVE_POLL_MS = 30_000;
/** Without it, the poll is the delivery. */
const FALLBACK_POLL_MS = 5_000;
/**
 * Re-ask for a little before the newest line we hold. Two people speaking at
 * the same moment can be stored out of timestamp order, so a strict cursor
 * could skip the earlier line forever. The merge drops the repeats by id.
 */
const CURSOR_OVERLAP_MS = 10_000;

export type SectorChatStatus = 'away' | 'connecting' | 'ready' | 'unavailable';

/**
 * One sector's chat: what has been said, whether the socket is pushing, and a
 * send. Mounted with the sector HUD, which remounts per sector, so nothing
 * here has to survive a sector change.
 */
export function useSectorChat(sector: number, present: boolean) {
    const enabled = present && isSectorChatSector(sector) && !sectorChatUnavailable();
    const [messages, setMessages] = useState<SectorChatMessage[]>([]);
    const [ready, setReady] = useState(false);
    const [gone, setGone] = useState(false);
    const [live, setLive] = useState(isRealtimeConnected);
    const [skewMs, setSkewMs] = useState(0);
    const cursor = useRef(0);
    const inFlight = useRef<Promise<void> | null>(null);
    const again = useRef(false);

    const refresh = useCallback((): Promise<void> => {
        if (!enabled) return Promise.resolve();
        if (inFlight.current) { again.current = true; return inFlight.current; }
        const run = (async () => {
            do {
                again.current = false;
                const result = await fetchSectorChat(sector, cursor.current ? cursor.current - CURSOR_OVERLAP_MS : 0);
                if (result.ok) {
                    setSkewMs(result.now - Date.now());
                    if (result.messages.length) {
                        setMessages((prev) => {
                            const next = mergeSectorChat(prev, result.messages);
                            cursor.current = sectorChatCursor(next);
                            return next;
                        });
                    }
                    // `away`: the server has not placed us here yet. Keep
                    // listening rather than claiming the sector is quiet.
                    if (!result.away) setReady(true);
                } else if (result.status === 404) {
                    setGone(true);
                    return;
                }
                // Network blips just wait for the next poll; the panel keeps
                // whatever it already shows.
            } while (again.current);
        })().finally(() => { inFlight.current = null; });
        inFlight.current = run;
        return run;
    }, [enabled, sector]);

    useEffect(() => onStatus(setLive), []);

    useEffect(() => {
        if (!enabled) return undefined;
        const unsubscribe = onSectorChat((pushed) => { if (pushed === sector) void refresh(); });
        const stop = visiblePoll(refresh, live ? LIVE_POLL_MS : FALLBACK_POLL_MS, 0.15, { immediate: true });
        return () => { unsubscribe(); stop(); };
    }, [enabled, live, refresh, sector]);

    const send = useCallback(async (text: string): Promise<SectorChatRefusal | null> => {
        const result = await sendSectorChat(sector, text);
        if (!result.ok) {
            if (result.status === 404) setGone(true);
            return result;
        }
        setMessages((prev) => {
            const next = mergeSectorChat(prev, [result.message]);
            cursor.current = sectorChatCursor(next);
            return next;
        });
        return null;
    }, [sector]);

    const status: SectorChatStatus = !present ? 'away' : !enabled || gone ? 'unavailable' : ready ? 'ready' : 'connecting';
    return { messages, status, live, skewMs, send };
}
