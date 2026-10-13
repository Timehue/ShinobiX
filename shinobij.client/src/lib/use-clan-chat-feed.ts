import { useCallback, useRef, useState } from 'react';
import { fetchClanChat, type ClanChatMessage } from './clan-chat-api';
import { useChatPushRefresh } from './use-chat-push';

/** Mirrors the server's ring buffer (api/clan/chat/_storage.ts CLAN_CHAT_MAX_MESSAGES). */
export const CLAN_CHAT_KEEP = 50;

/**
 * A clan's chat while its tab is mounted. Fetches with a `since` cursor, so a
 * refetch that finds nothing new transfers an empty list; a socket hint, a
 * reconnect or the two-minute reconcile poll triggers it (lib/use-chat-push.ts).
 * Reading stays open to guests, matching the GET.
 */
export function useClanChatFeed(playerName: string, clan: string) {
    const [messages, setMessages] = useState<ClanChatMessage[]>([]);
    const sinceRef = useRef(0);

    const merge = useCallback((incoming: ClanChatMessage[]) => {
        if (incoming.length === 0) return;
        setMessages(prev => {
            const seen = new Set(prev.map(m => m.id));
            const merged = [...prev];
            for (const m of incoming) if (!seen.has(m.id)) merged.push(m);
            merged.sort((a, b) => a.ts - b.ts);
            const capped = merged.slice(-CLAN_CHAT_KEEP);
            if (capped.length) sinceRef.current = capped[capped.length - 1].ts;
            return capped;
        });
    }, []);

    const refresh = useCallback(async (isActive: () => boolean) => {
        const incoming = await fetchClanChat(playerName, clan, sinceRef.current).catch(() => []);
        if (isActive()) merge(incoming);
    }, [playerName, clan, merge]);

    useChatPushRefresh('clan', clan, true, refresh);

    return { messages, merge };
}
