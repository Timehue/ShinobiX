import { useCallback, useRef, useState } from 'react';
import { useChatPushRefresh } from './use-chat-push';

/**
 * The village tavern's transcript (api/village/chat.ts). The GET is the only
 * source: a socket hint, a reconnect or the two-minute reconcile poll all just
 * refetch it (lib/use-chat-push.ts), so the server's block-list filter and
 * guest lock apply to every read.
 *
 * `enabled` must be false while the player is a locked guest or the lock is
 * still unanswered — the server answers 403 to both, so there is nothing to
 * fetch and no room to join.
 */
export function useVillageChat<T extends { ts: number }>(village: string, enabled: boolean) {
    const [messages, setMessages] = useState<T[]>([]);
    const [loading, setLoading] = useState(true);
    // Track last known message count so we skip re-renders when nothing changed
    const lastCountRef = useRef<number>(-1);
    // …and the newest message ts: at the 30-message cap every append keeps the
    // count constant, so count alone would hide new lines (e.g. World Herald
    // broadcasts). Server sends X-Last-Ts alongside X-Message-Count.
    const lastTsRef = useRef<number>(-1);

    const fetchMessages = useCallback(async (isActive: () => boolean) => {
        try {
            const res = await fetch(`/api/village/chat?village=${encodeURIComponent(village)}`);
            if (!res.ok) return;
            // Server sends X-Message-Count + X-Last-Ts so we can skip the JSON
            // parse when nothing changed. Both must match: at the cap the count
            // never moves, only the newest ts does. Older servers without
            // X-Last-Ts fall back to the count-only check (lastTs stays -1).
            const count = Number(res.headers.get("X-Message-Count") ?? -1);
            const lastTs = Number(res.headers.get("X-Last-Ts") ?? -1);
            if (count !== -1 && count === lastCountRef.current && (lastTs === -1 || lastTs === lastTsRef.current)) return;
            const parsed = await res.json();
            if (!isActive()) return;
            const data: T[] = Array.isArray(parsed) ? parsed : [];
            lastCountRef.current = data.length;
            lastTsRef.current = data.length ? data[data.length - 1].ts : 0;
            setMessages(data);
        } catch { /* silently ignore network errors */ }
        finally { if (isActive()) setLoading(false); }
    }, [village]);

    useChatPushRefresh('village', village, enabled, fetchMessages);

    return { messages, setMessages, loading };
}
