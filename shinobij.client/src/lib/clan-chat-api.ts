/*
 * Client wrappers for clan chat (api/clan/chat/*). Auth headers are attached by
 * the global fetch interceptor; we pass playerName + clan for the membership
 * check. GET uses a `since` cursor so idle polls transfer an empty list.
 */
export type ClanChatMessage = { id: string; name: string; text: string; ts: number };

export async function fetchClanChat(player: string, clan: string, since = 0): Promise<ClanChatMessage[]> {
    try {
        const r = await fetch(`/api/clan/chat/get?playerName=${encodeURIComponent(player)}&clan=${encodeURIComponent(clan)}&since=${since}`);
        if (!r.ok) return [];
        const data = await r.json().catch(() => ({})) as { messages?: ClanChatMessage[] };
        return Array.isArray(data.messages) ? data.messages : [];
    } catch { return []; }
}

/** A failed send with no refusal of the server's own to show. */
export const CLAN_CHAT_SEND_FAILED = "Your message did not reach the clan. Try again.";

export async function sendClanChat(player: string, clan: string, text: string): Promise<{ ok: boolean; error?: string; messages?: ClanChatMessage[] }> {
    try {
        const r = await fetch("/api/clan/chat/send", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName: player, clan, text }),
        });
        const data = await r.json().catch(() => ({})) as Record<string, unknown>;
        if (!r.ok) return { ok: false, error: r.status >= 500 ? CLAN_CHAT_SEND_FAILED : (data.error as string) ?? CLAN_CHAT_SEND_FAILED };
        return { ok: true, messages: data.messages as ClanChatMessage[] };
    } catch { return { ok: false, error: CLAN_CHAT_SEND_FAILED }; }
}
